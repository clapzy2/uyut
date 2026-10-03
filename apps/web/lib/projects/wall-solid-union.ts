import type { PlanGeometry, PlanPoint } from '@uyut/db'
import polygonClipping, { type MultiPolygon, type Polygon, type Ring } from 'polygon-clipping'
import type { PlanGeometryIssue } from './plan-geometry-inspection'
import type { PlanSolidFace, WallSpan } from './plan-volume'

type Prism = {
  wallId: string
  kind: WallSpan['kind']
  polygon: Polygon
  bottom: number
  top: number
}
type Slice = { bottom: number; top: number; body: MultiPolygon; prisms: Prism[] }

function footprint(start: PlanPoint, end: PlanPoint, thickness: number): Polygon {
  const length = Math.hypot(end.xCm - start.xCm, end.yCm - start.yCm)
  const nx = (-(end.yCm - start.yCm) * thickness) / (2 * length)
  const ny = ((end.xCm - start.xCm) * thickness) / (2 * length)
  return [
    [
      [start.xCm - nx, start.yCm - ny],
      [end.xCm - nx, end.yCm - ny],
      [end.xCm + nx, end.yCm + ny],
      [start.xCm + nx, start.yCm + ny],
    ],
  ]
}

function ringArea(ring: Ring): number {
  return (
    ring.reduce((sum, point, index) => {
      const next = ring[(index + 1) % ring.length]
      return next ? sum + point[0] * next[1] - next[0] * point[1] : sum
    }, 0) / 2
  )
}

function area(polygons: MultiPolygon): number {
  return polygons.reduce(
    (total, polygon) => total + polygon.reduce((sum, ring) => sum + ringArea(ring), 0),
    0,
  )
}

function touchesEdge(point: [number, number], polygon: Polygon): boolean {
  return polygon.some((ring) =>
    ring.some((start, index) => {
      const end = ring[(index + 1) % ring.length]
      if (!end) return false
      const dx = end[0] - start[0]
      const dy = end[1] - start[1]
      const length = Math.hypot(dx, dy)
      if (length === 0) return false
      const distance = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / length
      const normal = Math.abs((point[0] - start[0]) * dy - (point[1] - start[1]) * dx) / length
      return normal < 1e-6 && distance >= -1e-6 && distance <= length + 1e-6
    }),
  )
}

function blockedOpenings(prisms: Prism[], geometry: PlanGeometry): PlanGeometryIssue[] {
  const issues: PlanGeometryIssue[] = []
  for (const [index, opening] of geometry.openings.entries()) {
    const wall = geometry.walls.find((item) => item.id === opening.wallId)
    if (
      !wall?.heightCm ||
      !wall.measuredThicknessCm ||
      opening.bottomCm === undefined ||
      opening.heightCm === undefined
    )
      continue
    const bottom = opening.bottomCm
    const top = bottom + opening.heightCm
    const length = Math.hypot(wall.end.xCm - wall.start.xCm, wall.end.yCm - wall.start.yCm)
    const pointAt = (distance: number) => ({
      xCm: wall.start.xCm + ((wall.end.xCm - wall.start.xCm) * distance) / length,
      yCm: wall.start.yCm + ((wall.end.yCm - wall.start.yCm) * distance) / length,
    })
    const hole = footprint(
      pointAt(opening.offsetCm),
      pointAt(opening.offsetCm + opening.widthCm),
      wall.measuredThicknessCm,
    )
    const overlapping = prisms.filter(
      (prism) =>
        prism.wallId !== wall.id &&
        prism.bottom < top &&
        prism.top > bottom &&
        area(polygonClipping.intersection(hole, prism.polygon)) > 1e-6,
    )
    if (overlapping.length)
      issues.push({
        id: `volume-opening-overlap-${opening.id}`,
        severity: 'warning',
        message: `Проём ${index + 1} пересекается с объёмом другой стены. Сверьте его положение и мерки стен в редакторе.`,
        openingIds: [opening.id],
        wallIds: [wall.id, ...new Set(overlapping.map((prism) => prism.wallId))],
      })
  }
  return issues
}

function capFaces(body: MultiPolygon, height: number, upward: boolean, faces: PlanSolidFace[]) {
  const pointsAt = (ring: Ring) => {
    const points = ring.slice(0, -1).map(([xCm, yCm]) => ({ xCm, yCm, zCm: height }))
    return upward ? points : points.reverse()
  }
  for (const polygon of body) {
    const outer = polygon[0]
    if (!outer) continue
    faces.push({
      id: `joined-${faces.length}`,
      kind: 'inner',
      role: 'cap',
      points: pointsAt(outer),
      holes: polygon.slice(1).map(pointsAt),
    })
  }
}

/** Union each measured horizontal slice; never add material to bridge an unknown gap. */
export function joinWallSolids(
  walls: readonly WallSpan[],
  geometry: PlanGeometry,
): { faces: PlanSolidFace[]; issues: PlanGeometryIssue[] } | undefined | null {
  const solidWalls = walls.filter(
    (wall): wall is WallSpan & { topCm: number; thicknessCm: number } =>
      Boolean(wall.solid) && wall.topCm !== undefined && wall.thicknessCm !== undefined,
  )
  if (new Set(solidWalls.map((wall) => wall.wallId)).size < 2) return undefined
  const prisms: Prism[] = solidWalls.map((wall) => ({
    wallId: wall.wallId,
    kind: wall.kind,
    polygon: footprint(wall.start, wall.end, wall.thicknessCm),
    bottom: wall.bottomCm,
    top: wall.topCm,
  }))
  try {
    const levels = [...new Set(prisms.flatMap((prism) => [prism.bottom, prism.top]))].sort(
      (a, b) => a - b,
    )
    const slices: Slice[] = []
    for (let index = 1; index < levels.length; index++) {
      const bottom = levels[index - 1]
      const top = levels[index]
      if (bottom === undefined || top === undefined) continue
      const active = prisms.filter((prism) => prism.bottom < top && prism.top > bottom)
      const first = active[0]
      slices.push({
        bottom,
        top,
        prisms: active,
        body: first
          ? polygonClipping.union(first.polygon, ...active.slice(1).map((prism) => prism.polygon))
          : [],
      })
    }
    const faces: PlanSolidFace[] = []
    for (const [index, slice] of slices.entries()) {
      for (const polygon of slice.body) {
        for (const ring of polygon) {
          for (let edge = 1; edge < ring.length; edge++) {
            const start = ring[edge - 1]
            const end = ring[edge]
            if (!start || !end) continue
            const midpoint: [number, number] = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]
            const outer = slice.prisms.some(
              (prism) => prism.kind === 'outer' && touchesEdge(midpoint, prism.polygon),
            )
            faces.push({
              id: `joined-${faces.length}`,
              kind: outer ? 'outer' : 'inner',
              role: 'face',
              points: [
                { xCm: start[0], yCm: start[1], zCm: slice.bottom },
                { xCm: end[0], yCm: end[1], zCm: slice.bottom },
                { xCm: end[0], yCm: end[1], zCm: slice.top },
                { xCm: start[0], yCm: start[1], zCm: slice.top },
              ],
            })
          }
        }
      }
      const below = slices[index - 1]?.body ?? []
      const above = slices[index + 1]?.body ?? []
      capFaces(
        below.length ? polygonClipping.difference(slice.body, below) : slice.body,
        slice.bottom,
        false,
        faces,
      )
      capFaces(
        above.length ? polygonClipping.difference(slice.body, above) : slice.body,
        slice.top,
        true,
        faces,
      )
    }
    return { faces, issues: blockedOpenings(prisms, geometry) }
  } catch {
    // Do not silently fall back to intersecting solids and present them as a joined model.
    return null
  }
}
