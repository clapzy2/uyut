import type { PlanPoint, PlanWall } from '@uyut/db'

function samePoint(first: PlanPoint, second: PlanPoint): boolean {
  return first.xCm === second.xCm && first.yCm === second.yCm
}

/** Copy an existing closed wall ring without snapping gaps or replacing it by a rectangle. */
export function floorBoundaryFromWalls(walls: readonly PlanWall[]): PlanPoint[] | undefined {
  const outer = walls.filter((wall) => wall.kind === 'outer')
  const first = outer[0]
  if (!first || outer.length < 3 || outer.length > 200) return undefined
  const used = new Set([first.id])
  const points = [{ ...first.start }]
  let end = first.end
  while (!samePoint(end, first.start)) {
    points.push({ ...end })
    const candidates = outer.filter(
      (wall) => !used.has(wall.id) && (samePoint(wall.start, end) || samePoint(wall.end, end)),
    )
    const next = candidates[0]
    if (candidates.length !== 1 || !next) return undefined
    used.add(next.id)
    end = samePoint(next.start, end) ? next.end : next.start
  }
  return used.size === outer.length && points.length >= 3 ? points : undefined
}
