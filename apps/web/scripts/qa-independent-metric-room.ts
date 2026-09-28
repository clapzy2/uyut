/** Local-only source check for manually reviewed rooms; no AI or database calls. */
import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { PlanPageContours, PlanReading } from '@uyut/db'
import sharp from 'sharp'
import { preparePlanPage } from '../lib/projects/plan-document'
import {
  inspectManualPlanCompleteness,
  inspectPlanGeometry,
} from '../lib/projects/plan-geometry-inspection'
import { planPageMetricDraft } from '../lib/projects/plan-page-metric-draft'
import { planPageContoursSchema, planPageReviewIssue } from '../lib/projects/plan-page-review'
import { pdfDepthChain, pdfWidthChain } from '../lib/projects/plan-pdf-dimension-chain'

type Chain = { textItemIndexes: number[]; segmentsMm: number[] }
type ReviewedRoom = {
  sourceNumber: number
  name: string
  kind: PlanReading['rooms'][number]['kind']
  utility?: boolean
  areaM2: number
  polygon: PlanPageContours['rooms'][number]['polygon']
  conditionalEdges?: PlanPageContours['rooms'][number]['conditionalEdges']
  openings?: PlanPageContours['rooms'][number]['openings']
  widthMm?: number
  depthMm?: number
  width?: Chain
  depth?: Chain
}
type Fixture = {
  source: { sha256: string; pdfPage: number; state: 'existing' }
  room?: ReviewedRoom
  rooms?: ReviewedRoom[]
  calibrationRoomNumbers?: number[]
  expectedDimensionIssues?: Array<{ sourceNumber: number; side: 'width' | 'depth'; reason: string }>
  areaConflicts?: Array<{
    sourceNumber: number
    planTextItemIndex: number
    legendTextItemIndex: number
    planAreaM2: number
    legendAreaM2: number
  }>
}

const [pdfPath, fixturePath, overlayPath] = process.argv.slice(2)
if (!pdfPath || !fixturePath) {
  throw new Error(
    'Usage: bun run scripts/qa-independent-metric-room.ts <PDF> <fixture.json> [overlay.png]',
  )
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
const linework = page.linework
const textItems = JSON.parse(page.image.planText) as Array<{
  text: string
  x: number
  y: number
  rotation: number
}>
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
    ...(room.conditionalEdges ? { conditionalEdges: room.conditionalEdges } : {}),
    ...(room.openings ? { openings: room.openings } : {}),
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
    ...(room.utility ? { utility: true } : {}),
    areaM2: room.areaM2,
    ...(room.widthMm === undefined ? {} : { widthCm: room.widthMm / 10 }),
    ...(room.depthMm === undefined ? {} : { depthCm: room.depthMm / 10 }),
    measurementEvidence: {
      ...(room.width ? { width: evidence('horizontal-chain', room, room.width) } : {}),
      ...(room.depth ? { depth: evidence('vertical-chain', room, room.depth) } : {}),
    },
  })),
}
const sourceIssue = planPageReviewIssue(contours, reading, source, page.linework)
if (sourceIssue) throw new Error(`Source contour review failed: ${sourceIssue}`)
const dimensionChecks = rooms.flatMap((room) =>
  (['width', 'depth'] as const).map((side) => {
    const chain = room[side]
    const value = side === 'width' ? room.widthMm : room.depthMm
    if (!chain || value === undefined) {
      if (chain || value !== undefined)
        throw new Error(`Room ${room.sourceNumber}: incomplete dimension evidence.`)
      return { sourceNumber: room.sourceNumber, side, status: 'not-supplied' }
    }
    const labels = chain.textItemIndexes.map((index) => {
      const label = textItems[index]
      if (!label) throw new Error(`Missing text item ${index}`)
      return { ...label, index }
    })
    const verify = side === 'width' ? pdfWidthChain : pdfDepthChain
    const checked = verify(linework, source, contours, room.sourceNumber, labels, value)
    const expectedIssue = fixture.expectedDimensionIssues?.find(
      (issue) => issue.sourceNumber === room.sourceNumber && issue.side === side,
    )
    if (checked.status !== 'candidate') {
      if (expectedIssue?.reason !== checked.reason)
        throw new Error(`Room ${room.sourceNumber}, ${side}: ${checked.reason}`)
      const roomReading = reading.rooms.find((item) => item.sourceNumber === room.sourceNumber)
      if (roomReading) {
        delete roomReading.measurementEvidence?.[side]
        if (side === 'width') delete roomReading.widthCm
        else delete roomReading.depthCm
      }
      return {
        sourceNumber: room.sourceNumber,
        side,
        status: checked.status,
        reason: checked.reason,
      }
    }
    if (expectedIssue)
      throw new Error(`Room ${room.sourceNumber}, ${side}: expected issue changed.`)
    return {
      sourceNumber: room.sourceNumber,
      side,
      status: checked.status,
      totalMm: checked.totalMm,
    }
  }),
)
const result = planPageMetricDraft(
  reading,
  {
    source,
    contours,
    linework: page.linework,
    planText: page.image.planText,
    ...(fixture.calibrationRoomNumbers
      ? { calibrationRoomNumbers: fixture.calibrationRoomNumbers }
      : {}),
  },
  rooms.map((room) => room.sourceNumber),
)
if (!result.ok) throw new Error(result.error)
const geometryIssues = inspectPlanGeometry(result.geometry)
if (geometryIssues.length > 0) throw new Error(`Geometry issues: ${JSON.stringify(geometryIssues)}`)
if (result.geometry.rooms.length !== rooms.length)
  throw new Error('Not every room was transferred.')
const expectedWalls = rooms.reduce(
  (count, room) => count + room.polygon.length - (room.conditionalEdges?.length ?? 0),
  0,
)
if (result.geometry.walls.length !== expectedWalls)
  throw new Error('A conditional zone divider was transferred as a physical wall.')
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
    acceptedWidthMm:
      reading.rooms.find((room) => room.sourceNumber === reviewedRoom.sourceNumber)?.widthCm ===
      undefined
        ? undefined
        : reviewedRoom.widthMm,
    acceptedDepthMm:
      reading.rooms.find((room) => room.sourceNumber === reviewedRoom.sourceNumber)?.depthCm ===
      undefined
        ? undefined
        : reviewedRoom.depthMm,
    signedAreaM2: reviewedRoom.areaM2,
    calculatedAreaM2: Math.round(calculatedAreaM2 * 100) / 100,
    polygon,
  }
})

if (overlayPath) {
  if (!overlayPath.endsWith('.png'))
    throw new Error('Overlay output must be a PNG, never the source PDF.')
  const metadata = await sharp(page.image.body).metadata()
  const shapes = rooms
    .map((room) => {
      const points = room.polygon.map((point) => `${point.x},${point.y}`).join(' ')
      const conditional =
        room.conditionalEdges
          ?.map((edge) => {
            const start = room.polygon[edge.wallEdgeIndex]
            const end = room.polygon[(edge.wallEdgeIndex + 1) % room.polygon.length]
            if (!start || !end) throw new Error('Missing conditional edge endpoints')
            return `<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke="#da2657" stroke-width="3" stroke-dasharray="6 4"/>`
          })
          .join('') ?? ''
      return `<polygon points="${points}" fill="#008080" fill-opacity="0.12" stroke="#008080" stroke-width="1.5"/>${conditional}`
    })
    .join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${metadata.width}" height="${metadata.height}" viewBox="0 0 1000 1000" preserveAspectRatio="none">${shapes}</svg>`
  await mkdir(dirname(overlayPath), { recursive: true })
  await sharp(page.image.body)
    .composite([{ input: Buffer.from(svg) }])
    .png()
    .toFile(overlayPath)
}

console.log(
  JSON.stringify({
    sourcePage: source.pdfPage,
    sourceSha256: sha256,
    rooms: verifiedRooms,
    areaConflicts,
    dimensionChecks,
    wallBoundaryRecords: result.geometry.walls.length,
    conditionalEdges: rooms.reduce(
      (count, room) => count + (room.conditionalEdges?.length ?? 0),
      0,
    ),
    openings: result.geometry.openings.length,
    warnings: result.geometry.warnings,
    geometryIssues: geometryIssues.length,
    confirmationIssues: inspectManualPlanCompleteness(result.geometry),
    paidCalls: 0,
  }),
)
