import { exactNativePointKey } from './plan-native-exact-intersections'
import { nativeFaceRationalPredicates } from './plan-native-face-rational'
import {
  nativePaintedFloorReview,
  type PaintedFloorBoundaryRole,
} from './plan-native-painted-floor-review'
import {
  createNativeSourceSpanVisibility,
  type NativeSourceSpanVisibility,
  NativeSourceVisibilityLimit,
} from './plan-native-source-span-visibility'
import type { PagePoint } from './plan-pdf-linework'
import type { NativePageSegment } from './plan-pdf-opening-endpoint'
import { pdfPaintInventoryIsComplete, pdfPaintMayTouchSpan } from './plan-pdf-paint-exclusion'

export type SourcePaintBoundarySupport = {
  /** Zero is the outer ring; positive indices are holes, not inferred technical voids. */
  ringIndex: number
  edgeIndex: number
  sourceRegionSide: 'left' | 'right'
  declaredRole: PaintedFloorBoundaryRole
  status: 'linked' | 'partial' | 'ambiguous' | 'unobserved'
  coverage: 'complete' | 'partial' | 'unproved'
  reason:
    | 'partial-source-span'
    | 'competing-source-sides'
    | 'competing-source-spans'
    | 'missing-source-span'
    | null
  omittedInkCount: number
  contacts: {
    operationIndex: number
    subpathIndex: number
    segmentIndex: number
    startKey: string
    endKey: string
    paintSide: 'selected-region' | 'opposite-region'
    visibility?: NativeSourceSpanVisibility
  }[]
}

type Input = Parameters<typeof nativePaintedFloorReview>[0] & { includeSpanVisibility?: boolean }
const refKey = (ref: { operationIndex: number; subpathIndex: number; segmentIndex: number }) =>
  `${ref.operationIndex}:${ref.subpathIndex}:${ref.segmentIndex}`
const pathKey = (ref: { operationIndex: number; subpathIndex: number }) =>
  `${ref.operationIndex}:${ref.subpathIndex}`

/** Exact source-span coverage and adjacent paint side, never physical wall/jamb acceptance. */
export function nativePaintedFloorBoundarySupports(input: Input) {
  const fresh = nativePaintedFloorReview(input)
  const inspections: { floorId: string; edges: SourcePaintBoundarySupport[] }[] = []
  const finish = (reason: string | null) => ({
    ...fresh,
    boundaryInspection: {
      status: reason ? ('held' as const) : ('checked' as const),
      reason,
      floors: reason ? [] : inspections,
    },
  })
  if (fresh.refusalReason) return finish(fresh.refusalReason)
  const exact = nativeFaceRationalPredicates()
  const visibility = input.includeSpanVisibility
    ? createNativeSourceSpanVisibility(input.work)
    : undefined
  const paths = new Map(input.work.paths.map((path) => [pathKey(path), path]))
  // These are fill boundaries, not stroked edges admitted by nativePageSegments.
  // Keep their separate source semantics rather than loosening the legacy stroke contract.
  const segments = input.work.paths.flatMap((path): NativePageSegment[] => {
    if (path.paint === 'stroke' || !path.closed) return []
    const polygon = [...path.points]
    const first = polygon[0]
    const last = polygon.at(-1)
    if (first && last && first.x === last.x && first.y === last.y) polygon.pop()
    return polygon.map((start, segmentIndex) => ({
      operationIndex: path.operationIndex,
      subpathIndex: path.subpathIndex,
      segmentIndex,
      start,
      end: polygon[(segmentIndex + 1) % polygon.length] as PagePoint,
    }))
  })
  const sourceSegments = new Map(segments.map((segment) => [refKey(segment), segment]))
  const omissions = [
    ...(input.work.skippedCurveBounds ?? []),
    ...(input.work.clippedPathBounds ?? []),
  ]
  const paintEvents = pdfPaintInventoryIsComplete(input.work.paintBounds)
    ? new Map(input.work.paintBounds?.events.map((event) => [event.operationIndex, event]))
    : null
  let workLeft = 300_000
  let contactCount = 0
  const exhausted = Symbol('source-boundary-work-limit')
  const spend = () => {
    if (--workLeft < 0) throw exhausted
  }
  const windings = new Map<string, number>()
  const sourceWinding = (key: string) => {
    const cached = windings.get(key)
    if (cached !== undefined) return cached
    const path = paths.get(key)
    if (!path || path.paint === 'stroke' || !path.closed) throw new Error('Missing source paint')
    const polygon = [...path.points]
    const first = polygon[0]
    const last = polygon.at(-1)
    if (first && last && first.x === last.x && first.y === last.y) polygon.pop()
    const keys = polygon.map(exactNativePointKey)
    if (keys.some((key) => !key)) throw new Error('Unsupported source coordinates')
    const winding = exact.winding(keys as string[])
    if (!winding) throw new Error('Degenerate source paint')
    windings.set(key, winding)
    return winding
  }
  try {
    for (const floor of fresh.floors) {
      const boundarySupports: SourcePaintBoundarySupport[] = []
      const maskKeys = new Set(floor.masks.map(pathKey))
      const holeSources = segments.filter((segment) => maskKeys.has(pathKey(segment)))
      for (const [ringIndex, polygon] of [floor.polygon, ...floor.holes].entries()) {
        const keys =
          ringIndex === 0 ? floor.exactPointKeys : floor.holeExactPointKeys[ringIndex - 1]
        if (!keys || keys.length !== polygon.length) throw new Error('Missing ring keys')
        const regionSide = exact.winding(keys) * (ringIndex === 0 ? 1 : -1)
        if (!regionSide) throw new Error('Degenerate selected ring')
        for (const [edgeIndex, startKey] of keys.entries()) {
          const endKey = keys[(edgeIndex + 1) % keys.length] as string
          const row: SourcePaintBoundarySupport = {
            ringIndex,
            edgeIndex,
            sourceRegionSide: regionSide > 0 ? 'left' : 'right',
            declaredRole:
              ringIndex === 0
                ? (floor.edges[edgeIndex]?.declaredRole ?? 'unresolved')
                : 'unresolved',
            status: 'unobserved',
            coverage: 'unproved',
            reason: 'missing-source-span',
            omittedInkCount: 0,
            contacts: [],
          }
          const refs = ringIndex === 0 ? floor.edges[edgeIndex]?.sourceRefs : holeSources
          const axis = exact.compareAxis(startKey, endKey, 'x') === 0 ? 'y' : 'x'
          for (const ref of refs ?? []) {
            spend()
            const segment = sourceSegments.get(refKey(ref))
            if (
              !segment ||
              segment.start.x !== ref.start.x ||
              segment.start.y !== ref.start.y ||
              segment.end.x !== ref.end.x ||
              segment.end.y !== ref.end.y
            )
              throw new Error('Source edge snapshot mismatch')
            const a = exactNativePointKey(segment.start)
            const b = exactNativePointKey(segment.end)
            if (!a || !b) throw new Error('Unsupported source edge')
            const span = exact.sharedSpan(startKey, endKey, a, b)
            if (!span) continue
            if (
              ref.operationIndex >= 100_000 ||
              ref.subpathIndex > 3000 ||
              ref.segmentIndex > 20_000
            )
              return finish('source-boundary-ref-limit')
            const direction =
              exact.compareAxis(a, b, axis) * exact.compareAxis(startKey, endKey, axis)
            const paintSide = sourceWinding(pathKey(ref)) * direction
            row.contacts.push({
              operationIndex: ref.operationIndex,
              subpathIndex: ref.subpathIndex,
              segmentIndex: ref.segmentIndex,
              ...span,
              paintSide: paintSide === regionSide ? 'selected-region' : 'opposite-region',
              ...(visibility ? { visibility: visibility(ref, span.startKey, span.endKey) } : {}),
            })
            if (++contactCount > 10_000 || row.contacts.length > 100)
              return finish('source-boundary-contact-limit')
          }
          const displaySpan: [PagePoint, PagePoint] = [
            polygon[edgeIndex] as PagePoint,
            polygon[(edgeIndex + 1) % polygon.length] as PagePoint,
          ]
          for (const omission of omissions) {
            spend()
            const event = paintEvents?.get(omission.operationIndex)
            // Rounded display points are only conservative exclusion queries, never proof of contact.
            if (event?.kind !== 'vector' || pdfPaintMayTouchSpan(event, displaySpan, 0.0005))
              row.omittedInkCount++
          }
          if (row.contacts.length) {
            const complete = exact.coversSpan(startKey, endKey, row.contacts)
            const competingSides =
              new Set(row.contacts.map((contact) => contact.paintSide)).size > 1
            const competingSpans = row.contacts.some((contact, index) =>
              row.contacts.slice(index + 1).some((other) => {
                spend()
                return (
                  pathKey(contact) !== pathKey(other) &&
                  exact.sharedSpan(
                    contact.startKey,
                    contact.endKey,
                    other.startKey,
                    other.endKey,
                  ) !== null
                )
              }),
            )
            row.coverage = complete ? 'complete' : 'partial'
            row.status =
              competingSides || competingSpans ? 'ambiguous' : complete ? 'linked' : 'partial'
            row.reason = competingSides
              ? 'competing-source-sides'
              : competingSpans
                ? 'competing-source-spans'
                : complete
                  ? null
                  : 'partial-source-span'
          }
          boundarySupports.push(row)
        }
      }
      inspections.push({ floorId: floor.id, edges: boundarySupports })
    }
    return finish(null)
  } catch (error) {
    return finish(
      error instanceof NativeSourceVisibilityLimit
        ? error.message
        : error === exhausted
          ? 'source-boundary-work-limit'
          : 'source-boundary-unavailable',
    )
  }
}
