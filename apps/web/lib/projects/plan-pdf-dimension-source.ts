import type { PdfNativePageDimensionChain } from './plan-pdf-dimension-chain'
import type { PagePoint, PdfLinework } from './plan-pdf-linework'
import type { PdfPlanSource } from './plan-pdf-room-binding'

/** Physical transfer stays strict. Source-caption inspection may check bounded omissions locally. */
export function pdfNativeDimensionSourceIssue(
  source: PdfPlanSource,
  work: PdfLinework,
  scope: 'complete-layer' | 'bounded-clipped-ink' = 'complete-layer',
): string | undefined {
  if (
    !/^[a-f0-9]{64}$/.test(source.sha256) ||
    !Number.isSafeInteger(source.pdfPage) ||
    source.pdfPage < 1 ||
    source.state !== 'existing'
  )
    return 'invalid-native-dimension-source'
  const omitted = work.skippedCurveBounds ?? []
  const clipped = work.clippedPathBounds ?? []
  const validOmissions = (items: typeof omitted) =>
    Array.isArray(items) &&
    items.length <= 5000 &&
    items.every(
      (item) =>
        item &&
        Number.isSafeInteger(item.operationIndex) &&
        item.operationIndex >= 0 &&
        item.bounds &&
        [item.bounds.left, item.bounds.top, item.bounds.right, item.bounds.bottom].every(
          Number.isFinite,
        ) &&
        item.bounds.left <= item.bounds.right &&
        item.bounds.top <= item.bounds.bottom &&
        (item.paint === undefined || ['stroke', 'fill', 'fill-stroke'].includes(item.paint)),
    )
  if (
    work.coordinateSystem !== 'page-0-1000' ||
    work.truncated ||
    work.skippedCurveBoundsTruncated ||
    work.clippedPathBoundsTruncated ||
    !Number.isSafeInteger(work.skippedCurves) ||
    work.skippedCurves !== omitted.length ||
    !validOmissions(omitted) ||
    !Number.isSafeInteger(work.clippedPaths) ||
    work.clippedPaths < 0 ||
    work.clippedPaths !== clipped.length ||
    !validOmissions(clipped) ||
    (scope === 'complete-layer' && work.clippedPaths !== 0) ||
    work.unsupportedPaths !== 0 ||
    work.unsupportedContexts !== 0 ||
    work.paths.length > 5000 ||
    work.paths.reduce((sum, path) => sum + path.points.length, 0) > 20_000 ||
    new Set(work.paths.map((path) => `${path.operationIndex}:${path.subpathIndex}`)).size !==
      work.paths.length ||
    work.paths.some(
      (path) =>
        ![path.operationIndex, path.subpathIndex].every(
          (value) => Number.isSafeInteger(value) && value >= 0,
        ) ||
        path.points.some((point) =>
          [point.x, point.y].some((value) => !Number.isFinite(value) || value < 0 || value > 1000),
        ),
    ) ||
    ![work.pageWidth, work.pageHeight].every((value) => Number.isFinite(value) && value > 0)
  )
    return 'incomplete-native-dimension-layer'
  return undefined
}

/** Reuse only after validating the source. Remote door arcs need not hide this rail. */
export function pdfNativeDimensionChainIsUnobscured(
  work: PdfLinework,
  chain: Pick<Extract<PdfNativePageDimensionChain, { status: 'candidate' }>, 'segments'>,
  labels: readonly (PagePoint & {
    index: number
    baselineStart?: PagePoint
    baselineEnd?: PagePoint
    inkPolygon?: readonly PagePoint[]
  })[],
): boolean {
  const omitted = [...(work.skippedCurveBounds ?? []), ...(work.clippedPathBounds ?? [])]
  const padX = (6 * 1000) / work.pageWidth
  const padY = (6 * 1000) / work.pageHeight
  return chain.segments.every((segment) => {
    const label = labels.find((label) => label.index === segment.labelIndex)
    if (!label) return false
    // An omitted path near the rail, endpoints or label may hide a competing source line.
    const points = [
      segment.start,
      segment.end,
      label,
      ...(label.baselineStart ? [label.baselineStart] : []),
      ...(label.baselineEnd ? [label.baselineEnd] : []),
      ...(label.inkPolygon ?? []),
    ]
    const x = points.map((point) => point.x)
    const y = points.map((point) => point.y)
    return !omitted.some(
      ({ bounds }) =>
        bounds.right >= Math.min(...x) - padX &&
        bounds.left <= Math.max(...x) + padX &&
        bounds.bottom >= Math.min(...y) - padY &&
        bounds.top <= Math.max(...y) + padY,
    )
  })
}
