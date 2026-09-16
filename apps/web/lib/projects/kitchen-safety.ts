import type { PlanGeometry, PlanKitchenItem, PlanPoint, PlanUtilityPoint } from '@uyut/db'
import { z } from 'zod'
import { doorClearanceZone } from './clearance-zones'

export const kitchenSafetySchema = z.object({
  routeWidthCm: z.number().finite().min(40).max(200).optional(),
  routeStartOpeningId: z.string().min(1).max(80).optional(),
  utilityPoints: z
    .array(
      z.object({
        id: z.string().min(1).max(80),
        kind: z.enum(['water', 'drain', 'vent', 'socket', 'gas', 'radiator']),
        xCm: z.number().finite().min(0).max(10_000),
        yCm: z.number().finite().min(0).max(10_000),
        reachCm: z.number().finite().positive().max(2_000).optional(),
        heightCm: z.number().finite().min(0).max(1_000).optional(),
      }),
    )
    .max(100)
    .refine((points) => new Set(points.map((point) => point.id)).size === points.length),
})

export const utilityLabels: Record<PlanUtilityPoint['kind'], string> = {
  water: 'Вода',
  drain: 'Канализация',
  vent: 'Вентиляция',
  socket: 'Розетка',
  gas: 'Газ',
  radiator: 'Радиатор',
}

function pointInPolygon(point: PlanPoint, polygon: readonly PlanPoint[]) {
  let inside = false
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index]
    const b = polygon[(index + 1) % polygon.length]
    if (!a || !b) continue
    if (
      a.yCm > point.yCm !== b.yCm > point.yCm &&
      point.xCm < ((b.xCm - a.xCm) * (point.yCm - a.yCm)) / (b.yCm - a.yCm) + a.xCm
    )
      inside = !inside
  }
  return inside
}

function distanceToItem(point: PlanPoint, item: PlanKitchenItem) {
  const dx = Math.max(item.xCm - point.xCm, 0, point.xCm - item.xCm - item.widthCm)
  const dy = Math.max(item.yCm - point.yCm, 0, point.yCm - item.yCm - item.depthCm)
  return Math.hypot(dx, dy)
}

function wallBlocksPoint(point: PlanPoint, geometry: PlanGeometry, radiusCm: number) {
  return geometry.walls.some((wall) => {
    const dx = wall.end.xCm - wall.start.xCm
    const dy = wall.end.yCm - wall.start.yCm
    const lengthSquared = dx * dx + dy * dy
    if (lengthSquared === 0) return false
    const position = Math.max(
      0,
      Math.min(
        1,
        ((point.xCm - wall.start.xCm) * dx + (point.yCm - wall.start.yCm) * dy) / lengthSquared,
      ),
    )
    const nearest = {
      xCm: wall.start.xCm + dx * position,
      yCm: wall.start.yCm + dy * position,
    }
    if (Math.hypot(point.xCm - nearest.xCm, point.yCm - nearest.yCm) >= radiusCm) return false
    const alongCm = Math.sqrt(lengthSquared) * position
    return !geometry.openings.some(
      (opening) =>
        opening.wallId === wall.id &&
        opening.type !== 'window' &&
        alongCm >= opening.offsetCm + radiusCm - 0.1 &&
        alongCm <= opening.offsetCm + opening.widthCm - radiusCm + 0.1,
    )
  })
}

export function inspectUtilities(
  items: PlanKitchenItem[],
  points: PlanUtilityPoint[],
  geometry?: PlanGeometry,
) {
  const issues: string[] = []
  const missing: string[] = []
  const required: Partial<Record<PlanKitchenItem['kind'], PlanUtilityPoint['kind'][]>> = {
    sink: ['water', 'drain'],
    dishwasher: ['water', 'drain', 'socket'],
    fridge: ['socket'],
    hob: ['vent'],
  }
  if (geometry)
    points.forEach((point, index) => {
      if (!geometry.rooms.some((room) => pointInPolygon(point, room.polygon)))
        issues.push(`Инженерная точка ${index + 1} находится вне контуров комнат.`)
    })
  for (const [index, item] of items.entries()) {
    for (const kind of required[item.kind] ?? []) {
      const candidates = points.filter((point) => point.kind === kind)
      if (candidates.length === 0)
        missing.push(`Модуль ${index + 1}: добавьте точку «${utilityLabels[kind]}».`)
      else if (candidates.every((point) => point.reachCm === undefined))
        missing.push(
          `Модуль ${index + 1}: у точки «${utilityLabels[kind]}» задайте допустимую длину подключения.`,
        )
      else if (
        !candidates.some(
          (point) => point.reachCm !== undefined && distanceToItem(point, item) <= point.reachCm,
        )
      )
        issues.push(
          `Модуль ${index + 1} дальше заданной длины подключения «${utilityLabels[kind]}».`,
        )
    }
    if (item.kind === 'hob' || item.kind === 'oven') {
      const power = points.filter((point) => point.kind === 'socket' || point.kind === 'gas')
      const label = item.kind === 'oven' ? 'подключение духовки' : 'розетку или газ для плиты'
      if (power.length === 0) missing.push(`Модуль ${index + 1}: укажите ${label}.`)
      else if (power.every((point) => point.reachCm === undefined))
        missing.push(`Модуль ${index + 1}: для «${label}» задайте допустимую длину подключения.`)
      else if (
        !power.some(
          (point) => point.reachCm !== undefined && distanceToItem(point, item) <= point.reachCm,
        )
      )
        issues.push(`Модуль ${index + 1} дальше заданной длины для «${label}».`)
    }
  }
  for (const point of points.filter((candidate) => candidate.kind === 'radiator')) {
    if (point.reachCm === undefined) missing.push(`Радиатор ${point.id}: задайте свободный радиус.`)
    else {
      const reachCm = point.reachCm
      items.forEach((item, index) => {
        if (reachCm !== undefined && distanceToItem(point, item) < reachCm)
          issues.push(`Модуль ${index + 1} попадает в свободную зону радиатора.`)
      })
    }
  }
  return { issues: [...new Set(issues)], missing: [...new Set(missing)] }
}

function itemTarget(item: PlanKitchenItem, half: number): PlanPoint | undefined {
  if (!item.front) return undefined
  if (item.front === 'top') return { xCm: item.xCm + item.widthCm / 2, yCm: item.yCm - half }
  if (item.front === 'bottom')
    return { xCm: item.xCm + item.widthCm / 2, yCm: item.yCm + item.depthCm + half }
  if (item.front === 'left') return { xCm: item.xCm - half, yCm: item.yCm + item.depthCm / 2 }
  return { xCm: item.xCm + item.widthCm + half, yCm: item.yCm + item.depthCm / 2 }
}

export type RouteInspection = {
  issues: string[]
  missing: string[]
  paths: PlanPoint[][]
  resolutionCm?: number
}

/** Conservative raster check. Resolution is reported so the result never looks more exact than it is. */
export function inspectRoutes(items: PlanKitchenItem[], geometry: PlanGeometry): RouteInspection {
  const width = geometry.routeWidthCm
  if (width === undefined)
    return { issues: [], missing: ['Задайте минимальную ширину маршрута.'], paths: [] }
  const doors = geometry.openings
    .filter((opening) => opening.type !== 'window')
    .map((opening) => doorClearanceZone(opening, geometry))
    .filter((zone) => zone !== undefined)
  if (doors.length === 0)
    return {
      issues: [],
      missing: ['Задайте зону хотя бы одной двери — от неё проверяется маршрут.'],
      paths: [],
    }
  const missing: string[] = []
  const targets = items.flatMap((item, index) => {
    const point = itemTarget(item, width / 2)
    if (!point) {
      missing.push(`Модуль ${index + 1}: укажите сторону фасада для проверки маршрута.`)
      return []
    }
    return [{ point, label: `модуля ${index + 1}` }]
  })
  if (targets.length === 0) return { issues: [], missing, paths: [] }
  const step = Math.max(10, Math.ceil(Math.max(geometry.widthCm, geometry.heightCm) / 250))
  const cols = Math.ceil(geometry.widthCm / step)
  const rows = Math.ceil(geometry.heightCm / step)
  const half = width / 2
  const free = (col: number, row: number) => {
    const point = { xCm: (col + 0.5) * step, yCm: (row + 0.5) * step }
    const around = [
      point,
      { xCm: point.xCm + half, yCm: point.yCm },
      { xCm: point.xCm - half, yCm: point.yCm },
      { xCm: point.xCm, yCm: point.yCm + half },
      { xCm: point.xCm, yCm: point.yCm - half },
      { xCm: point.xCm + half / Math.SQRT2, yCm: point.yCm + half / Math.SQRT2 },
      { xCm: point.xCm + half / Math.SQRT2, yCm: point.yCm - half / Math.SQRT2 },
      { xCm: point.xCm - half / Math.SQRT2, yCm: point.yCm + half / Math.SQRT2 },
      { xCm: point.xCm - half / Math.SQRT2, yCm: point.yCm - half / Math.SQRT2 },
    ]
    return (
      around.every((sample) =>
        geometry.rooms.some((room) => pointInPolygon(sample, room.polygon)),
      ) &&
      items.every((item) => distanceToItem(point, item) >= half) &&
      !wallBlocksPoint(point, geometry, half)
    )
  }
  const nearest = (point: PlanPoint) => {
    const origin = {
      col: Math.max(0, Math.min(cols - 1, Math.floor(point.xCm / step))),
      row: Math.max(0, Math.min(rows - 1, Math.floor(point.yCm / step))),
    }
    if (free(origin.col, origin.row)) return origin
    for (let radius = 1; radius <= 8; radius += 1) {
      for (let dc = -radius; dc <= radius; dc += 1) {
        for (const dr of [-radius, radius]) {
          if (free(origin.col + dc, origin.row + dr))
            return { col: origin.col + dc, row: origin.row + dr }
        }
      }
      for (let dr = -radius + 1; dr < radius; dr += 1) {
        for (const dc of [-radius, radius]) {
          if (free(origin.col + dc, origin.row + dr))
            return { col: origin.col + dc, row: origin.row + dr }
        }
      }
    }
    return undefined
  }
  const firstDoor = geometry.routeStartOpeningId
    ? doors.find((door) => door.ownerId === geometry.routeStartOpeningId)
    : doors.length === 1
      ? doors[0]
      : undefined
  if (!firstDoor)
    return {
      issues: [],
      missing: [...missing, 'Выберите стартовую дверь маршрута.'],
      paths: [],
      resolutionCm: step,
    }
  const entryOpening = geometry.openings.find((opening) => opening.id === firstDoor.ownerId)
  if (!entryOpening || entryOpening.widthCm < width)
    return {
      issues: [`Стартовый проём уже маршрута ${width} см.`],
      missing,
      paths: [],
      resolutionCm: step,
    }
  const doorCentre = firstDoor.polygon.reduce(
    (sum, point) => ({
      xCm: sum.xCm + point.xCm / firstDoor.polygon.length,
      yCm: sum.yCm + point.yCm / firstDoor.polygon.length,
    }),
    { xCm: 0, yCm: 0 },
  )
  const start = nearest(doorCentre)
  if (!start)
    return {
      issues: ['У двери не найдено место для маршрута заданной ширины.'],
      missing,
      paths: [],
      resolutionCm: step,
    }
  const key = (col: number, row: number) => `${col}:${row}`
  const queue = [start]
  const previous = new Map<string, string | null>([[key(start.col, start.row), null]])
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]
    if (!current) continue
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const col = current.col + dc
      const row = current.row + dr
      const nextKey = key(col, row)
      if (
        col >= 0 &&
        row >= 0 &&
        col < cols &&
        row < rows &&
        !previous.has(nextKey) &&
        free(col, row)
      ) {
        previous.set(nextKey, key(current.col, current.row))
        queue.push({ col, row })
      }
    }
  }
  const issues: string[] = []
  const paths: PlanPoint[][] = []
  for (const target of targets) {
    const end = nearest(target.point)
    if (!end || !previous.has(key(end.col, end.row))) {
      issues.push(`Нет непрерывного маршрута шириной ${width} см от двери до ${target.label}.`)
      continue
    }
    const path: PlanPoint[] = []
    let current: string | null = key(end.col, end.row)
    while (current) {
      const [col = 0, row = 0] = current.split(':').map(Number)
      path.push({ xCm: (col + 0.5) * step, yCm: (row + 0.5) * step })
      current = previous.get(current) ?? null
    }
    paths.push(path.reverse())
  }
  return { issues, missing, paths, resolutionCm: step }
}
