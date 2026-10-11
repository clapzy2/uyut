import type { PdfNativePageDimensionChain } from './plan-pdf-dimension-chain'
import type { PdfLinework } from './plan-pdf-linework'
import type { PdfPlanSource } from './plan-pdf-room-binding'

/** A contour review cannot compensate for an incomplete or foreign native layer. */
export function pdfNativeDimensionSourceIssue(
  source: PdfPlanSource,
  work: PdfLinework,
): string | undefined {
  if (
    !/^[a-f0-9]{64}$/.test(source.sha256) ||
    !Number.isSafeInteger(source.pdfPage) ||
    source.pdfPage < 1 ||
    source.state !== 'existing'
  )
    return 'invalid-native-dimension-source'
  const omitted = work.skippedCurveBounds ?? []
  if (
    work.coordinateSystem !== 'page-0-1000' ||
    work.truncated ||
    work.skippedCurveBoundsTruncated ||
    work.clippedPathBoundsTruncated ||
    !Number.isSafeInteger(work.skippedCurves) ||
    work.skippedCurves !== omitted.length ||
    omitted.length > 3000 ||
    omitted.some(
      ({ bounds }) =>
        ![bounds.left, bounds.top, bounds.right, bounds.bottom].every(Number.isFinite) ||
        bounds.left > bounds.right ||
        bounds.top > bounds.bottom,
    ) ||
    work.clippedPaths !== 0 ||
    work.unsupportedPaths !== 0 ||
    work.unsupportedContexts !== 0 ||
    work.paths.length > 3000 ||
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
  labels: readonly { index: number; x: number; y: number }[],
): boolean {
  const omitted = work.skippedCurveBounds ?? []
  const padX = (6 * 1000) / work.pageWidth
  const padY = (6 * 1000) / work.pageHeight
  return chain.segments.every((segment) => {
    const label = labels.find((label) => label.index === segment.labelIndex)
    if (!label) return false
    // An omitted path near the rail, endpoints or label may hide a competing source line.
    const x = [segment.start.x, segment.end.x, label.x]
    const y = [segment.start.y, segment.end.y, label.y]
    return !omitted.some(
      ({ bounds }) =>
        bounds.right >= Math.min(...x) - padX &&
        bounds.left <= Math.max(...x) + padX &&
        bounds.bottom >= Math.min(...y) - padY &&
        bounds.top <= Math.max(...y) + padY,
    )
  })
}
