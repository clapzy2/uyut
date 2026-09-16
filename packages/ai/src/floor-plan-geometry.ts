/** Точка обмерного плана. Координаты идут от левого верхнего угла, в сантиметрах. */
export type PlanPoint = { xCm: number; yCm: number }

export type PlanWall = {
  id: string
  start: PlanPoint
  end: PlanPoint
  kind: 'outer' | 'inner'
  thicknessCm?: number
}

export type PlanOpening = {
  id: string
  type: 'door' | 'window' | 'balcony'
  wallId: string
  /** Расстояние от start стены до начала проёма. */
  offsetCm: number
  widthCm: number
}

export type PlanRoomShape = {
  name: string
  polygon: PlanPoint[]
}

export type PlanObstacle = {
  id: string
  kind: 'column' | 'shaft' | 'fixed'
  xCm: number
  yCm: number
  widthCm: number
  depthCm: number
  label?: string
}

/**
 * Геометрия, восстановленная с картинки плана.
 *
 * Даже валидная схема остаётся draft: код умеет доказать, что дверь лежит на стене, но не
 * умеет доказать, что зрячая модель выбрала на исходном чертеже именно ту стену.
 */
export type PlanGeometry = {
  version: 1
  status: 'draft' | 'confirmed'
  confirmedAt?: string
  widthCm: number
  heightCm: number
  walls: PlanWall[]
  openings: PlanOpening[]
  obstacles: PlanObstacle[]
  rooms: PlanRoomShape[]
  warnings: string[]
}

export type PlanRoomArea = { name: string; areaM2?: number }

const MIN_CANVAS_CM = 100
const MAX_CANVAS_CM = 10_000
const MIN_WALL_CM = 20
const MAX_WALL_CM = 5_000
const MAX_POINTS = 30
const MAX_WALLS = 200
const MAX_OPENINGS = 200
const MAX_ROOMS = 50
const MAX_OBSTACLES = 100
const MANUAL_GEOMETRY_ID = /^manual_[a-f0-9]{24}$/

function finite(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function cm(millimetres: unknown): number | undefined {
  const value = finite(millimetres)
  return value === undefined ? undefined : Math.round(value) / 10
}

function point(raw: unknown, widthCm: number, heightCm: number): PlanPoint | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const source = raw as Record<string, unknown>
  const xCm = cm(source.xMm)
  const yCm = cm(source.yMm)
  if (
    xCm === undefined ||
    yCm === undefined ||
    xCm < 0 ||
    yCm < 0 ||
    xCm > widthCm ||
    yCm > heightCm
  ) {
    return undefined
  }
  return { xCm, yCm }
}

function distance(a: PlanPoint, b: PlanPoint): number {
  return Math.hypot(b.xCm - a.xCm, b.yCm - a.yCm)
}

function signedTurn(a: PlanPoint, b: PlanPoint, c: PlanPoint): number {
  return (b.xCm - a.xCm) * (c.yCm - a.yCm) - (b.yCm - a.yCm) * (c.xCm - a.xCm)
}

function onSegment(a: PlanPoint, b: PlanPoint, point: PlanPoint): boolean {
  return (
    Math.abs(signedTurn(a, b, point)) < 0.001 &&
    point.xCm >= Math.min(a.xCm, b.xCm) &&
    point.xCm <= Math.max(a.xCm, b.xCm) &&
    point.yCm >= Math.min(a.yCm, b.yCm) &&
    point.yCm <= Math.max(a.yCm, b.yCm)
  )
}

function segmentsIntersect(a: PlanPoint, b: PlanPoint, c: PlanPoint, d: PlanPoint): boolean {
  const abC = signedTurn(a, b, c)
  const abD = signedTurn(a, b, d)
  const cdA = signedTurn(c, d, a)
  const cdB = signedTurn(c, d, b)
  const abSeparated = (abC > 0 && abD < 0) || (abC < 0 && abD > 0)
  const cdSeparated = (cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0)
  if (abSeparated && cdSeparated) return true
  return onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b)
}

function polygonCrossesItself(points: readonly PlanPoint[]): boolean {
  for (let first = 0; first < points.length; first += 1) {
    const firstEnd = (first + 1) % points.length
    const a = points[first]
    const b = points[firstEnd]
    if (!a || !b) continue
    for (let second = first + 1; second < points.length; second += 1) {
      const secondEnd = (second + 1) % points.length
      if (firstEnd === second || secondEnd === first) continue
      const c = points[second]
      const d = points[secondEnd]
      if (c && d && segmentsIntersect(a, b, c, d)) return true
    }
  }
  return false
}

function pointInPolygon(point: PlanPoint, polygon: readonly PlanPoint[]): boolean {
  let inside = false
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index]
    const end = polygon[(index + 1) % polygon.length]
    if (!start || !end) continue
    if (
      start.yCm > point.yCm !== end.yCm > point.yCm &&
      point.xCm <
        ((end.xCm - start.xCm) * (point.yCm - start.yCm)) / (end.yCm - start.yCm) + start.xCm
    )
      inside = !inside
  }
  return inside
}

/** Площадь контура по формуле Гаусса. */
export function planPolygonAreaM2(points: readonly PlanPoint[]): number {
  if (points.length < 3) return 0
  let twiceArea = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    if (!current || !next) continue
    twiceArea += current.xCm * next.yCm - next.xCm * current.yCm
  }
  return Math.abs(twiceArea) / 2 / 10_000
}

function cleanId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const id = value.trim().slice(0, 40)
  return /^[a-zA-Z0-9_-]+$/.test(id) ? id : undefined
}

/** Идентификатор элемента, который пользователь добавил в редакторе, а не vision-модель. */
export function isManualPlanGeometryId(value: unknown): value is string {
  return typeof value === 'string' && MANUAL_GEOMETRY_ID.test(value)
}

/** Превращает непроверенный ответ vision-модели в безопасную для расчётов 2D-схему. */
export function parsePlanGeometry(raw: unknown): PlanGeometry | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const source = raw as Record<string, unknown>
  const widthCm = cm(source.widthMm)
  const heightCm = cm(source.heightMm)
  if (
    widthCm === undefined ||
    heightCm === undefined ||
    widthCm < MIN_CANVAS_CM ||
    heightCm < MIN_CANVAS_CM ||
    widthCm > MAX_CANVAS_CM ||
    heightCm > MAX_CANVAS_CM
  ) {
    return undefined
  }

  const warnings: string[] = []
  const walls: PlanWall[] = []
  const wallIds = new Set<string>()
  for (const rawWall of (Array.isArray(source.walls) ? source.walls : []).slice(0, MAX_WALLS)) {
    if (!rawWall || typeof rawWall !== 'object') continue
    const wall = rawWall as Record<string, unknown>
    const id = cleanId(wall.id)
    const start = point(wall.start, widthCm, heightCm)
    const end = point(wall.end, widthCm, heightCm)
    const length = start && end ? distance(start, end) : 0
    if (!id || wallIds.has(id) || !start || !end || length < MIN_WALL_CM || length > MAX_WALL_CM) {
      warnings.push('Одна стена отброшена: её координаты или идентификатор не прошли проверку.')
      continue
    }
    const thicknessCm = cm(wall.thicknessMm)
    wallIds.add(id)
    walls.push({
      id,
      start,
      end,
      kind: wall.kind === 'outer' ? 'outer' : 'inner',
      ...(thicknessCm !== undefined && thicknessCm >= 5 && thicknessCm <= 100
        ? { thicknessCm }
        : {}),
    })
  }
  // Пара линий может быть мебелью или размерной цепочкой. Схемой считаем только замкнутое
  // по смыслу множество хотя бы из трёх стен.
  if (walls.length < 3) return undefined

  const wallById = new Map(walls.map((wall) => [wall.id, wall]))
  const openings: PlanOpening[] = []
  const openingIds = new Set<string>()
  for (const rawOpening of (Array.isArray(source.openings) ? source.openings : []).slice(
    0,
    MAX_OPENINGS,
  )) {
    if (!rawOpening || typeof rawOpening !== 'object') continue
    const opening = rawOpening as Record<string, unknown>
    const id = cleanId(opening.id)
    const wallId = cleanId(opening.wallId)
    const wall = wallId ? wallById.get(wallId) : undefined
    const offsetCm = cm(opening.offsetMm)
    const openingWidthCm = cm(opening.widthMm)
    const type = opening.type
    const wallLength = wall ? distance(wall.start, wall.end) : 0
    if (
      !id ||
      openingIds.has(id) ||
      !wallId ||
      !wall ||
      offsetCm === undefined ||
      openingWidthCm === undefined ||
      offsetCm < 0 ||
      openingWidthCm < 30 ||
      openingWidthCm > 1_000 ||
      offsetCm + openingWidthCm > wallLength + 1 ||
      // Host-wall проходит сквозь проём. Если проём занял весь короткий отрезок, модель
      // приняла нарисованное окно за отдельную стену, и доверять такой привязке нельзя.
      wallLength - openingWidthCm < 30 ||
      (type !== 'door' && type !== 'window' && type !== 'balcony')
    ) {
      warnings.push('Один проём отброшен: он не помещается на указанной стене.')
      continue
    }
    const overlapsExisting = openings.some(
      (existing) =>
        existing.wallId === wallId &&
        Math.max(existing.offsetCm, offsetCm) <
          Math.min(existing.offsetCm + existing.widthCm, offsetCm + openingWidthCm),
    )
    if (overlapsExisting) {
      warnings.push('Один проём отброшен: он пересекается с другим проёмом на этой стене.')
      continue
    }
    openingIds.add(id)
    openings.push({ id, type, wallId, offsetCm, widthCm: openingWidthCm })
  }

  const rooms: PlanRoomShape[] = []
  for (const rawRoom of (Array.isArray(source.rooms) ? source.rooms : []).slice(0, MAX_ROOMS)) {
    if (!rawRoom || typeof rawRoom !== 'object') continue
    const room = rawRoom as Record<string, unknown>
    const name = typeof room.name === 'string' ? room.name.trim().slice(0, 40) : ''
    const polygon = (Array.isArray(room.polygon) ? room.polygon : [])
      .slice(0, MAX_POINTS)
      .map((entry) => point(entry, widthCm, heightCm))
      .filter((entry): entry is PlanPoint => entry !== undefined)
    if (
      !name ||
      polygon.length < 3 ||
      planPolygonAreaM2(polygon) < 0.5 ||
      polygonCrossesItself(polygon)
    ) {
      warnings.push('Контур одной комнаты отброшен: он не образует многоугольник.')
      continue
    }
    rooms.push({ name, polygon })
  }

  const obstacles: PlanObstacle[] = []
  const obstacleIds = new Set<string>()
  for (const rawObstacle of (Array.isArray(source.obstacles) ? source.obstacles : []).slice(
    0,
    MAX_OBSTACLES,
  )) {
    if (!rawObstacle || typeof rawObstacle !== 'object') continue
    const obstacle = rawObstacle as Record<string, unknown>
    const id = cleanId(obstacle.id)
    const kind = obstacle.kind
    const xCm = cm(obstacle.xMm)
    const yCm = cm(obstacle.yMm)
    const obstacleWidthCm = cm(obstacle.widthMm)
    const obstacleDepthCm = cm(obstacle.depthMm)
    const label = typeof obstacle.label === 'string' ? obstacle.label.trim().slice(0, 80) : ''
    const centre =
      xCm !== undefined &&
      yCm !== undefined &&
      obstacleWidthCm !== undefined &&
      obstacleDepthCm !== undefined
        ? { xCm: xCm + obstacleWidthCm / 2, yCm: yCm + obstacleDepthCm / 2 }
        : undefined
    if (
      !id ||
      obstacleIds.has(id) ||
      (kind !== 'column' && kind !== 'shaft' && kind !== 'fixed') ||
      xCm === undefined ||
      yCm === undefined ||
      obstacleWidthCm === undefined ||
      obstacleDepthCm === undefined ||
      obstacleWidthCm < 5 ||
      obstacleDepthCm < 5 ||
      obstacleWidthCm > 300 ||
      obstacleDepthCm > 300 ||
      xCm + obstacleWidthCm > widthCm ||
      yCm + obstacleDepthCm > heightCm ||
      obstacleWidthCm * obstacleDepthCm > widthCm * heightCm * 0.1 ||
      !centre ||
      !rooms.some((room) => pointInPolygon(centre, room.polygon))
    ) {
      warnings.push('Одно препятствие отброшено: его вид, размеры или положение не подтверждены.')
      continue
    }
    obstacleIds.add(id)
    obstacles.push({
      id,
      kind,
      xCm,
      yCm,
      widthCm: obstacleWidthCm,
      depthCm: obstacleDepthCm,
      ...(label ? { label } : {}),
    })
  }

  return {
    version: 1,
    status: 'draft',
    widthCm,
    heightCm,
    walls,
    openings,
    obstacles,
    rooms,
    warnings: [...new Set(warnings)].slice(0, 8),
  }
}

/**
 * Повторная проверка схемы, отредактированной в браузере. В сеть она ходит уже в сантиметрах,
 * а основной парсер принимает миллиметры, поэтому явно переводим каждое поле и прогоняем через
 * те же ограничения, что ответ vision-модели.
 */
export function validatePlanGeometryEdit(raw: unknown): PlanGeometry | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const source = raw as Record<string, unknown>
  const millimetres = (value: unknown) => Number(value) * 10
  const convertPoint = (value: unknown) => {
    const point = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
    return { xMm: millimetres(point.xCm), yMm: millimetres(point.yCm) }
  }
  const walls = (Array.isArray(source.walls) ? source.walls : [])
    .slice(0, MAX_WALLS)
    .map((value) => {
      const wall = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
      return {
        id: wall.id,
        kind: wall.kind,
        start: convertPoint(wall.start),
        end: convertPoint(wall.end),
        thicknessMm: wall.thicknessCm === undefined ? undefined : millimetres(wall.thicknessCm),
      }
    })
  const openings = (Array.isArray(source.openings) ? source.openings : [])
    .slice(0, MAX_OPENINGS)
    .map((value) => {
      const opening = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
      return {
        id: opening.id,
        type: opening.type,
        wallId: opening.wallId,
        offsetMm: millimetres(opening.offsetCm),
        widthMm: millimetres(opening.widthCm),
      }
    })
  const rooms = (Array.isArray(source.rooms) ? source.rooms : [])
    .slice(0, MAX_ROOMS)
    .map((value) => {
      const room = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
      return {
        name: room.name,
        polygon: (Array.isArray(room.polygon) ? room.polygon : [])
          .slice(0, MAX_POINTS)
          .map(convertPoint),
      }
    })
  return parsePlanGeometry({
    widthMm: millimetres(source.widthCm),
    heightMm: millimetres(source.heightCm),
    walls,
    openings,
    rooms,
  })
}

/** Сверяет масштаб контуров с независимо прочитанными подписями площадей. */
export function reconcilePlanGeometryRooms(
  geometry: PlanGeometry | undefined,
  rooms: readonly PlanRoomArea[],
): PlanGeometry | undefined {
  if (!geometry) return undefined
  const areas = new Map(
    rooms
      .filter((room): room is { name: string; areaM2: number } => room.areaM2 !== undefined)
      .map((room) => [room.name.trim().toLocaleLowerCase('ru'), room.areaM2]),
  )
  const kept: PlanRoomShape[] = []
  let rejected = 0
  for (const room of geometry.rooms) {
    const expected = areas.get(room.name.trim().toLocaleLowerCase('ru'))
    const actual = planPolygonAreaM2(room.polygon)
    if (expected !== undefined && Math.abs(actual - expected) / expected > 0.33) {
      rejected += 1
      continue
    }
    kept.push(room)
  }
  if (rejected === 0) return geometry
  return {
    ...geometry,
    rooms: kept,
    warnings: [
      ...geometry.warnings,
      `${rejected} ${rejected === 1 ? 'контур комнаты отброшен' : 'контура комнат отброшены'}: геометрическая площадь не совпала с подписью.`,
    ].slice(0, 8),
  }
}
