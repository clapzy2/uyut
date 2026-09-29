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
if (!paintedWallAudit) throw new Error('Source-painted wall audit unavailable')
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
console.log(
  JSON.stringify({
    output,
    physicalZones: result.geometry.rooms.length,
    openingAnnotations: result.geometry.openings.length,
    openingFacePairs: report.openingFacePairs.length,
    provenDoorLinks: doorAdjacency.links.length,
    provenZoneGroups: doorAdjacency.provenGroups.length,
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
