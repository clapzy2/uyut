import type { PlanPageContours } from '@uyut/db'
import polygonClipping, { type MultiPolygon, type Polygon } from 'polygon-clipping'
import type { PdfLinework } from './plan-pdf-linework'
import { pdfContourKey } from './plan-pdf-room-binding'

type Room = PlanPageContours['rooms'][number]
type Point = { x: number; y: number }

export type PageClearanceRoute = {
  contourKey: string
  widthCm: number
  status: 'constructive-route' | 'entry-clearance' | 'unresolved' | 'not-applicable'
  reason?:
    | 'door-off-boundary'
    | 'door-too-narrow'
    | 'entry-footprint'
    | 'search-limit'
    | 'no-constructed-route'
  doorIds: string[]
  reachedDoorIds: string[]
  checkedNodes: number
}

function toCm(
  point: Point,
  work: Pick<PdfLinework, 'pageWidth' | 'pageHeight'>,
  cmPerPoint: number,
): Point {
  return {
    x: (point.x * work.pageWidth * cmPerPoint) / 1000,
    y: (point.y * work.pageHeight * cmPerPoint) / 1000,
  }
}

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

function roomSign(points: readonly Point[]): number {
  return Math.sign(
    points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length]
      return next ? sum + point.x * next.y - next.x * point.y : sum
    }, 0),
  )
}

function onEdge(point: Point, start: Point, end: Point): boolean {
  if (![point.x, point.y, start.x, start.y, end.x, end.y].every(Number.isFinite)) return false
  const dx = end.x - start.x
  const dy = end.y - start.y
  const squaredLength = dx * dx + dy * dy
  if (squaredLength === 0) return false
  const ratio = ((point.x - start.x) * dx + (point.y - start.y) * dy) / squaredLength
  // Arithmetic precision only; the source endpoints are not moved onto the edge.
  return (
    ratio >= 0 &&
    ratio <= 1 &&
    Math.hypot(point.x - start.x - ratio * dx, point.y - start.y - ratio * dy) <= 1e-7
  )
}

function positions(low: number, high: number, step: number, anchors: number[]): number[] {
  const result = anchors.filter((value) => value >= low && value <= high)
  for (let value = low; value <= high; value += step) result.push(value)
  return [...new Set(result)].sort((a, b) => a - b)
}

/** A found square-footprint route is valid; search failure is not proof of impassability. */
export function inspectPlanPageClearanceRoutes(
  contours: PlanPageContours,
  paintedBody: MultiPolygon,
  work: Pick<PdfLinework, 'pageWidth' | 'pageHeight'>,
  cmPerPoint: number,
  widthCm: number,
  gridStepCm = 10,
): PageClearanceRoute[] {
  if (
    !Number.isFinite(cmPerPoint) ||
    cmPerPoint <= 0 ||
    !Number.isFinite(work.pageWidth) ||
    !Number.isFinite(work.pageHeight) ||
    work.pageWidth <= 0 ||
    work.pageHeight <= 0 ||
    !Number.isFinite(widthCm) ||
    widthCm <= 0 ||
    !Number.isFinite(gridStepCm) ||
    gridStepCm < 1
  )
    return []
  const scaledBody: MultiPolygon = paintedBody.map((polygon) =>
    polygon.map((ring) =>
      ring.map(([x = 0, y = 0]) => {
        const point = toCm({ x, y }, work, cmPerPoint)
        return [point.x, point.y]
      }),
    ),
  )
  return contours.rooms.map((room) =>
    inspectRoom(room, scaledBody, work, cmPerPoint, widthCm, gridStepCm),
  )
}

function inspectRoom(
  room: Room,
  scaledBody: MultiPolygon,
  work: Pick<PdfLinework, 'pageWidth' | 'pageHeight'>,
  cmPerPoint: number,
  widthCm: number,
  gridStepCm: number,
): PageClearanceRoute {
  const contourKey = pdfContourKey(room)
  const doors = (room.openings ?? []).filter((opening) => opening.kind === 'door')
  const doorIds = doors.map((door) => door.id)
  const base = { contourKey, widthCm, doorIds }
  if (doors.length === 0)
    return { ...base, status: 'not-applicable', reachedDoorIds: [], checkedNodes: 0 }
  const floorPoints = room.polygon.map((point) => toCm(point, work, cmPerPoint))
  const floor: Polygon = [floorPoints.map(({ x, y }) => [x, y])]
  const freeFloor = scaledBody.length > 0 ? polygonClipping.difference(floor, scaledBody) : [floor]
  const half = widthCm / 2
  const sign = roomSign(floorPoints)
  const anchors: Array<Point & { id: string }> = []
  for (const door of doors) {
    const edgeStart = floorPoints[door.wallEdgeIndex]
    const edgeEnd = floorPoints[(door.wallEdgeIndex + 1) % floorPoints.length]
    const start = toCm(door.start, work, cmPerPoint)
    const end = toCm(door.end, work, cmPerPoint)
    const edgeLength =
      edgeStart && edgeEnd ? Math.hypot(edgeEnd.x - edgeStart.x, edgeEnd.y - edgeStart.y) : 0
    if (
      !edgeStart ||
      !edgeEnd ||
      edgeLength === 0 ||
      sign === 0 ||
      !onEdge(start, edgeStart, edgeEnd) ||
      !onEdge(end, edgeStart, edgeEnd)
    )
      return {
        ...base,
        status: 'unresolved',
        reason: 'door-off-boundary',
        reachedDoorIds: [],
        checkedNodes: 0,
      }
    const normal = {
      x: (-sign * (edgeEnd.y - edgeStart.y)) / edgeLength,
      y: (sign * (edgeEnd.x - edgeStart.x)) / edgeLength,
    }
    // The square remains aligned with the page axes, including at diagonal door faces.
    const projection = Math.abs(normal.x) + Math.abs(normal.y)
    if (Math.hypot(end.x - start.x, end.y - start.y) < widthCm * projection)
      return {
        ...base,
        status: 'unresolved',
        reason: 'door-too-narrow',
        reachedDoorIds: [],
        checkedNodes: 0,
      }
    anchors.push({
      id: door.id,
      x: (start.x + end.x) / 2 + normal.x * half * projection,
      y: (start.y + end.y) / 2 + normal.y * half * projection,
    })
  }
  const xs = floorPoints.map((point) => point.x)
  const ys = floorPoints.map((point) => point.y)
  const contains = (polygon: Polygon) => polygonClipping.difference(polygon, freeFloor).length === 0
  const fits = (x: number, y: number) => contains(rectangle(x - half, y - half, x + half, y + half))
  if (anchors.some((anchor) => !fits(anchor.x, anchor.y)))
    return {
      ...base,
      status: 'unresolved',
      reason: 'entry-footprint',
      reachedDoorIds: [],
      checkedNodes: 0,
    }
  if (doors.length === 1)
    return {
      ...base,
      status: 'entry-clearance',
      reachedDoorIds: doorIds,
      checkedNodes: 1,
    }
  const xValues = positions(
    Math.min(...xs) + half,
    Math.max(...xs) - half,
    gridStepCm,
    anchors.map((a) => a.x),
  )
  const yValues = positions(
    Math.min(...ys) + half,
    Math.max(...ys) - half,
    gridStepCm,
    anchors.map((a) => a.y),
  )
  if (xValues.length * yValues.length > 15_000)
    return {
      ...base,
      status: 'unresolved',
      reason: 'search-limit',
      reachedDoorIds: [],
      checkedNodes: 0,
    }
  const key = (x: number, y: number) => `${x}:${y}`
  if (anchors.some((anchor) => xValues.indexOf(anchor.x) < 0 || yValues.indexOf(anchor.y) < 0))
    return {
      ...base,
      status: 'unresolved',
      reason: 'entry-footprint',
      reachedDoorIds: [],
      checkedNodes: 0,
    }
  const start = anchors[0]
  if (!start)
    return {
      ...base,
      status: 'unresolved',
      reason: 'entry-footprint',
      reachedDoorIds: [],
      checkedNodes: 0,
    }
  const pending = [{ x: xValues.indexOf(start.x), y: yValues.indexOf(start.y) }]
  const visited = new Set([key(pending[0]?.x ?? -1, pending[0]?.y ?? -1)])
  const nodeFits = new Map<string, boolean>()
  for (let index = 0; index < pending.length; index++) {
    const current = pending[index]
    if (!current) continue
    const x = xValues[current.x]
    const y = yValues[current.y]
    if (x === undefined || y === undefined) continue
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nextX = current.x + dx
      const nextY = current.y + dy
      const x2 = xValues[nextX]
      const y2 = yValues[nextY]
      if (x2 === undefined || y2 === undefined) continue
      const nextKey = key(nextX, nextY)
      if (visited.has(nextKey)) continue
      let valid = nodeFits.get(nextKey)
      if (valid === undefined) {
        valid = fits(x2, y2)
        nodeFits.set(nextKey, valid)
      }
      if (
        !valid ||
        !contains(
          rectangle(
            Math.min(x, x2) - half,
            Math.min(y, y2) - half,
            Math.max(x, x2) + half,
            Math.max(y, y2) + half,
          ),
        )
      )
        continue
      visited.add(nextKey)
      pending.push({ x: nextX, y: nextY })
    }
  }
  const reachedDoorIds = anchors
    .filter((anchor) => visited.has(key(xValues.indexOf(anchor.x), yValues.indexOf(anchor.y))))
    .map((anchor) => anchor.id)
  return {
    ...base,
    status: reachedDoorIds.length === doorIds.length ? 'constructive-route' : 'unresolved',
    ...(reachedDoorIds.length === doorIds.length
      ? {}
      : { reason: 'no-constructed-route' as const }),
    reachedDoorIds,
    checkedNodes: visited.size,
  }
}
