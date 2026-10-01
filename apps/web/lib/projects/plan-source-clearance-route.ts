import type { PlanPoint } from '@uyut/db'
import polygonClipping, { type MultiPolygon, type Polygon } from 'polygon-clipping'

function rectangle(left: number, top: number, right: number, bottom: number): Polygon {
  return [
    [
      [left, top],
      [right, top],
      [right, bottom],
      [left, bottom],
      [left, top],
    ],
  ]
}

/** Constructive, axis-aligned square routes. Failure on this grid is not proof of impassability. */
export function inspectSourceClearanceRoutes(input: {
  freeFloor: MultiPolygon
  rooms: Array<{ id: string; polygon: PlanPoint[] }>
  start: PlanPoint
  widthCm: number
  stepCm?: number
  maxNodes?: number
}) {
  const step = input.stepCm ?? 10
  const maxNodes = input.maxNodes ?? 40_000
  if (
    ![input.widthCm, step, maxNodes, input.start.xCm, input.start.yCm].every(Number.isFinite) ||
    input.widthCm <= 0 ||
    step < 1 ||
    maxNodes < 1
  ) {
    throw new Error('Некорректные параметры поиска маршрута')
  }
  const half = input.widthCm / 2
  const fits = (shape: Polygon, floor: MultiPolygon) =>
    polygonClipping.difference(shape, floor).length === 0
  const square = (point: PlanPoint) =>
    rectangle(point.xCm - half, point.yCm - half, point.xCm + half, point.yCm + half)
  const base = { widthCm: input.widthCm, stepCm: step, footprint: 'axis-aligned-square' as const }
  if (!fits(square(input.start), input.freeFloor)) {
    return {
      ...base,
      status: 'unresolved' as const,
      reason: 'entry-footprint' as const,
      checkedNodes: 0,
      unresolvedRoomIds: input.rooms.map((room) => room.id),
      routes: [],
    }
  }
  const rooms = input.rooms.map((room) => ({
    id: room.id,
    floor: [room.polygon.map(({ xCm, yCm }) => [xCm, yCm])] as Polygon,
  }))
  const queue = [{ point: input.start, parent: -1 }]
  const visited = new Set(['0,0'])
  const found = new Map<string, number>()
  let cursor = 0
  let limited = false
  while (cursor < queue.length && found.size < rooms.length) {
    const node = queue[cursor]
    if (!node) break
    for (const room of rooms) {
      if (!found.has(room.id) && fits(square(node.point), [room.floor])) found.set(room.id, cursor)
    }
    for (const [dx, dy] of [
      [step, 0],
      [-step, 0],
      [0, step],
      [0, -step],
    ]) {
      if (dx === undefined || dy === undefined) continue
      const point = { xCm: node.point.xCm + dx, yCm: node.point.yCm + dy }
      const key = `${Math.round((point.xCm - input.start.xCm) / step)},${Math.round((point.yCm - input.start.yCm) / step)}`
      if (visited.has(key)) continue
      // Swept rectangle proves the entire translation, not just both endpoint squares.
      const sweep = rectangle(
        Math.min(point.xCm, node.point.xCm) - half,
        Math.min(point.yCm, node.point.yCm) - half,
        Math.max(point.xCm, node.point.xCm) + half,
        Math.max(point.yCm, node.point.yCm) + half,
      )
      if (!fits(sweep, input.freeFloor)) continue
      if (queue.length >= maxNodes) {
        limited = true
        continue
      }
      visited.add(key)
      queue.push({ point, parent: cursor })
    }
    cursor += 1
  }
  const routes = [...found].map(([roomId, index]) => {
    const points: PlanPoint[] = []
    for (let current = index; current >= 0; ) {
      const node = queue[current]
      if (!node) break
      points.push(node.point)
      current = node.parent
    }
    return { roomId, points: points.reverse() }
  })
  return {
    ...base,
    status:
      found.size === rooms.length ? ('constructive-routes' as const) : ('unresolved' as const),
    reason:
      found.size === rooms.length
        ? undefined
        : limited
          ? ('search-limit' as const)
          : ('no-constructed-route' as const),
    checkedNodes: cursor,
    unresolvedRoomIds: rooms.filter((room) => !found.has(room.id)).map((room) => room.id),
    routes,
  }
}
