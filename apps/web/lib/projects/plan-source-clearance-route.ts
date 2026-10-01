import type { PlanGeometry, PlanPoint } from '@uyut/db'
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

function intersectsOpenRectangle(
  barrier: { start: PlanPoint; end: PlanPoint },
  left: number,
  top: number,
  right: number,
  bottom: number,
): boolean {
  let lower = 0
  let upper = 1
  for (const [start, end, minimum, maximum] of [
    [barrier.start.xCm, barrier.end.xCm, left, right],
    [barrier.start.yCm, barrier.end.yCm, top, bottom],
  ] as const) {
    if (start === end) {
      if (start <= minimum || start >= maximum) return false
      continue
    }
    // Clip the segment parameter to each axis's open interval. Equality means
    // boundary-only contact, so neither thickness nor a physical epsilon is needed.
    // Halving only when subtraction overflows keeps finite source endpoints valid.
    const scale = Number.isFinite(end - start) ? 1 : 2
    const delta = end / scale - start / scale
    const first = (minimum / scale - start / scale) / delta
    const second = (maximum / scale - start / scale) / delta
    lower = Math.max(lower, Math.min(first, second))
    upper = Math.min(upper, Math.max(first, second))
    if (lower >= upper) return false
  }
  return true
}

/** Constructive, axis-aligned square routes. Failure on this grid is not proof of impassability. */
export function inspectSourceClearanceRoutes(input: {
  freeFloor: MultiPolygon
  rooms: Array<{ id: string; polygon: PlanPoint[] }>
  start: PlanPoint
  widthCm: number
  stepCm?: number
  maxNodes?: number
  metricObstacles?: Pick<PlanGeometry, 'obstacles' | 'voids'>
  /** Zero-thickness physical wall spans in source centimetres. */
  boundaryBarriers?: Array<{ start: PlanPoint; end: PlanPoint }>
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
  const boundaryBarriers = input.boundaryBarriers ?? []
  for (const { start, end } of boundaryBarriers) {
    if (
      ![start.xCm, start.yCm, end.xCm, end.yCm].every(Number.isFinite) ||
      (start.xCm === end.xCm && start.yCm === end.yCm)
    ) {
      throw new Error('Некорректный отрезок физической границы')
    }
  }
  const half = input.widthCm / 2
  const obstacleBodies: Polygon[] = (input.metricObstacles?.voids ?? []).map((region) => [
    region.polygon.map(({ xCm, yCm }) => [xCm, yCm]),
  ])
  for (const obstacle of input.metricObstacles?.obstacles ?? []) {
    if (
      ![obstacle.xCm, obstacle.yCm, obstacle.widthCm, obstacle.depthCm].every(Number.isFinite) ||
      obstacle.widthCm <= 0 ||
      obstacle.depthCm <= 0
    ) {
      throw new Error('Некорректные размеры неподвижного препятствия')
    }
    obstacleBodies.push(
      rectangle(
        obstacle.xCm,
        obstacle.yCm,
        obstacle.xCm + obstacle.widthCm,
        obstacle.yCm + obstacle.depthCm,
      ),
    )
  }
  for (const region of input.metricObstacles?.voids ?? []) {
    if (
      region.polygon.length < 3 ||
      region.polygon.some((point) => !Number.isFinite(point.xCm) || !Number.isFinite(point.yCm))
    )
      throw new Error('Некорректный контур технической пустоты')
  }
  const freeFloor = obstacleBodies.length
    ? polygonClipping.difference(input.freeFloor, ...obstacleBodies)
    : input.freeFloor
  const fits = (shape: Polygon, floor: MultiPolygon) =>
    polygonClipping.difference(shape, floor).length === 0
  const square = (point: PlanPoint) =>
    rectangle(point.xCm - half, point.yCm - half, point.xCm + half, point.yCm + half)
  const clearRectangle = (left: number, top: number, right: number, bottom: number) =>
    !boundaryBarriers.some((barrier) =>
      intersectsOpenRectangle(barrier, left, top, right, bottom),
    ) && fits(rectangle(left, top, right, bottom), freeFloor)
  const base = { widthCm: input.widthCm, stepCm: step, footprint: 'axis-aligned-square' as const }
  if (
    !clearRectangle(
      input.start.xCm - half,
      input.start.yCm - half,
      input.start.xCm + half,
      input.start.yCm + half,
    )
  ) {
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
      if (
        !clearRectangle(
          Math.min(point.xCm, node.point.xCm) - half,
          Math.min(point.yCm, node.point.yCm) - half,
          Math.max(point.xCm, node.point.xCm) + half,
          Math.max(point.yCm, node.point.yCm) + half,
        )
      )
        continue
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
