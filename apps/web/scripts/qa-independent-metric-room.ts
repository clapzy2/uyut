/** Local-only source check for manually reviewed rooms; no AI or database calls. */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { PlanPageContours, PlanReading } from '@uyut/db'
import { preparePlanPage } from '../lib/projects/plan-document'
import { inspectPlanGeometry } from '../lib/projects/plan-geometry-inspection'
import { planPageMetricDraft } from '../lib/projects/plan-page-metric-draft'
import { planPageContoursSchema, planPageReviewIssue } from '../lib/projects/plan-page-review'

type Chain = { textItemIndexes: number[]; segmentsMm: number[] }
type ReviewedRoom = {
  sourceNumber: number
  name: string
  kind: PlanReading['rooms'][number]['kind']
  areaM2: number
  polygon: PlanPageContours['rooms'][number]['polygon']
  widthMm: number
  depthMm: number
  width: Chain
  depth: Chain
}
type Fixture = {
  source: { sha256: string; pdfPage: number; state: 'existing' }
  room?: ReviewedRoom
  rooms?: ReviewedRoom[]
  areaConflicts?: Array<{
    sourceNumber: number
    planTextItemIndex: number
    legendTextItemIndex: number
    planAreaM2: number
    legendAreaM2: number
  }>
}

const [pdfPath, fixturePath] = process.argv.slice(2)
if (!pdfPath || !fixturePath) {
  throw new Error('Usage: bun run scripts/qa-independent-metric-room.ts <PDF> <fixture.json>')
}
const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as Fixture
const rooms = fixture.rooms ?? (fixture.room ? [fixture.room] : [])
if (
  rooms.length < 1 ||
  rooms.length > 12 ||
  new Set(rooms.map((room) => room.sourceNumber)).size !== rooms.length ||
  rooms.some((room) => !['living', 'bedroom', 'kitchen', 'bath', 'kid'].includes(room.kind))
) {
  throw new Error('Fixture needs distinct numbered rooms with supported room kinds.')
}
const body = await readFile(pdfPath)
const sha256 = createHash('sha256').update(body).digest('hex')
if (fixture.source.state !== 'existing' || sha256 !== fixture.source.sha256) {
  throw new Error('The PDF does not match the reviewed existing-state fixture.')
}
const page = await preparePlanPage(body, true, fixture.source.pdfPage, true)
if (!page.linework || !page.image.planText) throw new Error('Native geometry or text is missing.')
const textItems = JSON.parse(page.image.planText) as Array<{ text?: string }>
const areaConflicts = (fixture.areaConflicts ?? []).map((conflict) => {
  const planText = textItems[conflict.planTextItemIndex]?.text ?? ''
  const legendText = textItems[conflict.legendTextItemIndex]?.text ?? ''
  const planMatch = /^\s*(\d{1,3},\d{1,2})\s*$/.exec(planText)
  const legendMatch = /^\s*0?(\d+)\s*-.+?-\s*(\d{1,3},\d{1,2})\s*м/i.exec(legendText)
  const parseArea = (value: string) => Number(value.replace(',', '.'))
  if (
    !planMatch?.[1] ||
    !legendMatch?.[1] ||
    !legendMatch[2] ||
    Number(legendMatch[1]) !== conflict.sourceNumber ||
    parseArea(planMatch[1]) !== conflict.planAreaM2 ||
    parseArea(legendMatch[2]) !== conflict.legendAreaM2 ||
    conflict.planAreaM2 === conflict.legendAreaM2
  ) {
    throw new Error(`Room ${conflict.sourceNumber}: area conflict evidence changed.`)
  }
  return {
    sourceNumber: conflict.sourceNumber,
    planAreaM2: conflict.planAreaM2,
    legendAreaM2: conflict.legendAreaM2,
  }
})

const { source } = fixture
const contours = planPageContoursSchema.parse({
  source,
  coordinateSystem: 'page-0-1000',
  review: 'manual-source-review',
  pageWidth: page.linework.pageWidth,
  pageHeight: page.linework.pageHeight,
  rooms: rooms.map((room) => ({
    roomSourceNumber: room.sourceNumber,
    polygon: room.polygon,
  })),
})
const evidence = (
  kind: 'horizontal-chain' | 'vertical-chain',
  room: ReviewedRoom,
  chain: Chain,
) => ({
  kind,
  scope: 'room' as const,
  sourceNumber: room.sourceNumber,
  complete: true as const,
  ...chain,
})
const reading: PlanReading = {
  readAt: new Date().toISOString(),
  sourcePage: source.pdfPage,
  planState: 'existing',
  rooms: rooms.map((room) => ({
    sourceNumber: room.sourceNumber,
    name: room.name,
    kind: room.kind,
    areaM2: room.areaM2,
    widthCm: room.widthMm / 10,
    depthCm: room.depthMm / 10,
    measurementEvidence: {
      width: evidence('horizontal-chain', room, room.width),
      depth: evidence('vertical-chain', room, room.depth),
    },
  })),
}
const sourceIssue = planPageReviewIssue(contours, reading, source, page.linework)
if (sourceIssue) throw new Error(`Source contour review failed: ${sourceIssue}`)
const result = planPageMetricDraft(
  reading,
  { source, contours, linework: page.linework, planText: page.image.planText },
  rooms.map((room) => room.sourceNumber),
)
if (!result.ok) throw new Error(result.error)
const geometryIssues = inspectPlanGeometry(result.geometry)
if (geometryIssues.length > 0) throw new Error(`Geometry issues: ${JSON.stringify(geometryIssues)}`)
if (result.geometry.rooms.length !== rooms.length)
  throw new Error('Not every room was transferred.')
const areaM2 = (polygon: NonNullable<(typeof result.geometry.rooms)[number]['polygon']>) =>
  Math.abs(
    polygon.reduce((sum, point, index) => {
      const next = polygon[(index + 1) % polygon.length]
      return next ? sum + point.xCm * next.yCm - next.xCm * point.yCm : sum
    }, 0),
  ) / 20_000
const verifiedRooms = result.geometry.rooms.map((geometryRoom) => {
  const reviewedRoom = rooms.find((room) => room.sourceNumber === geometryRoom.sourceNumber)
  const polygon = geometryRoom.polygon
  if (!reviewedRoom || !polygon) throw new Error('A reviewed room has no transferred contour.')
  const calculatedAreaM2 = areaM2(polygon)
  const differenceM2 = Math.abs(calculatedAreaM2 - reviewedRoom.areaM2)
  if (differenceM2 > Math.max(0.1, reviewedRoom.areaM2 * 0.02)) {
    throw new Error(
      `Room ${reviewedRoom.sourceNumber}: contour ${calculatedAreaM2.toFixed(2)} m2 and signed ${reviewedRoom.areaM2.toFixed(2)} m2 disagree.`,
    )
  }
  return {
    sourceNumber: reviewedRoom.sourceNumber,
    printedWidthMm: reviewedRoom.widthMm,
    printedDepthMm: reviewedRoom.depthMm,
    signedAreaM2: reviewedRoom.areaM2,
    calculatedAreaM2: Math.round(calculatedAreaM2 * 100) / 100,
    polygon,
  }
})

console.log(
  JSON.stringify({
    sourcePage: source.pdfPage,
    sourceSha256: sha256,
    rooms: verifiedRooms,
    areaConflicts,
    geometryIssues: geometryIssues.length,
    paidCalls: 0,
  }),
)
