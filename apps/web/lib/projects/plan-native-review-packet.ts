import type { NativeTextAnchors } from './plan-document'
import { automaticNativeDimensionRoles } from './plan-native-dimension-roles'
import { nativeFaceAnnotationCandidates } from './plan-native-face-annotations'
import { automaticNativeRoomCandidates } from './plan-native-room-candidates'
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
  issues: { code: string; message: string }[]
  readiness: { readyFor2D: false; readyFor3D: false; readOnly: true }
}

/** Whole-page inspection only. No reviews are invented; this packet is never PlanGeometry. */
export function nativeReviewPacket(input: {
  source: PdfPlanSource
  image: RegionLabelFrame
  native?: NativeTextAnchors
  work?: PdfLinework
  lineworkSource?: RegionLabelFrame
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
  }
  const issue = (code: string, message: string) => packet.issues.push({ code, message })
  if (source.state !== 'existing' || source.pdfPage !== image.page)
    throw new Error('Native inspection requires the selected existing-state page')
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
  const rooms = automaticNativeRoomCandidates(common)
  const annotations = nativeFaceAnnotationCandidates(common)
  const dimensions = automaticNativeDimensionRoles({ ...common, source })
  const fills = rooms.geometry
  const strokes = annotations.geometry
  packet.extraction.geometryComplete =
    !fills.truncated && !strokes.truncated && work.skippedCurves === 0 && work.clippedPaths === 0
  packet.status = packet.extraction.geometryComplete && native.complete ? 'draft' : 'unresolved'
  const named = new Map(rooms.associations.map((entry) => [entry.regionId, entry.name]))
  const tagged = new Set(annotations.annotations.map((entry) => entry.faceId))
  packet.faces = [
    ...fills.candidates.map((face) => ({
      id: face.id,
      layer: 'fill' as const,
      polygon: face.rasterPolygon.map((point) => ({ ...point })),
      annotationHint: false,
      ...(named.has(face.id) ? { roomName: named.get(face.id) } : {}),
    })),
    ...strokes.candidates.map((face) => ({
      id: face.id,
      layer: 'stroke' as const,
      polygon: face.rasterPolygon.map((point) => ({ ...point })),
      annotationHint: tagged.has(face.id),
    })),
  ]
  packet.counts = {
    fillCandidates: fills.candidates.length,
    strokeFaces: strokes.candidates.length,
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
