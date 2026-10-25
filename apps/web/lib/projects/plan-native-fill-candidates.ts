import type { NativeTextAnchors } from './plan-document'
import { PDF_NATIVE_MAX_PATHS, PDF_NATIVE_MAX_POINTS, type PdfLinework } from './plan-pdf-linework'
import { pdfPolygonIsValid } from './plan-pdf-room-binding'
import { bindObservedRegionLabels, type RegionLabelFrame } from './plan-raster-region-labels'

/** Native paint shapes, not floor or wall classifications. No colour-specific room heuristic. */
export function nativeFillCandidates(input: {
  native: NativeTextAnchors
  lineworkSource: RegionLabelFrame
  work: PdfLinework
}) {
  const { native, work } = input
  bindObservedRegionLabels({
    regionSource: native.source,
    labelSource: input.lineworkSource,
    regions: [],
    labels: [],
  })
  const scale = native.pageNormalizedScale
  if (
    !native.originalPdfSha256 ||
    !/^[a-f0-9]{64}$/.test(native.originalPdfSha256) ||
    !scale ||
    !Number.isFinite(scale.x) ||
    !Number.isFinite(scale.y) ||
    scale.x <= 0 ||
    scale.y <= 0 ||
    scale.x * 1000 > native.source.width + 0.001 ||
    scale.y * 1000 > native.source.height + 0.001 ||
    scale.x * 1000 < native.source.width * 0.995 ||
    scale.y * 1000 < native.source.height * 0.995 ||
    work.coordinateSystem !== 'page-0-1000'
  )
    throw new Error('Native fill source frame is unavailable')
  const candidates: {
    id: string
    sourceRef: { operationIndex: number; subpathIndex: number }
    polygon: { x: number; y: number }[]
    rasterPolygon: { x: number; y: number }[]
    pixelArea: number
    fillColor?: string
  }[] = []
  const rejected: { operationIndex: number; subpathIndex: number; reason: string }[] = []
  let rejectedCount = 0
  let filteredSmallFills = 0,
    ignoredFrameFills = 0,
    truncated = false
  const minimumPixelArea = Math.max(400, native.source.width * native.source.height * 0.002)
  const incomplete =
    work.truncated ||
    work.unsupportedPaths > 0 ||
    work.unsupportedContexts > 0 ||
    work.paths.length > PDF_NATIVE_MAX_PATHS ||
    work.paths.reduce((sum, path) => sum + path.points.length, 0) > PDF_NATIVE_MAX_POINTS ||
    (work.skippedCurves > 0 &&
      (!work.skippedCurveBounds?.length || work.skippedCurveBoundsTruncated)) ||
    (work.clippedPaths > 0 && (!work.clippedPathBounds?.length || work.clippedPathBoundsTruncated))
  const counts = new Map<number, number>()
  if (!incomplete) {
    for (const path of work.paths)
      counts.set(path.operationIndex, (counts.get(path.operationIndex) ?? 0) + 1)
  }
  const omittedOperations = new Set(
    [...(work.skippedCurveBounds ?? []), ...(work.clippedPathBounds ?? [])].map(
      (item) => item.operationIndex,
    ),
  )
  const seenRefs = new Set<string>()
  if (!incomplete) {
    for (const path of work.paths) {
      if (path.paint === 'stroke') continue
      const reject = (reason: string) => {
        rejectedCount++
        if (rejected.length < 50)
          rejected.push({
            operationIndex: path.operationIndex,
            subpathIndex: path.subpathIndex,
            reason,
          })
      }
      const key = `${path.operationIndex}:${path.subpathIndex}`
      if (
        !Number.isSafeInteger(path.operationIndex) ||
        path.operationIndex < 0 ||
        !Number.isSafeInteger(path.subpathIndex) ||
        path.subpathIndex < 0 ||
        seenRefs.has(key)
      ) {
        reject('invalid-or-duplicate-native-ref')
        continue
      }
      seenRefs.add(key)
      if (
        path.subpathIndex !== 0 ||
        counts.get(path.operationIndex) !== 1 ||
        omittedOperations.has(path.operationIndex)
      ) {
        reject('compound-or-omitted-fill-topology')
        continue
      }
      const polygon = path.points.map((point) => ({ ...point }))
      const first = polygon[0],
        last = polygon.at(-1)
      if (first && last && first.x === last.x && first.y === last.y) polygon.pop()
      if (!path.closed || !pdfPolygonIsValid(polygon)) {
        reject('non-simple-native-fill')
        continue
      }
      if (
        polygon.some((point) => point.x <= 0 || point.y <= 0 || point.x >= 1000 || point.y >= 1000)
      ) {
        ignoredFrameFills++
        continue
      }
      const twiceArea = polygon.reduce((sum, point, index) => {
        const next = polygon[(index + 1) % polygon.length]
        return next ? sum + point.x * next.y - next.x * point.y : sum
      }, 0)
      const pixelArea = Math.abs(twiceArea / 2) * scale.x * scale.y
      if (pixelArea < minimumPixelArea) {
        filteredSmallFills++
        continue
      }
      if (twiceArea < 0) polygon.reverse()
      let beginning = 0
      for (let index = 1; index < polygon.length; index++) {
        const current = polygon[index],
          start = polygon[beginning]
        if (
          current &&
          start &&
          (current.x < start.x || (current.x === start.x && current.y < start.y))
        )
          beginning = index
      }
      polygon.push(...polygon.splice(0, beginning))
      if (candidates.length === 50) {
        truncated = true
        break
      }
      candidates.push({
        id: `native-fill-${key}`,
        sourceRef: { operationIndex: path.operationIndex, subpathIndex: path.subpathIndex },
        polygon,
        rasterPolygon: polygon.map((point) => ({ x: point.x * scale.x, y: point.y * scale.y })),
        pixelArea,
        ...(path.fillColor ? { fillColor: path.fillColor } : {}),
      })
    }
  }
  return {
    status: 'draft' as const,
    semanticStatus: 'unclassified' as const,
    polygonCoordinateSystem: 'page-0-1000' as const,
    rasterCoordinateSystem: 'rendered-image-pixels' as const,
    source: native.source,
    originalPdfSha256: native.originalPdfSha256,
    minimumPixelArea,
    candidates,
    rejected,
    rejectedCount,
    diagnosticsTruncated: rejectedCount > rejected.length,
    filteredSmallFills,
    ignoredFrameFills,
    truncated: Boolean(incomplete || truncated),
    refusalReason: incomplete ? 'incomplete-native-layer' : truncated ? 'candidate-limit' : null,
    omissionCounts: { skippedCurves: work.skippedCurves, clippedPaths: work.clippedPaths },
    basis: 'native-fill-polygon' as const,
  }
}
