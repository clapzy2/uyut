import type { PlanGeometry, PlanPoint } from '@uyut/db'
import polygonClipping, { type Polygon } from 'polygon-clipping'
import { cross, dot, integerPoints, onIntegerSegment, sign, vector } from './plan-exact-geometry'
import {
  currentOpeningFacePairs,
  currentOpeningWidthProofs,
  currentWallFacePairs,
} from './plan-opening-face-pairs'
import { inspectPlanVerticalDimensions } from './plan-vertical-dimensions'
import { signedPlanFloors } from './plan-vertical-floor-geometry'
import type { PlanGeometryIssue, VolumeFloorSurface, VolumeThreshold } from './plan-volume-types'

type Cut = [PlanPoint, PlanPoint]
const same = (a: PlanPoint, b: PlanPoint) => a.xCm === b.xCm && a.yCm === b.yCm
const body = (polygon: PlanPoint[]): Polygon => [polygon.map(({ xCm, yCm }) => [xCm, yCm])]
const floorBody = (floor: VolumeFloorSurface): Polygon =>
  [floor.floor, ...floor.voids].map((ring) => ring.map(({ xCm, yCm }) => [xCm, yCm]))

function validCut(value: unknown): value is Cut {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    [value[0], value[1]].every(
      (point) =>
        point &&
        typeof point === 'object' &&
        Object.keys(point).length === 2 &&
        Number.isFinite(point.xCm) &&
        Number.isFinite(point.yCm) &&
        Math.abs(point.xCm) <= 10000 &&
        Math.abs(point.yCm) <= 10000,
    ) &&
    !same(value[0], value[1])
  )
}

/** Preserved source ends only. A missing or contradictory cut is never interpolated. */
export function planOpeningEndpoints(geometry: PlanGeometry, id: string): Cut | undefined {
  const bindings = currentOpeningFacePairs(geometry).flatMap((pair) => pair.bindings)
  for (const proof of currentOpeningWidthProofs(geometry)) {
    bindings.push(proof)
    if (proof.oppositeBinding) bindings.push(proof.oppositeBinding)
  }
  const claims = bindings.filter((binding) => binding.opening.id === id)
  if (!claims.length || claims.some((binding) => !validCut(binding.cut))) return undefined
  const first = claims[0]?.cut
  if (
    !first ||
    claims.some(
      ({ cut }) =>
        !cut ||
        !(
          (same(first[0], cut[0]) && same(first[1], cut[1])) ||
          (same(first[0], cut[1]) && same(first[1], cut[0]))
        ),
    )
  )
    return undefined
  const opening = geometry.openings.find((opening) => opening.id === id)
  const wall = geometry.walls.find((wall) => wall.id === opening?.wallId)
  if (!opening || !wall) return undefined
  const [start, end, a, b] = integerPoints([wall.start, wall.end, ...first])
  if (
    !start ||
    !end ||
    !a ||
    !b ||
    !onIntegerSegment(a, start, end) ||
    !onIntegerSegment(b, start, end)
  )
    return undefined
  const width = Math.hypot(first[1].xCm - first[0].xCm, first[1].yCm - first[0].yCm)
  const offset = Math.min(
    ...first.map((point) => Math.hypot(point.xCm - wall.start.xCm, point.yCm - wall.start.yCm)),
  )
  // This checks the rounded storage binding only, and never changes the source ends.
  if (Math.abs(width - opening.widthCm) > 0.2 || Math.abs(offset - opening.offsetCm) > 0.2)
    return undefined
  return structuredClone(first)
}

/** Parallel equal intervals with exact paired jamb projections; no bounding rectangle. */
function thresholdPolygon(
  first: Cut,
  second: Cut,
  firstRoom: PlanPoint[],
  secondRoom: PlanPoint[],
): PlanPoint[] | undefined {
  const [a, b, c, d, ...vertices] = integerPoints([
    ...first,
    ...second,
    ...firstRoom,
    ...secondRoom,
  ])
  if (!a || !b || !c || !d) return undefined
  const along = vector(a, b)
  const secondAlong = vector(c, d)
  const reverse = dot(along, secondAlong) < 0n
  const start = reverse ? d : c
  const end = reverse ? c : d
  const parallel = vector(start, end)
  const across = vector(a, start)
  if (
    along.x !== parallel.x ||
    along.y !== parallel.y ||
    dot(along, across) !== 0n ||
    cross(along, across) === 0n
  )
    return undefined
  const ownerSide = (
    cutStart: typeof a,
    cutEnd: typeof b,
    ring: typeof vertices,
  ): number | undefined => {
    let area = 0n
    const sides: number[] = []
    for (const [index, edgeStart] of ring.entries()) {
      const edgeEnd = ring[(index + 1) % ring.length]
      if (!edgeEnd) return undefined
      area += cross(edgeStart, edgeEnd)
      if (
        onIntegerSegment(cutStart, edgeStart, edgeEnd) &&
        onIntegerSegment(cutEnd, edgeStart, edgeEnd)
      )
        sides.push(sign(dot(vector(edgeStart, edgeEnd), along)))
    }
    return sides.length === 1 ? sign(area) * (sides[0] ?? 0) : undefined
  }
  const direction = sign(cross(along, across))
  if (
    ownerSide(a, b, vertices.slice(0, firstRoom.length)) !== -direction ||
    ownerSide(start, end, vertices.slice(firstRoom.length)) !== direction
  )
    return undefined
  const opposite: Cut = reverse ? [second[1], second[0]] : second
  return [first[0], first[1], opposite[1], opposite[0]].map((point) => ({ ...point }))
}

/** Exact convex clipping: touching an edge is not a wall crossing the threshold interior. */
function crossesThresholdInterior(start: PlanPoint, end: PlanPoint, polygon: PlanPoint[]): boolean {
  const [a, b, ...ring] = integerPoints([start, end, ...polygon])
  if (!a || !b) return true
  let area = 0n
  for (const [index, point] of ring.entries()) {
    const next = ring[(index + 1) % ring.length]
    if (!next) return true
    area += cross(point, next)
  }
  const direction = BigInt(sign(area))
  if (direction === 0n) return true
  let lower = { numerator: 0n, denominator: 1n }
  let upper = { numerator: 1n, denominator: 1n }
  const less = (first: typeof lower, second: typeof lower) =>
    first.numerator * second.denominator < second.numerator * first.denominator
  for (const [index, point] of ring.entries()) {
    const next = ring[(index + 1) % ring.length]
    if (!next) return true
    const edge = vector(point, next)
    const from = direction * cross(edge, vector(point, a))
    const to = direction * cross(edge, vector(point, b))
    if (from <= 0n && to <= 0n) return false
    if (from > 0n && to > 0n) continue
    if (from <= 0n) {
      const bound = { numerator: -from, denominator: to - from }
      if (less(lower, bound)) lower = bound
    } else {
      const bound = { numerator: from, denominator: from - to }
      if (less(bound, upper)) upper = bound
    }
    if (!less(lower, upper)) return false
  }
  return less(lower, upper)
}

/** Known threshold tops only. The slab thickness, riser and step accessibility stay unknown. */
export function inspectPlanThresholdSurfaces(geometry: PlanGeometry): {
  surfaces: VolumeThreshold[]
  issues: PlanGeometryIssue[]
} {
  const signed = signedPlanFloors(geometry)
  if (!signed) return { surfaces: [], issues: [] }
  if (!signed.ok)
    return {
      surfaces: [],
      issues: [{ id: 'threshold-reference', severity: 'error', message: signed.error }],
    }
  const { reference, surfaces: floors } = signed
  const verticalIssues = inspectPlanVerticalDimensions(geometry)
  if (verticalIssues.length) return { surfaces: [], issues: verticalIssues }
  const extent = geometry.footprint
  if (!extent) return { surfaces: [], issues: [] }
  const sourceStrips =
    geometry.pdfCalibration?.sourceWallFacePairs ?? geometry.pdfCalibration?.wallFacePairs ?? []
  const currentStrips = currentWallFacePairs(geometry)
  if (currentStrips.length !== sourceStrips.length)
    return {
      surfaces: [],
      issues: reference.thresholds.map((threshold) => ({
        id: `volume-threshold-${threshold.id}`,
        severity: 'warning',
        openingIds: threshold.bindings.map((side) => side.opening.id),
        message:
          'Грани других стен изменились: поверхность порога удерживается до пересверки исходных связей. Подтверждённые отметки пола не заменяются нулём.',
      })),
    }
  const owners = new Map(reference.floors.map((floor) => [floor.id, floor]))
  const candidates = reference.thresholds.map((threshold) => {
    const [a, b] = threshold.bindings
    const first = planOpeningEndpoints(geometry, a.opening.id)
    const second = planOpeningEndpoints(geometry, b.opening.id)
    const firstFloor = owners.get(a.floorId)
    const secondFloor = owners.get(b.floorId)
    return {
      threshold,
      firstFloor,
      secondFloor,
      polygon:
        first && second && firstFloor && secondFloor
          ? thresholdPolygon(first, second, firstFloor.room.polygon, secondFloor.room.polygon)
          : undefined,
    }
  })
  const strips = currentStrips.map(({ faces: [a, b] }) => body([a.start, a.end, b.end, b.start]))
  const issues: PlanGeometryIssue[] = []
  const surfaces: VolumeThreshold[] = []
  for (const { threshold, firstFloor, secondFloor, polygon } of candidates) {
    if (
      !polygon ||
      !firstFloor ||
      !secondFloor ||
      geometry.walls.some((wall) => crossesThresholdInterior(wall.start, wall.end, polygon)) ||
      polygonClipping.difference(body(polygon), body(extent)).length > 0 ||
      [
        ...strips,
        ...floors.map(floorBody),
        ...(geometry.voids ?? []).map((region) => body(region.polygon)),
      ].some((other) => polygonClipping.intersection(body(polygon), other).length > 0) ||
      candidates.some(
        (other) =>
          other.threshold.id !== threshold.id &&
          other.polygon &&
          polygonClipping.intersection(body(polygon), body(other.polygon)).length > 0,
      )
    ) {
      issues.push({
        id: `volume-threshold-${threshold.id}`,
        severity: 'warning',
        openingIds: threshold.bindings.map((side) => side.opening.id),
        message:
          'Отметка порога сохранена, но его поверхность не имеет однозначных исходных граней и косяков либо пересекает другой контур. Толщина, ступень и промежуточный пол не достраиваются.',
      })
      continue
    }
    surfaces.push({
      id: threshold.id,
      floor: polygon,
      elevationCm: threshold.elevationCm,
      floorIds: [firstFloor.id, secondFloor.id],
      floorElevationsCm: [firstFloor.elevationCm, secondFloor.elevationCm],
    })
  }
  return { surfaces, issues }
}
