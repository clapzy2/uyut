import { exactNativePolygonsOverlap } from './plan-native-exact-intersections'
import { nativeFillCandidates } from './plan-native-fill-candidates'
import type { Bounds, PagePoint } from './plan-pdf-linework'
import { pdfPolygonIsValid } from './plan-pdf-room-binding'

type Input = Parameters<typeof nativeFillCandidates>[0]
type SourceRef = { operationIndex: number; subpathIndex: number }
type PaintContact = {
  sourceRef: SourceRef
  order: 'earlier' | 'later' | 'same-operation'
  fillColor: string | null
  relation: 'intersecting-paint' | 'unresolved-paint'
}
type RegionContext = {
  candidateId: string
  sourceRef: SourceRef
  paintContacts: PaintContact[]
  possibleOmissions: { kind: 'curve' | 'clipped'; operationIndex: number; bounds: Bounds }[]
}
const boundsOf = (points: PagePoint[]): Bounds => ({
  left: Math.min(...points.map((point) => point.x)),
  right: Math.max(...points.map((point) => point.x)),
  top: Math.min(...points.map((point) => point.y)),
  bottom: Math.max(...points.map((point) => point.y)),
})
const overlaps = (a: Bounds, b: Bounds) =>
  a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top
const validBounds = (bounds: Bounds) =>
  [bounds.left, bounds.right, bounds.top, bounds.bottom].every(Number.isFinite) &&
  bounds.left <= bounds.right &&
  bounds.top <= bounds.bottom
const knownColor = (value: string | undefined) =>
  value && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null

/** Paint order/contact diagnostics for existing positive shapes, never visible free-floor proof. */
export function nativePaintedRegionContext(input: Input) {
  const contexts: RegionContext[] = []
  const finish = (refusalReason: string | null) => ({
    status: refusalReason ? ('unresolved' as const) : ('draft' as const),
    refusalReason,
    source: { ...input.native.source },
    originalPdfSha256: input.native.originalPdfSha256,
    contexts: refusalReason ? [] : contexts,
    basis: 'positive-paint-operation-context' as const,
    omissionContactBasis: 'bounds-only-possible-contact' as const,
    semanticStatus: 'unclassified' as const,
    readOnly: true as const,
    visibilityConfirmed: false as const,
    roomOwnershipConfirmed: false as const,
    readyFor2D: false as const,
    readyFor3D: false as const,
  })
  let inventory: ReturnType<typeof nativeFillCandidates>
  try {
    inventory = nativeFillCandidates(input)
  } catch {
    return finish('unverified-painted-region-source')
  }
  if (inventory.refusalReason) return finish(inventory.refusalReason)
  if (input.native.vectorInkRefusal !== undefined) return finish('source-vector-ink-unverified')
  const paths = input.work.paths
  if (
    new Set(paths.map((path) => `${path.operationIndex}:${path.subpathIndex}`)).size !==
      paths.length ||
    paths.some(
      (path) =>
        ![path.operationIndex, path.subpathIndex].every(
          (index) => Number.isSafeInteger(index) && index >= 0,
        ) ||
        path.points.length < 2 ||
        path.points.some(
          (point) =>
            ![point.x, point.y].every(
              (value) => Number.isFinite(value) && value >= 0 && value <= 1000,
            ),
        ),
    )
  )
    return finish('invalid-native-paint-provenance')
  const omissions = [
    ...(input.work.skippedCurveBounds ?? []).map((item) => ({ ...item, kind: 'curve' as const })),
    ...(input.work.clippedPathBounds ?? []).map((item) => ({ ...item, kind: 'clipped' as const })),
  ]
  if (
    (input.work.skippedCurveBounds?.length ?? 0) !== input.work.skippedCurves ||
    (input.work.clippedPathBounds?.length ?? 0) !== input.work.clippedPaths ||
    omissions.some(
      (item) =>
        !Number.isSafeInteger(item.operationIndex) ||
        item.operationIndex < 0 ||
        !validBounds(item.bounds),
    )
  )
    return finish('incomplete-native-paint-omissions')
  const paint = paths
    .filter((path) => path.paint !== 'stroke')
    .map((path) => {
      const polygon = [...path.points]
      const first = polygon[0],
        last = polygon.at(-1)
      if (first && last && first.x === last.x && first.y === last.y) polygon.pop()
      return { path, polygon, bounds: boundsOf(polygon) }
    })
  const operationCounts = new Map<number, number>()
  for (const path of paths)
    operationCounts.set(path.operationIndex, (operationCounts.get(path.operationIndex) ?? 0) + 1)
  const omittedOperations = new Set(omissions.map((item) => item.operationIndex))
  let budget = 2_000_000
  for (const candidate of inventory.candidates) {
    const box = boundsOf(candidate.polygon)
    const paintContacts: PaintContact[] = []
    for (const item of paint) {
      const other = item.path
      if (
        other.operationIndex === candidate.sourceRef.operationIndex &&
        other.subpathIndex === candidate.sourceRef.subpathIndex
      )
        continue
      const candidateColor = knownColor(candidate.fillColor),
        otherColor = knownColor(other.fillColor)
      if (candidateColor && otherColor === candidateColor) continue
      if (!overlaps(box, item.bounds)) continue
      budget -= candidate.polygon.length * item.polygon.length
      if (budget < 0) return finish('paint-context-work-limit')
      const simple =
        other.closed &&
        operationCounts.get(other.operationIndex) === 1 &&
        !omittedOperations.has(other.operationIndex) &&
        pdfPolygonIsValid(item.polygon)
      const relation = simple ? exactNativePolygonsOverlap(candidate.polygon, item.polygon) : null
      if (relation === false) continue
      paintContacts.push({
        sourceRef: { operationIndex: other.operationIndex, subpathIndex: other.subpathIndex },
        order:
          other.operationIndex < candidate.sourceRef.operationIndex
            ? 'earlier'
            : other.operationIndex > candidate.sourceRef.operationIndex
              ? 'later'
              : 'same-operation',
        fillColor: otherColor,
        relation: relation === true ? 'intersecting-paint' : 'unresolved-paint',
      })
    }
    contexts.push({
      candidateId: candidate.id,
      sourceRef: { ...candidate.sourceRef },
      paintContacts,
      possibleOmissions: omissions
        .filter((item) => overlaps(box, item.bounds))
        .map((item) => ({ ...item, bounds: { ...item.bounds } })),
    })
  }
  return finish(null)
}
