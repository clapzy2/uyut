import type { NativeTextAnchors } from './plan-document'
import { nativeWallSectionGaps, type ReviewedNativeWallSection } from './plan-native-wall-section'
import type { PdfLinework, PdfVectorPath } from './plan-pdf-linework'

type GapSnapshot = ReturnType<typeof nativeWallSectionGaps>['gaps'][number]
export type ReviewedNativeOpeningKinds = {
  review: 'manual-native-opening-kind-review'
  section: ReviewedNativeWallSection
  items: {
    id: string
    kind: 'door' | 'window'
    gap: GapSnapshot
    symbols: PdfVectorPath[]
  }[]
}
function gapSignature(gap: GapSnapshot) {
  const jambs = (items: GapSnapshot['startJambs']) =>
    items
      .map((edge) =>
        [
          edge.operationIndex,
          edge.subpathIndex,
          edge.segmentIndex,
          edge.start.x,
          edge.start.y,
          edge.end.x,
          edge.end.y,
        ].join(':'),
      )
      .sort()
  return JSON.stringify([
    gap.from,
    gap.to,
    gap.start.x,
    gap.start.y,
    gap.end.x,
    gap.end.y,
    jambs(gap.startJambs),
    jambs(gap.endJambs),
    gap.boundedByReviewedWalls,
    [...gap.unknownFillOperations].sort((a, b) => a - b),
    [...gap.dimensionLabelIds].sort(),
    gap.printedWidthMm,
    gap.openingKind,
  ])
}
const samePoint = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  a.x === b.x && a.y === b.y

/** Bind an explicit source-kind review; never certifies passage, clears fills, or closes floors. */
export function reviewedNativeOpeningKinds(input: {
  native: NativeTextAnchors
  work: PdfLinework
  lineworkSource: ReviewedNativeWallSection['rasterSource']
  reviewed: ReviewedNativeOpeningKinds
}) {
  const { reviewed, work } = input
  const section = nativeWallSectionGaps({ ...input, reviewed: reviewed.section })
  const fail = (reason: string) => ({
    status: 'unresolved' as const,
    reason,
    bindings: [],
    section,
  })
  if (section.refusalReason) return fail(section.refusalReason)
  if (
    reviewed.review !== 'manual-native-opening-kind-review' ||
    reviewed.items.length > 50 ||
    new Set(reviewed.items.map((item) => item.id)).size !== reviewed.items.length ||
    new Set(reviewed.items.map((item) => gapSignature(item.gap))).size !== reviewed.items.length
  )
    return fail('invalid-opening-kind-review')
  const bindings: {
    id: string
    sourceReviewedKind: 'door' | 'window'
    gap: GapSnapshot
    symbols: PdfVectorPath[]
    physicalPassageAccepted: false
  }[] = []
  const wallKeys = new Set(
    reviewed.section.walls.map((wall) => `${wall.operationIndex}:${wall.subpathIndex}`),
  )
  const operationCounts = new Map<number, number>()
  const omittedOperations = new Set(
    [...(work.skippedCurveBounds ?? []), ...(work.clippedPathBounds ?? [])].map(
      (entry) => entry.operationIndex,
    ),
  )
  for (const path of work.paths)
    operationCounts.set(path.operationIndex, (operationCounts.get(path.operationIndex) ?? 0) + 1)
  const along = reviewed.section.axis === 'width' ? 'x' : 'y',
    across = reviewed.section.axis === 'width' ? 'y' : 'x'
  for (const item of reviewed.items) {
    if (
      !item.id ||
      item.id !== item.id.trim() ||
      item.id.length > 120 ||
      !['door', 'window'].includes(item.kind) ||
      item.symbols.length < 1 ||
      item.symbols.length > 30 ||
      new Set(item.symbols.map((symbol) => `${symbol.operationIndex}:${symbol.subpathIndex}`))
        .size !== item.symbols.length
    )
      return fail('invalid-opening-kind-item')
    const matches = section.gaps.filter(
      (gap) =>
        gap.printedWidthMm === item.gap.printedWidthMm &&
        gap.openingKind === item.gap.openingKind &&
        gapSignature(gap) === gapSignature(item.gap),
    )
    const gap = matches[0]
    if (matches.length !== 1 || !gap?.boundedByReviewedWalls)
      return fail('stale-or-unbounded-opening-gap')
    const symbols: PdfVectorPath[] = []
    for (const symbol of item.symbols) {
      const key = `${symbol.operationIndex}:${symbol.subpathIndex}`
      if (wallKeys.has(key)) return fail('opening-symbol-wall-role-conflict')
      const original = work.paths.find(
        (path) =>
          path.operationIndex === symbol.operationIndex &&
          path.subpathIndex === symbol.subpathIndex,
      )
      if (
        !original ||
        omittedOperations.has(symbol.operationIndex) ||
        operationCounts.get(symbol.operationIndex) !== 1 ||
        original.paint !== symbol.paint ||
        original.closed !== symbol.closed ||
        original.points.length !== symbol.points.length ||
        !original.points.every(
          (point, index) =>
            symbol.points[index] &&
            samePoint(point, symbol.points[index] as { x: number; y: number }),
        )
      )
        return fail('stale-or-compound-opening-symbol')
      if (
        !original.points.length ||
        original.points.some((point) => point[along] < gap.from || point[along] > gap.to)
      )
        return fail('opening-symbol-outside-gap-span')
      symbols.push(original)
    }
    const points = symbols.flatMap((symbol) => symbol.points)
    if (
      Math.min(...points.map((point) => point[along])) !== gap.from ||
      Math.max(...points.map((point) => point[along])) !== gap.to
    )
      return fail('opening-symbol-does-not-span-gap')
    if (
      Math.min(...points.map((point) => point[across])) > reviewed.section.at ||
      Math.max(...points.map((point) => point[across])) < reviewed.section.at
    )
      return fail('opening-symbol-misses-section')
    if (item.kind === 'window') {
      if (
        Math.min(...points.map((point) => point[across])) >= reviewed.section.at ||
        Math.max(...points.map((point) => point[across])) <= reviewed.section.at
      )
        return fail('window-symbol-misses-section')
    } else {
      const endpoints = [...gap.startJambs, ...gap.endJambs].flatMap((edge) => [
        edge.start,
        edge.end,
      ])
      if (!points.some((point) => endpoints.some((endpoint) => samePoint(point, endpoint))))
        return fail('door-symbol-not-attached-to-source-jamb')
    }
    bindings.push({
      id: item.id,
      sourceReviewedKind: item.kind,
      gap: structuredClone(gap),
      symbols: structuredClone(symbols),
      physicalPassageAccepted: false,
    })
  }
  const bound = new Set(bindings.map((binding) => gapSignature(binding.gap)))
  return {
    status: 'draft' as const,
    source: reviewed.section.source,
    rasterSource: reviewed.section.rasterSource,
    bindings,
    section,
    unreviewedGaps: section.gaps.filter((gap) => !bound.has(gapSignature(gap))),
    closesFloorBoundary: false as const,
    completeOpeningInventory: false as const,
  }
}
