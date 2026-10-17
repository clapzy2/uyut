import type { NativeTextAnchors } from './plan-document'
import { exactNativeOrientation } from './plan-native-exact-intersections'
import { nativeFilledPanelCandidates } from './plan-native-filled-panels'
import type { PdfLinework, PdfVectorPath } from './plan-pdf-linework'
import type { NativePageSegment } from './plan-pdf-opening-endpoint'
import type { RegionLabelFrame } from './plan-raster-region-labels'

export type NativeFilledPanelEnd = {
  profileEdge: NativePageSegment
  status: 'matched' | 'partial' | 'ambiguous' | 'unobserved' | 'unresolved'
  reason: string | null
  coverage: 'complete' | 'partial' | 'unproved'
  sourceEdges: NativePageSegment[]
  sourcePaints: { operationIndex: number; subpathIndex: number; paint: PdfVectorPath['paint'] }[]
  physicalJambAccepted: false
}

export type NativeFilledPanelJambPair = {
  panelId: string
  status: 'paired' | 'partial' | 'ambiguous' | 'unobserved' | 'unresolved'
  ends: [NativeFilledPanelEnd, NativeFilledPanelEnd]
  omittedInkCount: number
  laterPaintCount: number
  wallOwnershipConfirmed: false
  physicalJambAccepted: false
  physicalPassageAccepted: false
  closesFloorBoundary: false
  finalPaintVisibilityProved: false
}

const MAX_WORK = 200_000
const MAX_CONTACTS = 1000
const sourceKey = (path: Pick<PdfVectorPath, 'operationIndex' | 'subpathIndex'>) =>
  `${path.operationIndex}:${path.subpathIndex}`
const samePoint = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  a.x === b.x && a.y === b.y

function edges(path: PdfVectorPath): NativePageSegment[] {
  const first = path.points[0],
    last = path.points.at(-1)
  const explicitReturn = first && last && samePoint(first, last)
  const count = path.points.length - 1 + (path.closed && !explicitReturn ? 1 : 0)
  return Array.from({ length: count }, (_, segmentIndex) => ({
    operationIndex: path.operationIndex,
    subpathIndex: path.subpathIndex,
    segmentIndex,
    start: path.points[segmentIndex] as PdfVectorPath['points'][number],
    end: path.points[(segmentIndex + 1) % path.points.length] as PdfVectorPath['points'][number],
  })).filter((edge) => !samePoint(edge.start, edge.end))
}

/** Literal end-to-source-paint correspondence, never automatic wall or physical jamb ownership. */
export function nativeFilledPanelJambContacts(input: {
  native: NativeTextAnchors
  work: PdfLinework
  lineworkSource: RegionLabelFrame
  /** Joined panels are source-only diagnostics, not accepted opening geometry. */
  contactMode?: 'overlapping-endcaps' | 'exact-joined-endcaps'
}) {
  // Always derive profiles afresh from the complete same-source inventory, not caller-selected refs.
  const profiles = nativeFilledPanelCandidates(input)
  const panels: NativeFilledPanelJambPair[] = []
  const finish = (refusalReason: string | null) => ({
    status: refusalReason ? ('unresolved' as const) : ('draft' as const),
    basis: 'filled-panel-ends-to-independent-source-edges' as const,
    source: input.native.source,
    originalPdfSha256: input.native.originalPdfSha256,
    panels: refusalReason ? [] : structuredClone(panels),
    refusalReason,
    wallOwnershipConfirmed: false as const,
    physicalJambAccepted: false as const,
    physicalPassageAccepted: false as const,
    closesFloorBoundary: false as const,
    completeOpeningInventory: false as const,
    finalPaintVisibilityProved: false as const,
    readyFor2D: false as const,
    readyFor3D: false as const,
  })
  if (profiles.refusalReason) return finish(profiles.refusalReason)
  const omitted = new Set([
    ...(input.work.skippedCurveBounds ?? []).map((item) => item.operationIndex),
    ...(input.work.clippedPathBounds ?? []).map((item) => item.operationIndex),
  ])
  const counts = new Map<number, number>()
  for (const path of input.work.paths)
    counts.set(path.operationIndex, (counts.get(path.operationIndex) ?? 0) + 1)
  const sources = input.work.paths
    .filter(
      (path) =>
        counts.get(path.operationIndex) === 1 &&
        !omitted.has(path.operationIndex) &&
        (input.contactMode !== 'exact-joined-endcaps' ||
          path.paint === 'stroke' ||
          path.paint === 'fill-stroke'),
    )
    .flatMap((path) => edges(path).map((edge) => ({ edge, paint: path.paint })))
  let checks = 0,
    contactCount = 0
  for (const panel of profiles.panels) {
    const own = new Set([panel.body, ...panel.caps].map(sourceKey))
    const ends: NativeFilledPanelEnd[] = []
    for (const profileEdge of panel.shortEdges) {
      const axis = profileEdge.start.x === profileEdge.end.x ? 'y' : 'x'
      const from = Math.min(profileEdge.start[axis], profileEdge.end[axis])
      const to = Math.max(profileEdge.start[axis], profileEdge.end[axis])
      const matches: {
        edge: NativePageSegment
        paint: PdfVectorPath['paint']
        from: number
        to: number
      }[] = []
      for (const source of sources) {
        if (++checks > MAX_WORK) return finish('filled-panel-end-search-budget')
        if (own.has(sourceKey(source.edge))) continue
        const start = Math.max(from, Math.min(source.edge.start[axis], source.edge.end[axis]))
        const end = Math.min(to, Math.max(source.edge.start[axis], source.edge.end[axis]))
        if (
          start >= end ||
          exactNativeOrientation(profileEdge.start, profileEdge.end, source.edge.start) !== 0 ||
          exactNativeOrientation(profileEdge.start, profileEdge.end, source.edge.end) !== 0
        )
          continue
        if (++contactCount > MAX_CONTACTS) return finish('filled-panel-end-contact-limit')
        matches.push({ ...source, from: start, to: end })
      }
      matches.sort((a, b) => a.from - b.from || a.to - b.to)
      let covered = from,
        overlapping = false
      for (const [index, match] of matches.entries()) {
        if (index > 0 && match.from < covered) overlapping = true
        if (match.from > covered) break
        covered = Math.max(covered, match.to)
      }
      // Check all overlapping matches even if an earlier uncovered gap broke the coverage walk.
      for (let index = 0; index < matches.length; index++) {
        const a = matches[index]
        if (!a) continue
        for (const b of matches.slice(index + 1)) {
          if (++checks > MAX_WORK) return finish('filled-panel-end-search-budget')
          if (Math.max(a.from, b.from) < Math.min(a.to, b.to)) overlapping = true
        }
      }
      const coverage =
        covered === to
          ? ('complete' as const)
          : matches.length
            ? ('partial' as const)
            : ('unproved' as const)
      const paints = new Map<string, NativeFilledPanelEnd['sourcePaints'][number]>()
      for (const match of matches)
        paints.set(sourceKey(match.edge), {
          operationIndex: match.edge.operationIndex,
          subpathIndex: match.edge.subpathIndex,
          paint: match.paint,
        })
      const omittedInk = panel.unresolvedInk.length > 0
      ends.push({
        profileEdge,
        status: omittedInk
          ? 'unresolved'
          : overlapping
            ? 'ambiguous'
            : coverage === 'complete'
              ? 'matched'
              : matches.length
                ? 'partial'
                : 'unobserved',
        reason: omittedInk
          ? 'omitted-ink-at-profile'
          : overlapping
            ? 'competing-or-repainted-source-end'
            : coverage === 'complete'
              ? null
              : matches.length
                ? 'partial-source-end-coverage'
                : 'no-exact-independent-source-end',
        coverage,
        sourceEdges: matches.map((match) => match.edge),
        sourcePaints: [...paints.values()],
        physicalJambAccepted: false,
      })
    }
    const pair = ends as [NativeFilledPanelEnd, NativeFilledPanelEnd]
    panels.push({
      panelId: panel.id,
      status: pair.some((end) => end.status === 'unresolved')
        ? 'unresolved'
        : pair.some((end) => end.status === 'ambiguous')
          ? 'ambiguous'
          : pair.every((end) => end.status === 'matched')
            ? 'paired'
            : pair.every((end) => end.status === 'unobserved')
              ? 'unobserved'
              : 'partial',
      ends: pair,
      omittedInkCount: panel.unresolvedInk.length,
      laterPaintCount: panel.laterPaintCount,
      wallOwnershipConfirmed: false,
      physicalJambAccepted: false,
      physicalPassageAccepted: false,
      closesFloorBoundary: false,
      finalPaintVisibilityProved: false,
    })
  }
  return finish(null)
}
