import type { PlanReading } from '@uyut/db'
import type { NativeTextAnchors } from './plan-document'
import { automaticNativeDimensionRoles } from './plan-native-dimension-roles'
import { nativeFaceAnnotationCandidates } from './plan-native-face-annotations'
import { nativeNumberCircleCandidates } from './plan-native-number-circles'
import { nativeOpeningSourceLinks } from './plan-native-opening-links'
import { nativeReviewedFrameRooms } from './plan-native-reviewed-frame-rooms'
import { automaticNativeRoomCandidates, nativeRoomPolygonKey } from './plan-native-room-candidates'
import {
  inspectReviewedPageCoverage,
  type ReviewedPageCoverage,
} from './plan-page-reviewed-coverage'
import type { PdfLinework } from './plan-pdf-linework'
import type { PdfPlanSource } from './plan-pdf-room-binding'
import { bindObservedRegionLabels, type RegionLabelFrame } from './plan-raster-region-labels'

export type NativeReviewPacket = {
  version: 1
  coordinateSystem: 'rendered-image-pixels'
  status: 'draft' | 'unresolved'
  source: PdfPlanSource
  image: RegionLabelFrame
  sourceRevision?: string
  extraction: {
    textComplete: boolean
    geometryComplete: boolean
    skippedCurves: number
    clippedPaths: number
  }
  counts: {
    fillCandidates: number
    strokeFaces: number
    annotationHints: number
    numberedAssociations: number
    printedDimensions: number
  }
  faces: {
    id: string
    layer: 'fill' | 'stroke'
    polygon: { x: number; y: number }[]
    annotationHint: boolean
    roomName?: string
  }[]
  doorSymbols?: {
    status: 'draft' | 'unresolved'
    refusalReason: string | null
    candidates: {
      id: string
      arc: {
        start: { x: number; y: number }
        segments: {
          control1: { x: number; y: number }
          control2: { x: number; y: number }
          end: { x: number; y: number }
        }[]
      }
      leaf: { start: { x: number; y: number }; end: { x: number; y: number } }
      leafParts?: { start: { x: number; y: number }; end: { x: number; y: number } }[]
      leafProfile?: 'single-stroke' | 'capped-panel'
      swingAngleDegrees?: number
      endpointResidualPixels: number
    }[]
  }
  openingFrames?: {
    status: 'draft' | 'unresolved'
    refusalReason: string | null
    candidates: { id: string; polygon: { x: number; y: number }[] }[]
  }
  glazingSymbols?: {
    status: 'draft' | 'unresolved'
    refusalReason: string | null
    candidates: {
      id: string
      polygons: { x: number; y: number }[][]
      centerline: { start: { x: number; y: number }; end: { x: number; y: number } }
    }[]
  }
  sourceLinks?: {
    status: 'draft' | 'unresolved'
    refusalReason: string | null
    doors: {
      symbolId: string
      status: 'linked' | 'ambiguous' | 'unresolved'
      targetKind: 'opening-frame' | 'glazing-panel' | null
      targetId: string | null
      relation: 'jamb-to-frame' | 'shared-cap-edge' | null
    }[]
    glazing: { symbolId: string; status: 'two-sided' | 'ambiguous' | 'unresolved' }[]
    groups: { id: string; glazingIds: string[]; doorIds: string[] }[]
  }
  numberCircles?: {
    status: 'draft' | 'unresolved'
    refusalReason: string | null
    cues: { labelId: string; sourceNumber: number }[]
  }
  savedFrameRooms?:
    | { status: 'not-saved' }
    | { status: 'unavailable' | 'refused'; reason: string }
    | {
        status: 'checked'
        frames: {
          frameId: string
          status:
            | 'two-reviewed-sides'
            | 'one-reviewed-side'
            | 'coincident-sides'
            | 'ambiguous'
            | 'unresolved'
          sides: {
            roomSourceNumbers: number[]
            openingId: string
            kind: 'door' | 'window' | 'balcony'
            frameEdgeIndex: number
            numberCue: 'inside' | 'not-inside' | 'ambiguous' | 'unavailable'
          }[]
        }[]
      }
  issues: { code: string; message: string }[]
  readiness: { readyFor2D: false; readyFor3D: false; readOnly: true }
  savedReview:
    | { status: 'not-saved' }
    | { status: 'unavailable'; reason: 'native-layer-unavailable' | 'unsupported-review-version' }
    | { status: 'checked'; coverage: Omit<ReviewedPageCoverage, 'reviewSpans'> }
}

/** Whole-page inspection only. No reviews are invented; this packet is never PlanGeometry. */
export function nativeReviewPacket(input: {
  source: PdfPlanSource
  image: RegionLabelFrame
  native?: NativeTextAnchors
  work?: PdfLinework
  lineworkSource?: RegionLabelFrame
  savedReading?: PlanReading
}): NativeReviewPacket {
  const { source, image, native, work, lineworkSource } = input
  const packet: NativeReviewPacket = {
    version: 1,
    coordinateSystem: 'rendered-image-pixels',
    status: 'unresolved',
    source: { ...source },
    image: { ...image },
    extraction: {
      textComplete: native?.complete ?? false,
      geometryComplete: false,
      skippedCurves: work?.skippedCurves ?? 0,
      clippedPaths: work?.clippedPaths ?? 0,
    },
    counts: {
      fillCandidates: 0,
      strokeFaces: 0,
      annotationHints: 0,
      numberedAssociations: 0,
      printedDimensions: 0,
    },
    faces: [],
    issues: [],
    readiness: { readyFor2D: false, readyFor3D: false, readOnly: true },
    savedReview: { status: 'not-saved' },
    savedFrameRooms: { status: 'not-saved' },
  }
  const issue = (code: string, message: string) => packet.issues.push({ code, message })
  if (source.state !== 'existing' || source.pdfPage !== image.page)
    throw new Error('Native inspection requires the selected existing-state page')
  const savedReading = input.savedReading
  const review = savedReading?.pageReview
  if (review && savedReading) {
    packet.savedFrameRooms = {
      status: 'unavailable',
      reason: review.version !== 1 ? 'unsupported-review-version' : 'native-layer-unavailable',
    }
    if (review.version !== 1)
      packet.savedReview = { status: 'unavailable', reason: 'unsupported-review-version' }
    else if (!work)
      packet.savedReview = { status: 'unavailable', reason: 'native-layer-unavailable' }
    else {
      const { reviewSpans: _reviewSpans, ...coverage } = inspectReviewedPageCoverage({
        source,
        reading: savedReading,
        contours: review.contours,
        linework: work,
      })
      packet.savedReview = { status: 'checked', coverage }
    }
  }
  if (!native || !work || !lineworkSource) {
    issue(
      'native-layers-unavailable',
      'Нативные линии или подписи недоступны. Нужна отдельная сверка исходника.',
    )
    return packet
  }
  bindObservedRegionLabels({
    regionSource: image,
    labelSource: native.source,
    regions: [],
    labels: [],
  })
  bindObservedRegionLabels({
    regionSource: image,
    labelSource: lineworkSource,
    regions: [],
    labels: [],
  })
  if (native.originalPdfSha256 !== source.sha256)
    throw new Error('Native inspection source hash changed')
  const common = { native, work, lineworkSource }
  const circles = nativeNumberCircleCandidates(common)
  packet.numberCircles = {
    status: circles.status,
    refusalReason: circles.refusalReason,
    cues: circles.cues.map(({ labelId, sourceNumber }) => ({ labelId, sourceNumber })),
  }
  const correspondences = nativeReviewedFrameRooms({ ...common, source, reading: savedReading })
  if (correspondences.status === 'checked')
    packet.savedFrameRooms = { status: 'checked', frames: correspondences.frames }
  else if (correspondences.status === 'not-saved') packet.savedFrameRooms = { status: 'not-saved' }
  else
    packet.savedFrameRooms = {
      status: correspondences.status,
      reason: correspondences.reason ?? 'source-correspondence-unavailable',
    }
  const rooms = automaticNativeRoomCandidates(common)
  const annotations = nativeFaceAnnotationCandidates(common)
  const dimensions = automaticNativeDimensionRoles({ ...common, source })
  const connections = nativeOpeningSourceLinks(common)
  const doors = connections.doorSymbols
  const frames = connections.openingFrames
  packet.sourceLinks = {
    status: connections.status,
    refusalReason: connections.refusalReason,
    doors: connections.doorLinks.map(({ evidence: _evidence, ...link }) => link),
    glazing: connections.glazingLinks.map(({ symbolId, status }) => ({ symbolId, status })),
    groups: connections.groups.map(({ bridges: _bridges, ...group }) => group),
  }
  const scale = native.pageNormalizedScale
  if (scale) {
    const raster = (point: { x: number; y: number }) => ({
      x: point.x * scale.x,
      y: point.y * scale.y,
    })
    packet.doorSymbols = {
      status: doors.status,
      refusalReason: doors.refusalReason,
      candidates: doors.candidates.map((door) => ({
        id: door.id,
        arc: {
          start: raster(door.arc.start),
          segments: door.arc.segments.map((segment) => ({
            control1: raster(segment.control1),
            control2: raster(segment.control2),
            end: raster(segment.end),
          })),
        },
        leaf: { start: raster(door.leaf.start), end: raster(door.leaf.end) },
        ...(door.leafParts
          ? {
              leafParts: door.leafParts.map((part) => ({
                start: raster(part.start),
                end: raster(part.end),
              })),
            }
          : {}),
        leafProfile: door.leafProfile,
        swingAngleDegrees: door.swingAngleDegrees,
        endpointResidualPixels: door.endpointResidualPixels,
      })),
    }
    packet.openingFrames = {
      status: frames.status,
      refusalReason: frames.refusalReason,
      candidates: frames.candidates.map((candidate) => ({
        id: candidate.id,
        polygon: candidate.frame.points.map(raster),
      })),
    }
    packet.glazingSymbols = {
      status: doors.compoundPanels.status,
      refusalReason: doors.compoundPanels.refusalReason,
      candidates: doors.compoundPanels.panels.flatMap((panel) =>
        panel.centerline
          ? [
              {
                id: `native-glazing-symbol-${panel.body.operationIndex}:${panel.body.subpathIndex}`,
                polygons: [panel.body, ...panel.caps].map((path) => path.points.map(raster)),
                centerline: {
                  start: raster(panel.centerline.start),
                  end: raster(panel.centerline.end),
                },
              },
            ]
          : [],
      ),
    }
  }
  const fills = rooms.geometry
  const strokes = annotations.geometry
  packet.extraction.geometryComplete =
    !fills.truncated &&
    !strokes.truncated &&
    !rooms.strokeGeometry.truncated &&
    rooms.frameFaces?.status !== 'unresolved' &&
    work.skippedCurves === 0 &&
    work.clippedPaths === 0
  packet.status = packet.extraction.geometryComplete && native.complete ? 'draft' : 'unresolved'
  const named = new Map(
    rooms.associations.flatMap((entry) => entry.regionIds.map((id) => [id, entry.name] as const)),
  )
  const tagged = new Set(annotations.annotations.map((entry) => entry.faceId))
  const strokeOverlays = new Map<string, NativeReviewPacket['faces'][number]>()
  for (const face of strokes.candidates)
    strokeOverlays.set(nativeRoomPolygonKey(face.polygon), {
      id: face.id,
      layer: 'stroke',
      polygon: face.rasterPolygon.map((point) => ({ ...point })),
      annotationHint: tagged.has(face.id),
    })
  // A numbered endpoint ring can survive where bounded faces refuse an interior
  // caption box. Preserve the source shape, never erase that box or invent a floor.
  for (const cycle of [
    ...rooms.strokeGeometry.candidates,
    ...(rooms.frameFaces?.geometry?.candidates ?? []),
  ]) {
    if (!named.has(cycle.id)) continue
    const key = nativeRoomPolygonKey(cycle.polygon)
    const existing = strokeOverlays.get(key)
    if (existing) existing.roomName = named.get(cycle.id)
    else
      strokeOverlays.set(key, {
        id: cycle.id,
        layer: 'stroke',
        polygon: cycle.rasterPolygon.map((point) => ({ ...point })),
        annotationHint: false,
        roomName: named.get(cycle.id),
      })
  }
  const faces = [
    ...fills.candidates.map((face) => ({
      id: face.id,
      layer: 'fill' as const,
      polygon: face.rasterPolygon.map((point) => ({ ...point })),
      annotationHint: false,
      ...(named.has(face.id) ? { roomName: named.get(face.id) } : {}),
    })),
    ...strokeOverlays.values(),
  ]
  if (faces.length > 100) {
    packet.status = 'unresolved'
    issue(
      'native-overlay-limit',
      'Достигнут лимит областей для наложения. Неполный набор контуров не показан; нужна отдельная сверка исходника.',
    )
  } else packet.faces = faces
  packet.counts = {
    fillCandidates: fills.candidates.length,
    strokeFaces: strokeOverlays.size,
    annotationHints: annotations.annotations.length,
    numberedAssociations: rooms.associations.length,
    printedDimensions: dimensions.candidates.length,
  }
  if (!packet.extraction.geometryComplete)
    issue(
      'native-geometry-incomplete',
      'Извлечение линий неполное или достигнут лимит проверки. Полнота схемы не доказана.',
    )
  if (!native.complete || native.labels.length === 0)
    issue(
      'native-text-unavailable',
      'Нет полного нативного текста. Эта проверка не выполняет OCR скана.',
    )
  if (rooms.status === 'unresolved')
    issue(
      'room-associations-unresolved',
      'Связь названий с контурами не установлена для этого формата плана.',
    )
  else if (rooms.unresolvedSourceNumbers.length)
    issue('room-associations-partial', 'Часть номеров помещений не связана с найденными областями.')
  if (rooms.frameFaces?.status === 'not-applicable')
    issue(
      'number-frame-faces-unavailable',
      'Связанные контуры по рамкам номеров здесь не проверены: нужны изолированные рамки и полный слой прямых линий без пропусков.',
    )
  if (annotations.unknownFaceIds.length || fills.candidates.length)
    issue(
      'face-roles-unconfirmed',
      'Назначение областей не подтверждено: среди них могут быть стены, таблицы и элементы чертежа.',
    )
  if (dimensions.refusalReason)
    issue('dimension-evidence-unresolved', 'Подписанные размеры не удалось проверить полностью.')
  else if (dimensions.unresolved.length)
    issue(
      'dimension-evidence-partial',
      'Часть числовых подписей не связана с единственной размерной линией. Они не используются как проверенные мерки.',
    )
  for (const [stage, reason] of [
    ['room-format', rooms.status === 'unresolved' ? rooms.reason : null],
    ['stroke-search', strokes.refusalReason],
    ['annotation-hints', annotations.refusalReason],
    ['dimension-search', dimensions.refusalReason],
    ['door-symbol-search', doors.refusalReason],
    ['opening-frame-search', frames.refusalReason],
    ['panel-profile-search', doors.compoundPanels.refusalReason],
    ['source-link-search', connections.refusalReason],
    ['number-circle-search', circles.refusalReason],
  ] as const) {
    if (reason)
      issue(
        `${stage}:${reason}`,
        `Ограничение ${stage}: ${reason}. Нужна отдельная сверка исходника.`,
      )
  }
  issue(
    'floor-boundaries-unreviewed',
    'Границы пола помещений и балкона требуют отдельной сверки. Найденная область ещё не комната.',
  )
  issue(
    'walls-openings-unreviewed',
    'Нет полной проверенной связки стен, дверей и окон с соседними помещениями.',
  )
  issue(
    'metric-scale-unreviewed',
    'Не подтверждены независимые направления масштаба и мерки для переноса в сантиметры.',
  )
  issue('vertical-data-unreviewed', 'Высоты и толщины для объёмной схемы здесь не проверены.')
  return packet
}
