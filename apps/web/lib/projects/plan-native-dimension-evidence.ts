import type { NativeTextAnchors } from './plan-document'
import { nativeDimensionMillimetres, pdfNativePageDimensionChain } from './plan-pdf-dimension-chain'
import type { PdfLinework } from './plan-pdf-linework'
import { PDF_NATIVE_MAX_PATHS, PDF_NATIVE_MAX_POINTS } from './plan-pdf-linework'
import type { PdfPlanSource } from './plan-pdf-room-binding'
import { bindObservedRegionLabels, type RegionLabelFrame } from './plan-raster-region-labels'

export type ReviewedNativeDimensions = {
  review: 'manual-native-dimension-review'
  source: PdfPlanSource
  rasterSource: RegionLabelFrame
  chains: { id: string; axis: 'width' | 'depth' | 'aligned'; labelIds: string[] }[]
  wallOperations: number[]
}

/** Printed chain evidence only. Rails are not a complete removable annotation or a floor edge. */
export function nativeDimensionEvidence(input: {
  native: NativeTextAnchors
  lineworkSource: RegionLabelFrame
  work: PdfLinework
  reviewed: ReviewedNativeDimensions
}) {
  const { native, reviewed, work } = input
  for (const source of [input.lineworkSource, reviewed.rasterSource])
    bindObservedRegionLabels({
      regionSource: native.source,
      labelSource: source,
      regions: [],
      labels: [],
    })
  if (
    reviewed.review !== 'manual-native-dimension-review' ||
    !native.complete ||
    !native.originalPdfSha256 ||
    !/^[a-f0-9]{64}$/.test(native.originalPdfSha256) ||
    reviewed.source.sha256 !== native.originalPdfSha256 ||
    reviewed.source.pdfPage !== native.source.page ||
    reviewed.source.state !== 'existing' ||
    reviewed.chains.length > 8 ||
    native.labels.length > 1000 ||
    ![work.pageWidth, work.pageHeight].every((value) => Number.isFinite(value) && value > 0) ||
    work.paths.length > PDF_NATIVE_MAX_PATHS ||
    work.paths.reduce((sum, path) => sum + path.points.length, 0) > PDF_NATIVE_MAX_POINTS ||
    work.paths.some((path) =>
      path.points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y)),
    ) ||
    new Set(native.labels.map((label) => label.id)).size !== native.labels.length ||
    new Set(reviewed.chains.map((chain) => chain.id)).size !== reviewed.chains.length ||
    reviewed.wallOperations.length > 3000 ||
    new Set(reviewed.wallOperations).size !== reviewed.wallOperations.length
  )
    throw new Error('Invalid native dimension source or review inventory')
  const pathOperations = new Set(work.paths.map((path) => path.operationIndex))
  if (
    reviewed.wallOperations.some(
      (operation) => !Number.isSafeInteger(operation) || !pathOperations.has(operation),
    )
  )
    throw new Error('Unknown reviewed wall operation')
  const labels = new Map(native.labels.map((label) => [label.id, label]))
  const dimensionOperations = new Set<number>()
  const chains = reviewed.chains.map((chain) => {
    if (
      !chain.id.trim() ||
      chain.id.length > 120 ||
      chain.id !== chain.id.trim() ||
      !['width', 'depth', 'aligned'].includes(chain.axis) ||
      chain.labelIds.length < 1 ||
      chain.labelIds.length > 20 ||
      new Set(chain.labelIds).size !== chain.labelIds.length
    )
      throw new Error('Invalid reviewed dimension selection')
    const selected = chain.labelIds.map((id) => {
      const label = labels.get(id)
      if (
        !label ||
        label.nativeIndex === undefined ||
        !Number.isSafeInteger(label.nativeIndex) ||
        label.nativeIndex < 0 ||
        label.id !== `native-text-${label.nativeIndex}` ||
        !label.pagePoint ||
        !Number.isFinite(label.rotation) ||
        ![label.pagePoint.x, label.pagePoint.y].every(
          (value) => Number.isFinite(value) && value >= 0 && value <= 1000,
        ) ||
        nativeDimensionMillimetres(label.name) === undefined
      )
        throw new Error('Selected dimension lacks native coordinate provenance')
      return {
        index: label.nativeIndex,
        text: label.name,
        x: label.pagePoint.x,
        y: label.pagePoint.y,
        rotation: label.rotation as number,
      }
    })
    const totalMm = selected.reduce(
      (sum, label) => sum + (nativeDimensionMillimetres(label.text) ?? 0),
      0,
    )
    const result = pdfNativePageDimensionChain(work, reviewed.source, selected, totalMm, chain.axis)
    if (result.status !== 'candidate')
      return { id: chain.id, labelIds: chain.labelIds, result, rails: [] }
    for (const operation of result.lineOperations) dimensionOperations.add(operation)
    if (result.lineOperations.some((operation) => reviewed.wallOperations.includes(operation)))
      return {
        id: chain.id,
        labelIds: chain.labelIds,
        result: { status: 'unresolved' as const, reason: 'dimension-wall-role-conflict' },
        rails: [],
      }
    const rails = result.lineOperations.map((operationIndex) => {
      const candidates = work.paths.filter((path) => path.operationIndex === operationIndex)
      const path = candidates[0]
      return candidates.length === 1 &&
        path &&
        path.paint === 'stroke' &&
        !path.closed &&
        path.points.length === 2
        ? {
            operationIndex,
            subpathIndex: path.subpathIndex,
            points: path.points.map((point) => ({ ...point })),
          }
        : null
    })
    if (rails.some((rail) => rail === null))
      return {
        id: chain.id,
        labelIds: chain.labelIds,
        result: { status: 'ambiguous' as const, reason: 'non-unique-native-dimension-operation' },
        rails: [],
      }
    return { id: chain.id, labelIds: chain.labelIds, result, rails }
  })
  return {
    status: 'draft' as const,
    source: reviewed.source,
    rasterSource: native.source,
    chains,
    dimensionOperations: [...dimensionOperations],
    nativeCoverageWarnings: {
      skippedCurves: work.skippedCurves,
      clippedPaths: work.clippedPaths,
      unsupportedPaths: work.unsupportedPaths,
      unsupportedContexts: work.unsupportedContexts,
    },
  }
}
