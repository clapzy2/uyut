/** Fresh-source, local-only QA. No AI calls, database writes or production deployment. */
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { PlanPageContours, PlanReading } from '@uyut/db'
import { renderToStaticMarkup } from 'react-dom/server'
import reference from '../../../docs/qa/fixtures/apartment-74-77.json'
import complete from '../../../docs/qa/fixtures/apartment-74-77-complete-page.json'
import chains from '../../../docs/qa/fixtures/apartment-74-77-page-contours.json'
import { PlanGeometryPreview } from '../components/plan-geometry-preview'
import { preparePlanPage } from '../lib/projects/plan-document'
import {
  inspectManualPlanCompleteness,
  inspectPlanGeometry,
} from '../lib/projects/plan-geometry-inspection'
import { planPageMetricDraft } from '../lib/projects/plan-page-metric-draft'
import { planPageContoursSchema } from '../lib/projects/plan-page-review'
import { pairPlanPageOpeningFaces } from '../lib/projects/plan-pdf-opening-faces'
import { classifyPlanPageWallSpans } from '../lib/projects/plan-pdf-wall-coverage'
import { pairPlanPageWallFaces } from '../lib/projects/plan-pdf-wall-faces'

const sourcePath = process.argv[2]
if (!sourcePath || sourcePath.startsWith('--')) throw new Error('Укажите исходный PDF.')
const body = await readFile(sourcePath)
const source = {
  sha256: createHash('sha256').update(body).digest('hex'),
  pdfPage: 6,
  state: 'existing' as const,
}
if (source.sha256 !== complete.source.sha256) throw new Error('Fixture source hash mismatch')
const page = await preparePlanPage(body, true, source.pdfPage, true)
if (!page.linework || !page.image.planText) throw new Error('Missing native page data')
const anchor = chains.rooms.find((room) => room.roomSourceNumber === 4)
if (!anchor) throw new Error('Missing calibration anchor')
const labels = JSON.parse(page.image.planText) as Array<{ text: string }>
const reading: PlanReading = {
  readAt: new Date().toISOString(),
  sourcePage: 6,
  planState: 'existing',
  rooms: reference.rooms.map((room) => ({
    sourceNumber: room.number,
    name: room.number === 4 || room.number === 6 ? `${room.name} №${room.number}` : room.name,
    kind:
      room.number === 2 ? 'kitchen' : room.number === 4 || room.number === 6 ? 'bedroom' : 'living',
    areaM2: room.areaM2,
    ...(room.widthMm === null ? {} : { widthCm: room.widthMm / 10 }),
    ...(room.depthMm === null ? {} : { depthCm: room.depthMm / 10 }),
    ...(room.number === 4
      ? {
          measurementEvidence: {
            width: {
              kind: 'horizontal-chain',
              scope: 'room',
              sourceNumber: 4,
              complete: true,
              textItemIndexes: anchor.widthLabels,
              segmentsMm: anchor.widthLabels.map((index) => Number(labels[index]?.text)),
            },
            depth: {
              kind: 'vertical-chain',
              scope: 'room',
              sourceNumber: 4,
              complete: true,
              textItemIndexes: anchor.depthLabels,
              segmentsMm: anchor.depthLabels.map((index) => Number(labels[index]?.text)),
            },
          },
        }
      : {}),
  })),
}
const contours: PlanPageContours = planPageContoursSchema.parse({
  source,
  coordinateSystem: complete.coordinateSystem,
  review: complete.review,
  pageWidth: complete.pageWidth,
  pageHeight: complete.pageHeight,
  exterior: { polygon: complete.apartmentEnvelope.polygon },
  rooms: complete.rooms.map((room) => ({
    ...('roomSourceNumbers' in room
      ? { roomSourceNumbers: room.roomSourceNumbers }
      : { roomSourceNumber: room.roomSourceNumber }),
    polygon: room.polygon,
    openings: room.openings.map((opening) => ({
      id: opening.id,
      kind: opening.kind,
      wallEdgeIndex: opening.wallEdgeIndex,
      start: opening.start,
      end: opening.end,
      ...('endpointProofs' in opening ? { endpointProofs: opening.endpointProofs } : {}),
    })),
  })),
})
const result = planPageMetricDraft(
  reading,
  {
    source,
    contours,
    linework: page.linework,
    planText: page.image.planText,
    calibrationRoomNumbers: [4],
  },
  reference.rooms.map((room) => room.number),
)
if (!result.ok) throw new Error(result.error)
const wallCoverage = classifyPlanPageWallSpans(
  contours,
  pairPlanPageWallFaces(page.linework, source, contours),
)
const wallCoverageCounts = Object.fromEntries(
  ['paired', 'opening', 'unmatched', 'ambiguous', 'unsupported-angle'].map((status) => [
    status,
    wallCoverage.filter((span) => span.status === status).length,
  ]),
)
const output = resolve('../../output/playwright/complete-metric')
await mkdir(output, { recursive: true })
const report = {
  source,
  nativePaths: page.linework.paths.length,
  geometry: result.geometry,
  geometryIssues: inspectPlanGeometry(result.geometry),
  openingFacePairs: pairPlanPageOpeningFaces(page.linework, source, contours),
  wallFacePairs: result.geometry.pdfCalibration?.wallFacePairs,
  wallCoverage,
  wallCoverageCounts,
  confirmationIssues: inspectManualPlanCompleteness(result.geometry),
  unresolvedSourceFeatures: complete.unresolvedFeatures,
  qualification:
    'Manual source annotation, not automatic recognition accuracy. Draft only; source measurements not replaced by contour bounds.',
  paidCalls: 0,
}
await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2))
const stylesDir = resolve('.next/static/chunks')
const styles = (await readdir(stylesDir)).filter((name) => name.endsWith('.css'))
const css = (
  await Promise.all(styles.map((name) => readFile(resolve(stylesDir, name), 'utf8')))
).join('\n')
const preview = renderToStaticMarkup(<PlanGeometryPreview geometry={result.geometry} />)
await writeFile(
  resolve(output, 'preview.html'),
  `<!doctype html><html lang="ru" data-theme="light"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Полная квартира — локальная 2D-проверка</title><style>${css}</style><body><main style="max-width:1200px;margin:auto;padding:24px"><p>Локальная проверка исходного листа 03 · не production</p>${preview}<p>Кухонное окно и балконная дверь разделены по проверенному пересечению исходных линий. Это не подтверждённая расстановка.</p></main></body></html>`,
)
console.log(
  JSON.stringify({
    output,
    physicalZones: result.geometry.rooms.length,
    openingAnnotations: result.geometry.openings.length,
    openingFacePairs: report.openingFacePairs.length,
    wallFacePairs: report.wallFacePairs?.length,
    wallCoverageCounts,
    derivedOpeningWidths: result.geometry.pdfCalibration?.derivedOpeningIds.length,
    geometryIssues: report.geometryIssues.length,
    confirmationIssues: report.confirmationIssues.length,
    paidCalls: 0,
  }),
)
