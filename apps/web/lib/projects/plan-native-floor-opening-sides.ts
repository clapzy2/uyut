import {
  exactNativeOrientation,
  exactNativePointKey,
  exactNativePolygonsOverlap,
  exactNativePolygonWinding,
} from './plan-native-exact-intersections'
import type { nativeFloorCavityCandidates } from './plan-native-floor-cavities'
import { exactNativeOpeningFrameShape } from './plan-native-opening-frames'
import type { nativeOpeningSourceLinks } from './plan-native-opening-links'
import type { Bounds } from './plan-pdf-linework'

export type NativeFloorOpeningSide = {
  frameEdgeIndex: number
  status: 'matched' | 'partial' | 'ambiguous' | 'unobserved' | 'unresolved'
  contacts: {
    cavityId: string
    coverage: 'complete' | 'partial' | 'unproved'
    boundaryEdgeIndices: number[]
  }[]
}
export type NativeFloorOpeningFrame = {
  frameId: string
  status: 'two-sided' | 'one-sided' | 'same-cavity' | 'ambiguous' | 'unresolved'
  reason: string | null
  sides: NativeFloorOpeningSide[]
  doorSymbolIds: string[]
  omittedInkCount: number
}
export type NativeFloorOpeningReport = {
  status: 'draft' | 'unresolved'
  refusalReason: string | null
  frames: NativeFloorOpeningFrame[]
}
type Floor = ReturnType<typeof nativeFloorCavityCandidates>
type Links = ReturnType<typeof nativeOpeningSourceLinks>
const MAX_WORK = 1_000_000
const samePoint = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  a.x === b.x && a.y === b.y
const overlapBounds = (a: Bounds, b: Bounds) =>
  a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top

/** Fresh source-cavity correspondence to logical frame sides, never a physical passage graph. */
export function nativeFloorOpeningSides(floor: Floor, links: Links) {
  const frames: NativeFloorOpeningFrame[] = []
  const finish = (refusalReason: string | null) => ({
    status: refusalReason ? ('unresolved' as const) : ('draft' as const),
    refusalReason,
    frames: refusalReason ? [] : structuredClone(frames),
    source: { ...floor.source },
    originalPdfSha256: floor.originalPdfSha256,
    basis: 'source-cavity-boundary-to-logical-frame-sides' as const,
    readOnly: true as const,
    completeOpeningInventory: false as const,
    roomOwnershipConfirmed: false as const,
    physicalPassagesAccepted: false as const,
    readyFor2D: false as const,
    readyFor3D: false as const,
  })
  if (floor.status !== 'draft' || links.openingFrames.status !== 'draft')
    return finish('floor-or-frame-inventory-unavailable')
  if (
    floor.originalPdfSha256 !== links.originalPdfSha256 ||
    floor.originalPdfSha256 !== links.openingFrames.originalPdfSha256 ||
    !floor.originalPdfSha256 ||
    !/^[a-f0-9]{64}$/u.test(floor.originalPdfSha256) ||
    ['sha256', 'page', 'width', 'height'].some((key) => {
      const field = key as keyof Floor['source']
      return (
        floor.source[field] !== links.source[field] ||
        floor.source[field] !== links.openingFrames.source[field]
      )
    })
  )
    return finish('different-floor-frame-source')
  const candidates = links.openingFrames.candidates
  if (
    candidates.length > 100 ||
    floor.cavities.length > 100 ||
    floor.thresholds.length > 100 ||
    floor.unprovedCavities.length > 100 ||
    candidates.some(
      (frame) => frame.frame.points.length > 5 || frame.unresolvedInk.length > 6000,
    ) ||
    floor.cavities.some(
      (cell) => cell.polygon.length > 100 || cell.boundaries.length !== cell.polygon.length,
    ) ||
    floor.cavities.reduce((sum, cell) => sum + cell.polygon.length, 0) > 4000 ||
    links.doorLinks.length > 100 ||
    new Set(candidates.map(({ id }) => id)).size !== candidates.length ||
    new Set(floor.cavities.map(({ id }) => id)).size !== floor.cavities.length ||
    new Set(floor.thresholds.map(({ frameId }) => frameId)).size !== floor.thresholds.length
  )
    return finish('floor-frame-side-input-limit')
  if (
    floor.cavities.some((cell) =>
      cell.boundaries.some(
        (edge, index) =>
          !samePoint(edge.start, cell.polygon[index] as { x: number; y: number }) ||
          !samePoint(
            edge.end,
            cell.polygon[(index + 1) % cell.polygon.length] as { x: number; y: number },
          ),
      ),
    )
  )
    return finish('unsupported-cavity-boundary-order')
  let work = MAX_WORK
  let contactCount = 0
  let proofIndexCount = 0
  const exhausted = Symbol('floor-frame-side-work-limit')
  const spend = (count = 1) => {
    work -= count
    if (work < 0) throw exhausted
  }
  const windings = new Map(
    floor.cavities.map((cell) => [cell.id, exactNativePolygonWinding(cell.polygon)]),
  )
  if ([...windings.values()].some((winding) => winding === null))
    return finish('unsupported-cavity-winding')
  try {
    for (const frame of candidates) {
      spend()
      const row: NativeFloorOpeningFrame = {
        frameId: frame.id,
        status: 'unresolved',
        reason: 'logical-strip-unavailable',
        sides: [],
        doorSymbolIds:
          links.status === 'draft'
            ? links.doorLinks
                .filter(
                  (link) =>
                    link.status === 'linked' &&
                    link.targetKind === 'opening-frame' &&
                    link.targetId === frame.id,
                )
                .map(({ symbolId }) => symbolId)
            : [],
        omittedInkCount: frame.unresolvedInk.length,
      }
      frames.push(row)
      const threshold = floor.thresholds.find(({ frameId }) => frameId === frame.id)
      if (!threshold) continue
      if (threshold.paintColors.length !== 1) {
        row.status = 'ambiguous'
        row.reason = 'competing-strip-paint'
        continue
      }
      const first = frame.frame.points[0],
        last = frame.frame.points.at(-1)
      const polygon =
        first && last && first.x === last.x && first.y === last.y
          ? frame.frame.points.slice(0, -1)
          : frame.frame.points
      if (!exactNativeOpeningFrameShape(polygon) || frame.longEdges.length !== 2)
        return finish('unsupported-source-frame-sides')
      const bounds: Bounds = {
        left: Math.min(...polygon.map((point) => point.x)),
        right: Math.max(...polygon.map((point) => point.x)),
        top: Math.min(...polygon.map((point) => point.y)),
        bottom: Math.max(...polygon.map((point) => point.y)),
      }
      const frameWinding = exactNativePolygonWinding(polygon)
      if (frameWinding === null) return finish('unsupported-source-frame-sides')
      if (
        polygon.some((point) => exactNativePointKey(point) === null) ||
        frame.longEdges.some(
          (side) =>
            !Number.isSafeInteger(side.segmentIndex) ||
            side.segmentIndex < 0 ||
            side.segmentIndex > 3 ||
            side.operationIndex !== frame.frame.operationIndex ||
            side.subpathIndex !== frame.frame.subpathIndex ||
            !samePoint(side.start, polygon[side.segmentIndex] as { x: number; y: number }) ||
            !samePoint(side.end, polygon[(side.segmentIndex + 1) % 4] as { x: number; y: number }),
        ) ||
        Math.abs(
          (frame.longEdges[0]?.segmentIndex ?? -1) - (frame.longEdges[1]?.segmentIndex ?? -1),
        ) !== 2 ||
        threshold.polygon.length !== polygon.length ||
        threshold.polygon.some(
          (point, index) => !samePoint(point, polygon[index] as { x: number; y: number }),
        )
      )
        return finish('unsupported-source-frame-sides')
      const overlaps = floor.cavities.some((cell) => {
        spend(cell.polygon.length * 16)
        return exactNativePolygonsOverlap(cell.polygon, polygon) !== false
      })
      if (overlaps) {
        row.status = 'ambiguous'
        row.reason = 'strip-overlaps-cavity'
        continue
      }
      if (floor.unprovedCavities.some((cell) => overlapBounds(bounds, cell.bounds))) {
        row.reason = 'unproved-neighbor-region'
        continue
      }
      for (const side of frame.longEdges) {
        const along = side.start.x === side.end.x ? 'y' : 'x'
        const from = Math.min(side.start[along], side.end[along])
        const to = Math.max(side.start[along], side.end[along])
        const frameDirection = frameWinding * Math.sign(side.end[along] - side.start[along])
        const contacts: NativeFloorOpeningSide['contacts'] = []
        for (const cell of floor.cavities) {
          const intervals: { from: number; to: number }[] = []
          const boundaryEdgeIndices: number[] = []
          let unproved = cell.paintColor !== threshold.paintColors[0]
          for (const [index, edge] of cell.boundaries.entries()) {
            spend()
            if (
              exactNativeOrientation(side.start, side.end, edge.start) !== 0 ||
              exactNativeOrientation(side.start, side.end, edge.end) !== 0
            )
              continue
            const start = Math.max(from, Math.min(edge.start[along], edge.end[along]))
            const end = Math.min(to, Math.max(edge.start[along], edge.end[along]))
            if (start >= end) continue
            boundaryEdgeIndices.push(index)
            const cavityDirection =
              (windings.get(cell.id) as number) * Math.sign(edge.end[along] - edge.start[along])
            // Adjacent interiors must lie on opposite sides of this exact source line.
            // A page-space bounding box cannot establish that for a rotated strip.
            if (cavityDirection !== -frameDirection) unproved = true
            const supports: { from: number; to: number }[] = []
            for (const support of edge.supports) {
              spend()
              if (support.kind !== 'frame-side' || support.id !== frame.id) continue
              const ref = support.edge
              if (
                ref.operationIndex !== side.operationIndex ||
                ref.subpathIndex !== side.subpathIndex ||
                ref.segmentIndex !== side.segmentIndex ||
                ref.start.x !== side.start.x ||
                ref.start.y !== side.start.y ||
                ref.end.x !== side.end.x ||
                ref.end.y !== side.end.y ||
                exactNativeOrientation(side.start, side.end, ref.start) !== 0 ||
                exactNativeOrientation(side.start, side.end, ref.end) !== 0
              )
                continue
              supports.push({
                from: Math.max(start, Math.min(ref.start[along], ref.end[along])),
                to: Math.min(end, Math.max(ref.start[along], ref.end[along])),
              })
            }
            if (!supports.some((interval) => interval.from === start && interval.to === end))
              unproved = true
            intervals.push({ from: start, to: end })
          }
          if (!intervals.length) continue
          let covered = from
          for (const interval of intervals.sort((a, b) => a.from - b.from || b.to - a.to)) {
            if (interval.from > covered) break
            covered = Math.max(covered, interval.to)
          }
          contacts.push({
            cavityId: cell.id,
            coverage: unproved ? 'unproved' : covered === to ? 'complete' : 'partial',
            boundaryEdgeIndices,
          })
          contactCount++
          proofIndexCount += boundaryEdgeIndices.length
          if (contactCount > 1000 || proofIndexCount > 10_000)
            return finish('floor-frame-side-output-limit')
        }
        const contact = contacts[0]
        const status: NativeFloorOpeningSide['status'] =
          contacts.length > 1
            ? 'ambiguous'
            : !contact
              ? 'unobserved'
              : contact.coverage === 'complete'
                ? 'matched'
                : contact.coverage === 'partial'
                  ? 'partial'
                  : 'unresolved'
        row.sides.push({ frameEdgeIndex: side.segmentIndex, status, contacts })
      }
      if (row.sides.some(({ status }) => status === 'ambiguous')) {
        row.status = 'ambiguous'
        row.reason = 'competing-cavity-contacts'
      } else if (row.sides.every(({ status }) => status === 'matched')) {
        row.status =
          row.sides[0]?.contacts[0]?.cavityId === row.sides[1]?.contacts[0]?.cavityId
            ? 'same-cavity'
            : 'two-sided'
        row.reason = null
      } else if (
        row.sides.filter(({ status }) => status === 'matched').length === 1 &&
        row.sides.some(({ status }) => status === 'unobserved')
      ) {
        row.status = 'one-sided'
        row.reason = 'unobserved-opposite-cavity'
      } else row.reason = 'incomplete-cavity-contacts'
    }
    return finish(null)
  } catch (error) {
    return finish(
      error === exhausted ? 'floor-frame-side-work-limit' : 'floor-frame-side-unresolved',
    )
  }
}
