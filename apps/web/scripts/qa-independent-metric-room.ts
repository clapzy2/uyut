/** Local-only source check for one manually reviewed room; no AI or database calls. */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { PlanPageContours, PlanReading } from '@uyut/db'
import { preparePlanPage } from '../lib/projects/plan-document'
import { inspectPlanGeometry } from '../lib/projects/plan-geometry-inspection'
import { planPageMetricDraft } from '../lib/projects/plan-page-metric-draft'
import { planPageContoursSchema } from '../lib/projects/plan-page-review'

type Chain = { textItemIndexes: number[]; segmentsMm: number[] }
type Fixture = {
  source: { sha256: string; pdfPage: number; state: 'existing' }
  room: {
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
}

const [pdfPath, fixturePath] = process.argv.slice(2)
if (!pdfPath || !fixturePath) {
  throw new Error('Usage: bun run scripts/qa-independent-metric-room.ts <PDF> <fixture.json>')
}
const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as Fixture
const body = await readFile(pdfPath)
const sha256 = createHash('sha256').update(body).digest('hex')
if (fixture.source.state !== 'existing' || sha256 !== fixture.source.sha256) {
  throw new Error('The PDF does not match the reviewed existing-state fixture.')
}
const page = await preparePlanPage(body, true, fixture.source.pdfPage, true)
if (!page.linework || !page.image.planText) throw new Error('Native geometry or text is missing.')

const { room, source } = fixture
const contours = planPageContoursSchema.parse({
  source,
  coordinateSystem: 'page-0-1000',
  review: 'manual-source-review',
  pageWidth: page.linework.pageWidth,
  pageHeight: page.linework.pageHeight,
  rooms: [{ roomSourceNumber: room.sourceNumber, polygon: room.polygon }],
})
const evidence = (kind: 'horizontal-chain' | 'vertical-chain', chain: Chain) => ({
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
  rooms: [
    {
      sourceNumber: room.sourceNumber,
      name: room.name,
      kind: room.kind,
      areaM2: room.areaM2,
      widthCm: room.widthMm / 10,
      depthCm: room.depthMm / 10,
      measurementEvidence: {
        width: evidence('horizontal-chain', room.width),
        depth: evidence('vertical-chain', room.depth),
      },
    },
  ],
}
const result = planPageMetricDraft(
  reading,
  { source, contours, linework: page.linework, planText: page.image.planText },
  [room.sourceNumber],
)
if (!result.ok) throw new Error(result.error)
const geometryIssues = inspectPlanGeometry(result.geometry)
if (geometryIssues.length > 0) throw new Error(`Geometry issues: ${JSON.stringify(geometryIssues)}`)
const polygon = result.geometry.rooms[0]?.polygon
if (!polygon) throw new Error('No room was transferred.')

console.log(
  JSON.stringify({
    sourcePage: source.pdfPage,
    sourceSha256: sha256,
    roomSourceNumber: room.sourceNumber,
    printedWidthMm: room.widthMm,
    printedDepthMm: room.depthMm,
    polygon,
    geometryIssues: geometryIssues.length,
    paidCalls: 0,
  }),
)
