/** Fresh-source, local-only QA. No AI calls, database writes or production deployment. */
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { reconcilePlanGeometryRooms } from '@uyut/ai'
import { WALKWAY_CM } from '@uyut/catalog'
import type { PlanPageContours, PlanReading } from '@uyut/db'
import { renderToStaticMarkup } from 'react-dom/server'
import reference from '../../../docs/qa/fixtures/apartment-74-77.json'
import complete from '../../../docs/qa/fixtures/apartment-74-77-complete-page.json'
import chains from '../../../docs/qa/fixtures/apartment-74-77-page-contours.json'
import { PlanGeometryPreview } from '../components/plan-geometry-preview'
import { preparePlanPage } from '../lib/projects/plan-document'
import { inspectDoorAdjacency } from '../lib/projects/plan-door-adjacency'
import {
  inspectManualPlanCompleteness,
  inspectPlanGeometry,
  inspectPlanRoomAreas,
} from '../lib/projects/plan-geometry-inspection'
import { inspectPlanPageClearanceRoutes } from '../lib/projects/plan-page-clearance-route'
import { inspectPlanPageDoorAccess } from '../lib/projects/plan-page-door-access'
import { inspectPlanPageDoorFloorConnectivity } from '../lib/projects/plan-page-door-floor-connectivity'
import { planPageMetricDraft } from '../lib/projects/plan-page-metric-draft'
import { planPageContoursSchema } from '../lib/projects/plan-page-review'
import { pairPlanPageOpeningFaces } from '../lib/projects/plan-pdf-opening-faces'
import { findPlanPagePaintedBoundarySpans } from '../lib/projects/plan-pdf-painted-boundary'
import {
  inspectPaintedBodyBoundarySpans,
  inspectPlanPagePaintedWallSolids,
  supportsOnPaintedBodyBoundary,
} from '../lib/projects/plan-pdf-painted-solids'
import {
  classifyPlanPageWallSpans,
  planPageWallReviewQueue,
} from '../lib/projects/plan-pdf-wall-coverage'
import { pairPlanPageWallFaces } from '../lib/projects/plan-pdf-wall-faces'
import { inspectPlanPageWallSolids } from '../lib/projects/plan-pdf-wall-solids'

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
const cmPerPoint = result.geometry.pdfCalibration?.cmPerPoint
if (!cmPerPoint) throw new Error('Отсутствует подтверждённый масштаб контрольного листа.')
const wallCoverage = classifyPlanPageWallSpans(
  contours,
  pairPlanPageWallFaces(page.linework, source, contours),
  complete.apartmentEnvelope.logicalOpeningClosures,
)
const wallCoverageCounts = Object.fromEntries(
  [
    'paired',
    'opening',
    'conditional',
    'unmatched',
    'unpaired-exterior',
    'ambiguous',
    'unsupported-angle',
  ].map((status) => [status, wallCoverage.filter((span) => span.status === status).length]),
)
const lineworkPaths = page.linework.paths
const paintedTriangleCounts = Object.fromEntries(
  [...new Set(lineworkPaths.map((path) => path.fillColor).filter((color) => color))]
    .sort()
    .map((color) => [
      color,
      lineworkPaths.filter(
        (path) =>
          path.paint === 'fill-stroke' && path.points.length === 3 && path.fillColor === color,
      ).length,
    ]),
)
const wallReviewQueue = planPageWallReviewQueue(contours, wallCoverage, cmPerPoint)
const exteriorWallReviewQueue = planPageWallReviewQueue(
  contours,
  wallCoverage,
  cmPerPoint,
  'exterior',
)
// This color is manually reviewed for this source page, not inferred for other PDFs.
const paintedBoundarySupports = findPlanPagePaintedBoundarySpans(
  page.linework,
  source,
  contours,
  wallCoverage,
  '#989898',
)
const paintedWallAudit = inspectPlanPagePaintedWallSolids(
  page.linework,
  source,
  contours,
  '#989898',
  complete.rooms.flatMap((room) =>
    'fixedVolumes' in room && room.fixedVolumes
      ? room.fixedVolumes.map((volume) => ({
          id: volume.id,
          kind: 'fixed' as const,
          polygon: volume.polygon,
        }))
      : [],
  ),
)
if (!paintedWallAudit) {
  console.log(
    JSON.stringify({
      status: 'blocked-source',
      sourcePage: source.pdfPage,
      sourceSha256: source.sha256,
      vectorOmissions: {
        clippedPaths: page.linework.clippedPaths,
        skippedCurves: page.linework.skippedCurves,
      },
      confirmationReady: false,
      reason:
        'Нативный слой не позволяет проверить целые тела стен. Пропущенные участки нельзя замыкать по изображению.',
      paidCalls: 0,
    }),
  )
  process.exit(1)
}
const paintedBodyBoundarySupports = supportsOnPaintedBodyBoundary(
  paintedWallAudit.body,
  paintedBoundarySupports,
)
const boundaryKey = (span: {
  contourKey: string
  wallEdgeIndex: number
  start: { x: number; y: number }
  end: { x: number; y: number }
}) =>
  [span.contourKey, span.wallEdgeIndex, span.start.x, span.start.y, span.end.x, span.end.y].join(
    ':',
  )
const paintedBoundaryKeys = new Set(paintedBodyBoundarySupports.map(boundaryKey))
const unresolvedBoundarySpans = [...wallReviewQueue, ...exteriorWallReviewQueue].filter(
  (span) => !paintedBoundaryKeys.has(boundaryKey(span)),
)
const paintedUnionBoundaryAudit = inspectPaintedBodyBoundarySpans(
  paintedWallAudit.body,
  contours,
  unresolvedBoundarySpans,
)
const remainingBoundarySpans = paintedUnionBoundaryAudit.filter(
  (assessment) => assessment.status !== 'supported',
)
const sourceStrokeEvidence = remainingBoundarySpans.map(({ span, status }) => {
  const zone =
    span.contourKey === 'exterior'
      ? contours.exterior
      : contours.rooms.find(
          (room) =>
            (room.roomSourceNumbers ?? [room.roomSourceNumber]).join('+') === span.contourKey,
        )
  const edgeStart = zone?.polygon[span.wallEdgeIndex]
  const edgeEnd = zone?.polygon[(span.wallEdgeIndex + 1) % zone.polygon.length]
  if (!edgeStart || !edgeEnd) throw new Error('Reviewed boundary edge is missing.')
  const axis =
    Math.abs(span.end.x - span.start.x) >= Math.abs(span.end.y - span.start.y) ? 'x' : 'y'
  const low = Math.min(span.start[axis], span.end[axis])
  const high = Math.max(span.start[axis], span.end[axis])
  const turn = (point: { x: number; y: number }) =>
    (edgeEnd.x - edgeStart.x) * (point.y - edgeStart.y) -
    (edgeEnd.y - edgeStart.y) * (point.x - edgeStart.x)
  const contacts =
    page.linework?.paths.flatMap((path) => {
      if (path.paint !== 'stroke') return []
      return path.points.slice(0, -1).flatMap((start, segmentIndex) => {
        const end = path.points[segmentIndex + 1]
        if (!end || turn(start) !== 0 || turn(end) !== 0) return []
        const begin = Math.max(low, Math.min(start[axis], end[axis]))
        const finish = Math.min(high, Math.max(start[axis], end[axis]))
        return begin < finish
          ? [
              {
                begin,
                finish,
                source: {
                  operationIndex: path.operationIndex,
                  subpathIndex: path.subpathIndex,
                  segmentIndex,
                },
              },
            ]
          : []
      })
    }) ?? []
  contacts.sort((a, b) => a.begin - b.begin || b.finish - a.finish)
  let coveredUntil = low
  const sourceSegments: (typeof contacts)[number]['source'][] = []
  for (const contact of contacts) {
    if (contact.begin > coveredUntil) break
    if (contact.finish <= coveredUntil) continue
    coveredUntil = contact.finish
    sourceSegments.push(contact.source)
    if (coveredUntil >= high) break
  }
  return { span, status, strokeCoversSpan: coveredUntil >= high, sourceSegments }
})
if (sourceStrokeEvidence.some((evidence) => !evidence.strokeCoversSpan)) {
  throw new Error(
    `Reviewed source stroke evidence changed: ${JSON.stringify(sourceStrokeEvidence.map(({ span, strokeCoversSpan }) => ({ contourKey: span.contourKey, wallEdgeIndex: span.wallEdgeIndex, strokeCoversSpan })))}`,
  )
}
const unionStatusCounts = {
  supported: paintedUnionBoundaryAudit.filter((assessment) => assessment.status === 'supported')
    .length,
  oppositeSide: paintedUnionBoundaryAudit.filter(
    (assessment) => assessment.status === 'opposite-side',
  ).length,
  noBoundary: paintedUnionBoundaryAudit.filter((assessment) => assessment.status === 'no-boundary')
    .length,
}
if (
  unionStatusCounts.supported !== 3 ||
  unionStatusCounts.oppositeSide !== 3 ||
  unionStatusCounts.noBoundary !== 2
) {
  throw new Error('Reviewed source boundary evidence changed; recheck the original sheet.')
}
const reconciled = reconcilePlanGeometryRooms(
  { ...result.geometry, obstacles: result.geometry.obstacles ?? [] },
  reading.rooms,
)
const checked = reconciled ? { ...result.geometry, rooms: reconciled.rooms } : result.geometry
const geometryIssues = inspectPlanGeometry(checked)
const confirmationIssues = [
  ...inspectManualPlanCompleteness(checked),
  ...inspectPlanRoomAreas(checked.rooms, reading.rooms),
]
const doorAdjacency = inspectDoorAdjacency(result.geometry)
const doorFloorConnectivity = inspectPlanPageDoorFloorConnectivity(contours, paintedWallAudit.body)
const clearanceRoutes = inspectPlanPageClearanceRoutes(
  contours,
  paintedWallAudit.body,
  page.linework,
  cmPerPoint,
  WALKWAY_CM,
)
const doorAccess = inspectPlanPageDoorAccess(result.geometry, contours, clearanceRoutes)
if (doorAccess.length !== 6 || doorAccess.some((link) => link.status !== 'both-entry-clear')) {
  throw new Error('Проверка входных площадок изменилась — сверить обе стороны исходных дверей.')
}
const output = resolve('../../output/playwright/complete-metric')
await mkdir(output, { recursive: true })
const report = {
  wallSolids: inspectPlanPageWallSolids(page.linework, source, contours),
  source,
  nativePaths: page.linework.paths.length,
  geometry: result.geometry,
  geometryIssues,
  doorAdjacency,
  doorFloorConnectivity,
  clearanceRoutes,
  doorAccess,
  openingFacePairs: pairPlanPageOpeningFaces(page.linework, source, contours),
  wallFacePairs: result.geometry.pdfCalibration?.wallFacePairs,
  wallCoverage,
  wallCoverageCounts,
  paintedTriangleCounts,
  exteriorOpeningClosures: complete.apartmentEnvelope.logicalOpeningClosures,
  wallReviewQueue,
  exteriorWallReviewQueue,
  paintedBoundarySupports,
  paintedBodyBoundarySupports,
  unresolvedBoundarySpans,
  paintedUnionBoundaryAudit,
  unionStatusCounts,
  remainingBoundarySpans,
  sourceStrokeEvidence,
  paintedWallAudit,
  confirmationIssues,
  sourceBoundaryChecksPass: remainingBoundarySpans.length === 0,
  localConfirmationChecksPass:
    reconciled !== undefined &&
    reconciled.rooms.length === result.geometry.rooms.length &&
    ![...geometryIssues, ...confirmationIssues].some((issue) => issue.severity === 'error'),
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
await writeFile(resolve(output, 'source-page-6.jpg'), page.image.body)
const reviewLabels: Record<string, string> = {
  '4': 'Спальня №4 - торец у входа',
  '2': 'Кухня №2 - нижний правый стык',
  '1+5': 'Прихожая и коридор - диагональный стык',
  exterior: 'Внешний контур - участок у входа',
}
const reviewMarkers = sourceStrokeEvidence.map(({ span }, index) => {
  const middleX = (span.start.x + span.end.x) / 2
  const middleY = (span.start.y + span.end.y) / 2
  return `
    <g>
      <circle cx="${middleX}" cy="${middleY}" r="9" fill="#b42345" stroke="white" stroke-width="2"/>
      <text x="${middleX}" y="${middleY + 3}" text-anchor="middle" fill="white" font-size="9" font-family="Arial">${index + 1}</text>
    </g>`
})
const reviewCards = sourceStrokeEvidence.map(({ span, status, sourceSegments }, index) => {
  const middleX = (span.start.x + span.end.x) / 2
  const middleY = (span.start.y + span.end.y) / 2
  const note =
    status === 'opposite-side'
      ? 'Заливка находится с другой стороны проверяемой линии.'
      : 'Край заливки не совпадает с исходной линией.'
  const operations = [...new Set(sourceSegments.map((segment) => segment.operationIndex))].join(
    ', ',
  )
  return `
    <article>
      <div>
        <h2>${index + 1}. ${reviewLabels[span.contourKey] ?? span.contourKey}</h2>
        <p>${note} Исходный штрих: операция PDF ${operations}. Нужно подтвердить, где проходит физическая грань стены; длина выделения не является обмером.</p>
      </div>
      <svg viewBox="${middleX - 35} ${middleY - 35} 70 70" preserveAspectRatio="none" role="img" aria-label="Увеличение спорного участка ${index + 1}">
        <image href="source-page-6.jpg" width="1000" height="1000" preserveAspectRatio="none"/>
        <line x1="${span.start.x}" y1="${span.start.y}" x2="${span.end.x}" y2="${span.end.y}" stroke="#b42345" stroke-width="5" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
        <circle cx="${middleX}" cy="${middleY}" r="2" fill="#b42345"/>
      </svg>
    </article>`
})
const reviewStyles = `
  body { margin: 0; background: #f6f2ed; color: #251e1a; font: 16px/1.5 Arial, sans-serif; }
  main { max-width: 1100px; margin: auto; padding: 24px; }
  h1 { font-size: 30px; line-height: 1.15; }
  p { max-width: 65ch; }
  .lead { color: #5d5550; }
  .layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(320px, 1fr); gap: 24px; align-items: start; }
  .page, .cards article { background: white; border: 1px solid #d9d0c8; box-shadow: 0 2px 9px #251e1a12; }
  .page { width: 100%; aspect-ratio: ${page.linework.pageWidth}/${page.linework.pageHeight}; }
  .cards { display: grid; gap: 12px; }
  .cards article { padding: 14px; display: grid; grid-template-columns: 1fr 150px; gap: 12px; }
  .cards h2 { font-size: 17px; margin: 0 0 8px; }
  .cards p { font-size: 13px; margin: 0; }
  .cards svg { width: 150px; height: 150px; border: 1px solid #d9d0c8; }
  .request { margin-top: 24px; padding: 16px 20px; background: white; border: 1px solid #d9d0c8; }
  .request h2 { margin: 0 0 8px; font-size: 20px; }
  .request ol { margin: 8px 0 0; padding-left: 22px; }
  .request li { margin: 6px 0; }
  @media (max-width: 760px) {
    .layout { grid-template-columns: 1fr; }
    .cards article { grid-template-columns: 1fr 120px; }
    .cards svg { width: 120px; height: 120px; }
  }
  @page { size: A4; margin: 15mm; }
  @media print {
    body { background: white; font-size: 12px; }
    main { max-width: none; padding: 0; }
    h1 { font-size: 24px; }
    .layout { display: block; }
    .page { display: block; width: min(100%, 140mm); margin: 14px auto 22px; }
    .cards { grid-template-columns: 1fr 1fr; }
    .cards article { break-inside: avoid; box-shadow: none; grid-template-columns: 1fr 80px; }
    .cards svg { width: 80px; height: 80px; }
    .request { break-inside: avoid; }
  }`
await writeFile(
  resolve(output, 'source-review.html'),
  `<!doctype html>
  <html lang="ru">
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Пять участков для уточнения - лист 03</title>
    <style>${reviewStyles}</style>
    <main>
      <p class="lead">Локальная проверка · обмерный лист 03 · существующее состояние</p>
      <h1>Участки, где нужна проверенная грань стены</h1>
      <p>Это карта вопросов к источнику, а не исправленный план. Красные метки показывают спорные места; по одному PDF нельзя выбирать толщину стены или подменять её соседней линией.</p>
      <div class="layout">
        <svg class="page" viewBox="0 0 1000 1000" preserveAspectRatio="none" role="img" aria-label="Исходный обмерный план с пятью спорными местами">
          <image href="source-page-6.jpg" width="1000" height="1000" preserveAspectRatio="none"/>
          ${reviewMarkers.join('')}
        </svg>
        <div class="cards">${reviewCards.join('')}</div>
      </div>
      <section class="request">
        <h2>Что запросить у автора обмера или обмерщика</h2>
        <ol>
          <li>Обмерный DWG/IFC существующего состояния с физическими гранями стен, коробами и проёмами; либо этот лист с проверенной разметкой всех пяти пронумерованных мест.</li>
          <li>Для каждого места - какая линия является гранью стены со стороны комнаты, где находится тело стены и его толщина. Для диагональных стыков - точки начала и конца, привязанные к соседним стенам.</li>
          <li>У входа - положение двери и граница наружной стены. Технические короба отмечать отдельно от стен. Если мерка не известна, так и указать; приблизительное число не требуется.</li>
        </ol>
        <p>Нужен именно исходный обмер, не проектная перепланировка. После получения проверим его заново: решение этих пяти мест само по себе ещё не доказывает точность всех остальных стен и проёмов.</p>
      </section>
    </main>
  </html>`,
)
console.log(
  JSON.stringify({
    output,
    physicalZones: result.geometry.rooms.length,
    openingAnnotations: result.geometry.openings.length,
    openingFacePairs: report.openingFacePairs.length,
    provenDoorLinks: doorAdjacency.links.length,
    provenZoneGroups: doorAdjacency.provenGroups.length,
    bothSideDoorEntries: doorAccess.filter((link) => link.status === 'both-entry-clear').length,
    doorFloorConnectivity: doorFloorConnectivity.map(
      ({ contourKey, status, freeComponentCount }) => ({
        contourKey,
        status,
        freeComponentCount,
      }),
    ),
    clearanceRoutes: clearanceRoutes.map(({ contourKey, status, reason, reachedDoorIds }) => ({
      contourKey,
      status,
      reason,
      reachedDoorIds,
    })),
    wallFacePairs: report.wallFacePairs?.length,
    wallCoverageCounts,
    paintedTriangleCounts,
    interiorReviewSpans: wallReviewQueue.length,
    exteriorReviewSpans: exteriorWallReviewQueue.length,
    paintedInteriorSupports: paintedBoundarySupports.filter(
      (support) => support.contourKey !== 'exterior',
    ).length,
    paintedExteriorSupports: paintedBoundarySupports.filter(
      (support) => support.contourKey === 'exterior',
    ).length,
    paintedBodyBoundarySupports: paintedBodyBoundarySupports.length,
    unresolvedBoundarySpans: unresolvedBoundarySpans.length,
    unionStatusCounts,
    remainingBoundarySpans: remainingBoundarySpans.length,
    sourceStrokeSupportedRemainders: sourceStrokeEvidence.filter(
      (evidence) => evidence.strokeCoversSpan,
    ).length,
    paintedBodyComponents: paintedWallAudit.body.length,
    acceptedPaintTriangles: paintedWallAudit.acceptedSources.length,
    degeneratePaintTriangles: paintedWallAudit.degenerateSources.length,
    outsidePaintTriangles: paintedWallAudit.outsideSources.length,
    crossingPaintTriangles: paintedWallAudit.crossingSources.length,
    paintedRoomFloorConflicts: paintedWallAudit.roomFloorConflicts.map((conflict) => ({
      contourKey: conflict.contourKey,
      areaPageSquared: conflict.areaPageSquared,
    })),
    paintedOpeningPenetrations: paintedWallAudit.openingPenetrations.map((conflict) => ({
      contourKey: conflict.contourKey,
      openingId: conflict.openingId,
      kind: conflict.kind,
      triangleCount: conflict.paintedSources.length,
    })),
    paintedReviewedRegionOverlaps: paintedWallAudit.reviewedRegionOverlaps.map((conflict) => ({
      id: conflict.id,
      kind: conflict.kind,
      areaPageSquared: conflict.areaPageSquared,
    })),
    derivedOpeningWidths: result.geometry.pdfCalibration?.derivedOpeningIds.length,
    geometryIssues: report.geometryIssues.length,
    confirmationIssues: report.confirmationIssues.length,
    sourceBoundaryChecksPass: report.sourceBoundaryChecksPass,
    localConfirmationChecksPass: report.localConfirmationChecksPass,
    paidCalls: 0,
  }),
)
if (
  process.argv.includes('--strict') &&
  (!report.localConfirmationChecksPass || !report.sourceBoundaryChecksPass)
) {
  process.exitCode = 1
}
