import { deepStrictEqual } from 'node:assert'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { planMeasurementTextItems } from '@uyut/ai'
import type { PlanPageContours, PlanReading } from '@uyut/db'
import { preparePlanPage } from '../lib/projects/plan-document'
import { planPageMetricDraft } from '../lib/projects/plan-page-metric-draft'
import { planPageReviewIssue } from '../lib/projects/plan-page-review'
import { pdfDimensionForEdge } from '../lib/projects/plan-pdf-edge-dimension'

const [pdfPath, outputArgument] = process.argv.slice(2)
if (!pdfPath || !outputArgument) throw new Error('Укажите синтетический PDF и путь отчёта')
const outputPath = resolve(outputArgument)
const body = await readFile(pdfPath)
const page = await preparePlanPage(body, true, 1, true)
if (!page.linework) throw new Error('Не удалось прочитать нативные линии')
const source = {
  sha256: createHash('sha256').update(body).digest('hex'),
  pdfPage: 1,
  state: 'existing' as const,
}
// Normalized coordinates of the explicitly authored synthetic source, not detected rooms.
const rectangle = (left: number, bottom: number, width: number, height: number) =>
  (
    [
      [left, bottom + height],
      [left + width, bottom + height],
      [left + width, bottom],
      [left, bottom],
    ] as Array<[number, number]>
  ).map(([x, y]) => ({
    x: Math.round((x / 600) * 1e6) / 1000,
    y: (500 - y) * 2,
  }))
const labels = planMeasurementTextItems(page.image.planText) ?? []
const labelIndex = (text: string) => {
  const index = labels.findIndex((item) => item.text === text)
  if (index < 0) throw new Error(`Не найдена подпись ${text}`)
  return index
}
const contours: PlanPageContours = {
  source,
  coordinateSystem: 'page-0-1000',
  review: 'manual-source-review',
  pageWidth: 600,
  pageHeight: 500,
  rooms: [
    {
      roomSourceNumber: 1,
      polygon: rectangle(140, 140, 320, 220),
      dimensionEdges: [
        { wallEdgeIndex: 0, labelIndexes: [labelIndex('3200')] },
        { wallEdgeIndex: 3, labelIndexes: [labelIndex('2200')] },
      ],
    },
  ],
  exterior: {
    boundaryRole: 'outer-wall-envelope',
    polygon: rectangle(100, 100, 400, 300),
  },
}
const reading: PlanReading = {
  sourcePage: 1,
  planState: 'existing',
  readAt: '2026-10-03',
  rooms: [{ sourceNumber: 1, name: 'Контрольная гостиная', kind: 'living' }],
}
const context = {
  source,
  linework: page.linework,
  planText: page.image.planText,
  useEdgeDimensions: true,
}
const issue = planPageReviewIssue(contours, reading, source, page.linework)
if (issue) throw new Error(issue)
for (const edge of contours.rooms[0]?.dimensionEdges ?? []) {
  const selected = labels.flatMap((label, index) =>
    edge.labelIndexes.includes(index) && label.x !== undefined && label.y !== undefined
      ? [{ ...label, index, x: label.x, y: label.y }]
      : [],
  )
  const binding = pdfDimensionForEdge(
    page.linework,
    source,
    contours,
    { roomSourceNumber: 1 },
    edge,
    selected,
  )
  if (binding.status !== 'candidate') throw new Error(JSON.stringify({ edge, binding }))
}
const draft = planPageMetricDraft(reading, { ...context, contours }, [1])
if (!draft.ok) throw new Error(draft.error)
const floor = { polygon: rectangle(110, 110, 380, 280) }
const withFloor = { ...contours, floor }
const floorIssue = planPageReviewIssue(withFloor, reading, source, page.linework)
if (floorIssue) throw new Error(floorIssue)
const floorDraft = planPageMetricDraft(reading, { ...context, contours: withFloor }, [1])
if (!floorDraft.ok) throw new Error(floorDraft.error)
if (JSON.stringify(draft.geometry.walls) !== JSON.stringify(floorDraft.geometry.walls))
  throw new Error('Отдельный пол добавил или изменил стены')
// Independent metric expectations from the authored source (3200 mm / 320 pt).
deepStrictEqual([floorDraft.geometry.widthCm, floorDraft.geometry.heightCm], [400, 300])
deepStrictEqual(floorDraft.geometry.footprint, [
  { xCm: 10, yCm: 10 },
  { xCm: 390, yCm: 10 },
  { xCm: 390, yCm: 290 },
  { xCm: 10, yCm: 290 },
])
deepStrictEqual(floorDraft.geometry.rooms[0]?.polygon, [
  { xCm: 40, yCm: 40 },
  { xCm: 360, yCm: 40 },
  { xCm: 360, yCm: 260 },
  { xCm: 40, yCm: 260 },
])
deepStrictEqual(floorDraft.geometry.walls.length, 8)
await mkdir(dirname(outputPath), { recursive: true })
await writeFile(`${outputPath}.jpg`, page.image.body)
await writeFile(
  `${outputPath}.fixture.json`,
  JSON.stringify({ source, rooms: reading.rooms, synthetic: true }, null, 2),
)
await writeFile(
  outputPath,
  JSON.stringify(
    { source, savedContours: contours, sourceRooms: [], draft, floor, floorDraft },
    null,
    2,
  ),
)
console.log(
  JSON.stringify({
    ok: true,
    source,
    floorVertices: floor.polygon,
    walls: floorDraft.geometry.walls.length,
  }),
)
