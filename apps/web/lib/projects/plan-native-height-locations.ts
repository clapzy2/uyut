import { nativeCaptionKnownPaintBlockers } from './plan-native-caption-paint'
import {
  exactNativePolygonContains,
  exactNativePolygonsOverlap,
  exactNativeSegmentsTouch,
} from './plan-native-exact-intersections'
import { nativeFloorCavityCandidates } from './plan-native-floor-cavities'
import { nativeHeightGroupBounds, nativeResetNoteBounds } from './plan-native-height-group'
import { createNativeHeightLeaderVerifier } from './plan-native-height-leaders'
import { nativeHeightObservations } from './plan-native-height-observations'
import { nativeCaptionInkIssue } from './plan-pdf-caption-binding'
import type { PagePoint } from './plan-pdf-linework'
import { pdfPolygonIsValid } from './plan-pdf-room-binding'

type Input = Parameters<typeof nativeHeightObservations>[0]
type LeaderProof = NonNullable<
  ReturnType<ReturnType<typeof createNativeHeightLeaderVerifier>>['proof']
>
type Row = {
  labelId: string
  status: 'inside-single-cavity' | 'ambiguous' | 'unresolved'
  cavityIds: string[]
  inkSourceOperation: number | null
  reason: string | null
  leader?: {
    status: 'linked' | 'ambiguous' | 'unresolved'
    cavityIds: string[]
    reason: string | null
    source?: Pick<LeaderProof, 'boxRefs' | 'stemRefs' | 'arrowRef'>
  }
}
const MAX_WORK = 500_000
const validPoint = (point: PagePoint | undefined | null): point is PagePoint =>
  !!point &&
  typeof point === 'object' &&
  [point.x, point.y].every((value) => Number.isFinite(value) && value >= 0 && value <= 1000)

/** Whole source-caption locations, not room owners, height acceptance or leader inference. */
export function nativeHeightSourceLocations(input: Input) {
  const observations: Row[] = []
  const finish = (refusalReason: string | null) => ({
    status: refusalReason ? ('unresolved' as const) : ('draft' as const),
    refusalReason,
    observations: refusalReason ? [] : structuredClone(observations),
    source: { ...input.source },
    image: { ...input.native.source },
    basis: 'whole-source-height-caption-ink-containment' as const,
    roomOwnershipConfirmed: false as const,
    assignsGeometryHeights: false as const,
    mayTransfer2D: false as const,
    mayTransfer3D: false as const,
    readOnly: true as const,
  })
  const heights = nativeHeightObservations(input)
  if (heights.refusalReason) return finish(heights.refusalReason)
  if (input.native.vectorInkRefusal) return finish(input.native.vectorInkRefusal)
  const ink = input.native.heightCaptionInk
  if (!ink) return finish('height-caption-ink-unavailable')
  if (!ink.source || typeof ink.source !== 'object') return finish('invalid-height-ink-inventory')
  if (
    ink.source.sha256 !== input.source.sha256 ||
    ink.source.pdfPage !== input.source.pdfPage ||
    ink.source.pageWidth !== input.work.pageWidth ||
    ink.source.pageHeight !== input.work.pageHeight
  )
    return finish('different-height-ink-source')
  if (
    !Array.isArray(ink.items) ||
    !Array.isArray(ink.unresolved) ||
    ink.items.length + ink.unresolved.length > 100 ||
    typeof ink.complete !== 'boolean' ||
    (ink.refusalReason !== null && typeof ink.refusalReason !== 'string')
  )
    return finish('invalid-height-ink-inventory')
  if (ink.refusalReason) return finish(ink.refusalReason)
  const labels = new Map(input.native.labels.map((label) => [label.nativeIndex, label]))
  const expected = new Set(
    heights.observations.map((row) => Number(row.labelId.slice('native-text-'.length))),
  )
  const indexes = new Set<number>()
  const operations = new Set<number>()
  const groupBounds = new Map<number, PagePoint[]>()
  for (const item of [...ink.items, ...ink.unresolved]) {
    if (
      !item ||
      typeof item !== 'object' ||
      !Number.isSafeInteger(item.index) ||
      !expected.has(item.index) ||
      indexes.has(item.index)
    )
      return finish('invalid-height-ink-inventory')
    indexes.add(item.index)
  }
  if (indexes.size !== expected.size || ink.complete !== (ink.unresolved.length === 0))
    return finish('incomplete-height-ink-inventory')
  if (
    ink.unresolved.some(
      (item) => typeof item.reason !== 'string' || !item.reason || item.reason.length > 200,
    )
  )
    return finish('invalid-height-ink-inventory')
  for (const item of ink.items) {
    const label = labels.get(item.index)
    if (item.sourceGroup || item.sourceResetCaption) {
      const bounds = label
        ? item.sourceResetCaption
          ? nativeResetNoteBounds(item, label, input.work)
          : nativeHeightGroupBounds(item, label, input.work)
        : null
      if (!bounds) return finish('invalid-height-ink-provenance')
      groupBounds.set(item.index, bounds)
    }
    if (
      !label?.pagePoint ||
      item.text !== label.name ||
      !Number.isSafeInteger(item.operationIndex) ||
      item.operationIndex < 0 ||
      operations.has(item.operationIndex) ||
      !Array.isArray(item.quad) ||
      item.quad.length !== 4 ||
      !item.quad.every(validPoint) ||
      !pdfPolygonIsValid(item.quad) ||
      !validPoint(item.baselineStart) ||
      !validPoint(item.baselineEnd) ||
      // Only floating arithmetic between the two extractor frames, never a
      // polygon snap or permission to move a caption across a boundary.
      (!groupBounds.has(item.index) &&
        (Math.abs(item.baselineStart.x - label.pagePoint.x) > 1e-7 ||
          Math.abs(item.baselineStart.y - label.pagePoint.y) > 1e-7))
    )
      return finish('invalid-height-ink-provenance')
    operations.add(item.operationIndex)
    for (const operation of item.sourceGroup?.operationIndexes.slice(1) ?? []) {
      if (operations.has(operation)) return finish('invalid-height-ink-provenance')
      operations.add(operation)
    }
    for (const show of item.sourceResetCaption?.shows.slice(1) ?? []) {
      if (operations.has(show.operationIndex)) return finish('invalid-height-ink-provenance')
      operations.add(show.operationIndex)
    }
    const dx = (item.baselineEnd.x - item.baselineStart.x) * input.work.pageWidth
    const dy = (item.baselineEnd.y - item.baselineStart.y) * input.work.pageHeight
    const angle = (-Math.atan2(dy, dx) * 180) / Math.PI
    const delta = Math.abs((angle - (label.rotation as number)) % 360)
    if ((dx === 0 && dy === 0) || Math.min(delta, 360 - delta) > 1e-6)
      return finish('invalid-height-ink-provenance')
  }
  const shapeIssue = nativeCaptionInkIssue(
    {
      source: ink.source,
      complete: ink.complete,
      items: ink.items.map((item) => ({
        index: item.index,
        text: item.text,
        rotation: labels.get(item.index)?.rotation as number,
        origin: item.baselineStart,
        baselineStart: item.baselineStart,
        baselineEnd: item.baselineEnd,
        inkPolygon: item.quad,
        inkSourceOperation: item.operationIndex,
      })),
    },
    input.work,
  )
  if (shapeIssue) return finish('invalid-height-ink-provenance')
  const floor = nativeFloorCavityCandidates(input)
  if (floor.refusalReason) return finish(floor.refusalReason)
  let work = MAX_WORK
  const exhausted = Symbol('height-location-work-limit')
  const verifyLeader = createNativeHeightLeaderVerifier(input.work)
  const locatePolygon = (polygon: readonly PagePoint[]) => {
    const bounds = {
      left: Math.min(...polygon.map((point) => point.x)),
      right: Math.max(...polygon.map((point) => point.x)),
      top: Math.min(...polygon.map((point) => point.y)),
      bottom: Math.max(...polygon.map((point) => point.y)),
    }
    const overlapsBounds = (other: typeof bounds) =>
      other.left <= bounds.right &&
      other.right >= bounds.left &&
      other.top <= bounds.bottom &&
      other.bottom >= bounds.top
    const cavityIds: string[] = []
    let blocked = false
    for (const cell of floor.cavities) {
      work -= cell.polygon.length * (polygon.length * 4)
      if (work < 0) throw exhausted
      const contains = exactNativePolygonContains(cell.polygon, polygon)
      const overlap = exactNativePolygonsOverlap(cell.polygon, polygon)
      const touch = cell.polygon.some((start, index) =>
        polygon.some(
          (point, corner) =>
            exactNativeSegmentsTouch(
              { start, end: cell.polygon[(index + 1) % cell.polygon.length] as PagePoint },
              { start: point, end: polygon[(corner + 1) % polygon.length] as PagePoint },
            ) !== false,
        ),
      )
      if (contains === null || overlap === null || touch || (overlap && !contains)) blocked = true
      if (contains === true) {
        cavityIds.push(cell.id)
        if (cell.omittedBoundaryInkCount > 0) blocked = true
      }
    }
    cavityIds.sort()
    if (floor.unprovedCavities.some(({ bounds }) => overlapsBounds(bounds))) blocked = true
    if (
      [...(input.work.skippedCurveBounds ?? []), ...(input.work.clippedPathBounds ?? [])].some(
        ({ bounds }) => overlapsBounds(bounds),
      )
    )
      blocked = true
    return { cavityIds, blocked }
  }
  try {
    for (const height of heights.observations) {
      const label = input.native.labels.find((label) => label.id === height.labelId)
      const item = ink.items.find((item) => item.index === label?.nativeIndex)
      const row: Row = {
        labelId: height.labelId,
        status: 'unresolved',
        cavityIds: [],
        inkSourceOperation: item?.operationIndex ?? null,
        reason: 'height-caption-ink-unverified',
      }
      observations.push(row)
      if (!item) continue
      const captionBounds = groupBounds.get(item.index) ?? item.quad
      if (item.sourceResetCaption) {
        const blockers = nativeCaptionKnownPaintBlockers(
          input.work.paintBounds,
          item.sourceResetCaption.shows.map((show) => show.operationIndex),
          captionBounds,
        )
        if (blockers === null || blockers.length > 0) {
          row.reason =
            blockers === null
              ? 'height-caption-paint-unverified'
              : 'height-caption-covered-by-paint'
          continue
        }
      }
      const location = locatePolygon(captionBounds)
      row.cavityIds = location.cavityIds
      if (row.cavityIds.length > 1) {
        row.status = 'ambiguous'
        row.reason = 'competing-height-caption-cavities'
      } else if (location.blocked) {
        row.reason = 'height-caption-boundary-or-ink-unverified'
      } else if (row.cavityIds.length === 1) {
        row.status = 'inside-single-cavity'
        row.reason = null
      } else {
        row.reason = 'outboard-height-caption-leader-unverified'
      }
      // Caption position and the leader's annotation target are different facts.
      // Even a perfect chain supplies neither a semantic owner nor a floor datum.
      const leader = verifyLeader(captionBounds)
      if (leader.reason === 'height-leader-work-limit') return finish(leader.reason)
      row.leader = {
        status: leader.status === 'ambiguous' ? 'ambiguous' : 'unresolved',
        cavityIds: [],
        reason: leader.reason ?? 'height-leader-target-unverified',
      }
      if (leader.status === 'candidate' && leader.proof) {
        const target = locatePolygon(leader.proof.arrowPolygon)
        row.leader.cavityIds = target.cavityIds
        row.leader.source = {
          boxRefs: structuredClone(leader.proof.boxRefs),
          stemRefs: structuredClone(leader.proof.stemRefs),
          arrowRef: { ...leader.proof.arrowRef },
        }
        if (target.cavityIds.length > 1) {
          row.leader.status = 'ambiguous'
          row.leader.reason = 'competing-height-leader-targets'
        } else if (target.blocked || target.cavityIds.length !== 1) {
          row.leader.reason = 'height-leader-target-unverified'
        } else {
          row.leader.status = 'linked'
          row.leader.reason = null
        }
      }
    }
    return finish(null)
  } catch (error) {
    if (error === exhausted) return finish('height-location-work-limit')
    throw error
  }
}
