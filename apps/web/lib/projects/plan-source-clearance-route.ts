import type { PlanGeometry, PlanPoint } from '@uyut/db'
import polygonClipping, { type MultiPolygon, type Polygon } from 'polygon-clipping'
import { enclosingTurnBounds, enclosingTurnSide } from './plan-transfer-enclosure'

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

export function intersectsOpenRectangle(
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

/** Constructive planar routes. Optional quarter turns use a conservative full-sweep square; no tilt or stairs. */
export function inspectSourceClearanceRoutes(input: {
  freeFloor: MultiPolygon
  rooms: Array<{ id: string; polygon: PlanPoint[] }>
  start: PlanPoint
  widthCm: number
  /** Optional rigid body in the plan axes. Absence preserves the legacy square exactly. */
  footprintCm?: { widthCm: number; depthCm: number }
  allowQuarterTurns?: boolean
  /** Additional certificate for raising/tilting at start and landing, not for translations. */
  endpointCheck?: (point: PlanPoint, roomId?: string) => boolean
  /** True rejects the whole translation/turn envelope, not merely its centre. */
  blockedVolume?: (bounds: [number, number, number, number]) => boolean
  /** Exact connector destination; absence preserves room-area goals. */
  goal?: { roomId: string; point?: PlanPoint }
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
  const footprint = input.footprintCm
  if (
    input.goal &&
    (!input.rooms.some((room) => room.id === input.goal?.roomId) ||
      (input.goal.point !== undefined &&
        ![input.goal.point.xCm, input.goal.point.yCm].every(Number.isFinite)))
  )
    throw new Error('Некорректная точная конечная точка маршрута')
  if (input.endpointCheck !== undefined && typeof input.endpointCheck !== 'function')
    throw new Error('Некорректная проверка зоны подъёма и установки')
  if (input.blockedVolume !== undefined && typeof input.blockedVolume !== 'function')
    throw new Error('Некорректная проверка занятого объёма')
  if (
    footprint !== undefined &&
    (!footprint ||
      typeof footprint !== 'object' ||
      Array.isArray(footprint) ||
      ![footprint.widthCm, footprint.depthCm].every(Number.isFinite) ||
      footprint.widthCm <= 0 ||
      footprint.depthCm <= 0)
  )
    throw new Error('Некорректный прямоугольный габарит для переноса')
  if (
    (input.allowQuarterTurns !== undefined && typeof input.allowQuarterTurns !== 'boolean') ||
    (input.allowQuarterTurns === true && !footprint)
  )
    throw new Error('Для поворотов нужен явный прямоугольный габарит и логический режим')
  const allowTurns = input.allowQuarterTurns === true
  const turnSweepCm =
    allowTurns && footprint ? enclosingTurnSide(footprint.widthCm, footprint.depthCm) : undefined
  const boundaryBarriers = input.boundaryBarriers ?? []
  for (const { start, end } of boundaryBarriers) {
    if (
      ![start.xCm, start.yCm, end.xCm, end.yCm].every(Number.isFinite) ||
      (start.xCm === end.xCm && start.yCm === end.yCm)
    ) {
      throw new Error('Некорректный отрезок физической границы')
    }
  }
  const halfWidth = (footprint?.widthCm ?? input.widthCm) / 2
  const halfDepth = (footprint?.depthCm ?? input.widthCm) / 2
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
  type Orientation = 0 | 90
  const halfSizes = (orientation: Orientation): [number, number] =>
    orientation === 0 ? [halfWidth, halfDepth] : [halfDepth, halfWidth]
  const bodyAt = (point: PlanPoint, orientation: Orientation) => {
    if (input.goal) return rectangle(...boundsAt(point, orientation))
    const [xHalf, yHalf] = halfSizes(orientation)
    return rectangle(point.xCm - xHalf, point.yCm - yHalf, point.xCm + xHalf, point.yCm + yHalf)
  }
  const boundsAt = (
    point: PlanPoint,
    orientation: Orientation,
  ): [number, number, number, number] => {
    const width =
      orientation === 0
        ? (footprint?.widthCm ?? input.widthCm)
        : (footprint?.depthCm ?? input.widthCm)
    const depth =
      orientation === 0
        ? (footprint?.depthCm ?? input.widthCm)
        : (footprint?.widthCm ?? input.widthCm)
    const horizontal = enclosingTurnBounds(point, width, 0, width)
    const vertical = enclosingTurnBounds(point, depth, 0, depth)
    if (!horizontal || !vertical)
      throw new Error('Не удалось оградить полный габарит соединительного пути')
    return [horizontal[0], vertical[1], horizontal[2], vertical[3]]
  }
  const sweepBounds = (
    from: PlanPoint,
    to: PlanPoint,
    orientation: Orientation,
  ): [number, number, number, number] => {
    const [xHalf, yHalf] = halfSizes(orientation)
    if (!input.goal)
      return [
        Math.min(from.xCm, to.xCm) - xHalf,
        Math.min(from.yCm, to.yCm) - yHalf,
        Math.max(from.xCm, to.xCm) + xHalf,
        Math.max(from.yCm, to.yCm) + yHalf,
      ]
    const first = boundsAt(from, orientation)
    const last = boundsAt(to, orientation)
    return [
      Math.min(first[0], last[0]),
      Math.min(first[1], last[1]),
      Math.max(first[2], last[2]),
      Math.max(first[3], last[3]),
    ]
  }
  const clearRectangle = (left: number, top: number, right: number, bottom: number) =>
    !input.blockedVolume?.([left, top, right, bottom]) &&
    !boundaryBarriers.some((barrier) =>
      intersectsOpenRectangle(barrier, left, top, right, bottom),
    ) &&
    fits(rectangle(left, top, right, bottom), freeFloor)
  const base = {
    widthCm: input.widthCm,
    stepCm: step,
    ...(allowTurns ? { turnPolicy: 'conservative-square' as const, turnSweepCm } : {}),
    ...(footprint
      ? {
          footprint: 'axis-aligned-rectangle' as const,
          footprintCm: { widthCm: footprint.widthCm, depthCm: footprint.depthCm },
        }
      : { footprint: 'axis-aligned-square' as const }),
  }
  if (
    (input.endpointCheck !== undefined && !input.endpointCheck(input.start)) ||
    !(input.goal
      ? clearRectangle(...boundsAt(input.start, 0))
      : clearRectangle(
          input.start.xCm - halfWidth,
          input.start.yCm - halfDepth,
          input.start.xCm + halfWidth,
          input.start.yCm + halfDepth,
        ))
  ) {
    return {
      ...base,
      status: 'unresolved' as const,
      reason: 'entry-footprint' as const,
      checkedNodes: 0,
      unresolvedRoomIds: input.rooms
        .filter((room) => !input.goal || room.id === input.goal.roomId)
        .map((room) => room.id),
      routes: [],
    }
  }
  const rooms = input.rooms
    .filter((room) => !input.goal || room.id === input.goal.roomId)
    .map((room) => ({
      id: room.id,
      floor: [room.polygon.map(({ xCm, yCm }) => [xCm, yCm])] as Polygon,
    }))
  const queue: Array<{ point: PlanPoint; parent: number; orientation: Orientation }> = [
    { point: input.start, parent: -1, orientation: 0 },
  ]
  const stateKey = (point: PlanPoint, orientation: Orientation) => {
    const position = `${Math.round((point.xCm - input.start.xCm) / step)},${Math.round((point.yCm - input.start.yCm) / step)}`
    return allowTurns ? `${position},${orientation}` : position
  }
  const visited = new Set([stateKey(input.start, 0)])
  const found = new Map<string, number>()
  const terminalPaths = new Map<string, PlanPoint[]>()
  let terminalNodes = 0
  let cursor = 0
  let limited = false
  while (cursor < queue.length && found.size < rooms.length) {
    const node = queue[cursor]
    if (!node) break
    for (const room of rooms) {
      if (input.goal?.point && !found.has(room.id)) {
        const target = input.goal.point
        if (
          fits(bodyAt(target, node.orientation), [room.floor]) &&
          (!input.endpointCheck || input.endpointCheck(target, room.id))
        ) {
          const candidates = [
            [{ xCm: target.xCm, yCm: node.point.yCm }, target],
            [{ xCm: node.point.xCm, yCm: target.yCm }, target],
          ]
          for (const candidate of candidates) {
            let previous = node.point
            const tail: PlanPoint[] = []
            let valid = true
            for (const point of candidate) {
              if (point.xCm === previous.xCm && point.yCm === previous.yCm) continue
              if (!clearRectangle(...sweepBounds(previous, point, node.orientation))) {
                valid = false
                break
              }
              tail.push(point)
              previous = point
            }
            if (!valid) continue
            if (queue.length + terminalNodes + tail.length > maxNodes) {
              limited = true
              continue
            }
            terminalNodes += tail.length
            terminalPaths.set(room.id, tail)
            found.set(room.id, cursor)
            break
          }
        }
        continue
      }
      if (
        !input.goal?.point &&
        !found.has(room.id) &&
        fits(bodyAt(node.point, node.orientation), [room.floor]) &&
        (!input.endpointCheck || input.endpointCheck(node.point, room.id))
      )
        found.set(room.id, cursor)
    }
    for (const [dx, dy] of [
      [step, 0],
      [-step, 0],
      [0, step],
      [0, -step],
    ]) {
      if (dx === undefined || dy === undefined) continue
      const point = { xCm: node.point.xCm + dx, yCm: node.point.yCm + dy }
      const key = stateKey(point, node.orientation)
      if (visited.has(key)) continue
      // Swept rectangle proves the entire translation, not just both endpoint squares.
      if (!clearRectangle(...sweepBounds(node.point, point, node.orientation))) continue
      if (queue.length + terminalNodes >= maxNodes) {
        limited = true
        continue
      }
      visited.add(key)
      queue.push({ point, parent: cursor, orientation: node.orientation })
    }
    if (allowTurns && footprint && turnSweepCm !== undefined) {
      const orientation: Orientation = node.orientation === 0 ? 90 : 0
      const key = stateKey(node.point, orientation)
      const bounds = enclosingTurnBounds(
        node.point,
        footprint.widthCm,
        footprint.depthCm,
        turnSweepCm,
      )
      if (!visited.has(key) && bounds !== undefined && clearRectangle(...bounds)) {
        if (queue.length + terminalNodes >= maxNodes) limited = true
        else {
          visited.add(key)
          queue.push({ point: node.point, parent: cursor, orientation })
        }
      }
    }
    cursor += 1
  }
  const routes = [...found].map(([roomId, index]) => {
    const points: Array<PlanPoint & { orientation?: Orientation }> = []
    for (let current = index; current >= 0; ) {
      const node = queue[current]
      if (!node) break
      points.push(allowTurns ? { ...node.point, orientation: node.orientation } : node.point)
      current = node.parent
    }
    const ordered = points.reverse()
    const orientation = queue[index]?.orientation
    const completed: Array<PlanPoint & { orientation?: Orientation }> = [
      ...ordered,
      ...(terminalPaths.get(roomId) ?? []).map((point) =>
        allowTurns ? { ...point, orientation } : point,
      ),
    ]
    return { roomId, points: completed }
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
    checkedNodes: cursor + terminalNodes,
    unresolvedRoomIds: rooms.filter((room) => !found.has(room.id)).map((room) => room.id),
    routes,
  }
}
