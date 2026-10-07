import type { PlanRoomIdentity, RoomSpaceKind } from '@uyut/db'

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
  spaceKind?: RoomSpaceKind
} & PlanRoomIdentity

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
  /** Candidate floor boundary; confirmation belongs to the source review, not the model. */
  footprint?: PlanPoint[]
  warnings: string[]
}

export type PlanRoomArea = {
  name: string
  spaceKind?: RoomSpaceKind
  sourceNumber?: number
  areaM2?: number
  widthCm?: number
  depthCm?: number
}

/** Номер из экспликации, одинаковый контракт у строки комнаты и её контура. */
export function planRoomSourceNumber(raw: unknown): number | undefined {
  if (typeof raw !== 'number' && typeof raw !== 'string') return undefined
  const value = Number(raw)
  return Number.isInteger(value) && value >= 1 && value <= 50 ? value : undefined
}

export function planShapeSourceNumbers(shape: PlanRoomIdentity): readonly number[] {
  return shape.sourceNumbers ?? (shape.sourceNumber === undefined ? [] : [shape.sourceNumber])
}

function sharedSourceNumbers(raw: unknown): number[] | undefined {
  if (
    !Array.isArray(raw) ||
    raw.length < 2 ||
    raw.length > 12 ||
    raw.some(
      (number) => typeof number !== 'number' || planRoomSourceNumber(number) === undefined,
    ) ||
    new Set(raw).size !== raw.length
  )
    return undefined
  return [...raw]
}

const MIN_CANVAS_CM = 100
const MAX_CANVAS_CM = 10_000
// Geometric edges include narrow, measured jambs and recesses, not only long walls.
const MIN_WALL_CM = 1
const MAX_WALL_CM = 5_000
const MAX_POINTS = 30
const MAX_WALLS = 200
const MAX_OPENINGS = 200
const MAX_ROOMS = 50
const MAX_OBSTACLES = 100
const ROOM_SIDE_TOLERANCE = 0.05
const MANUAL_GEOMETRY_ID = /^manual_[a-f0-9]{24}$/

function finite(value: unknown): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined
  if (typeof value === 'string' && value.trim() === '') return undefined
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

function parsePlanGeometryInternal(
  raw: unknown,
  minimumWalls: number,
  allowFullSpanOpenings = false,
): PlanGeometry | undefined {
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
  if (walls.length < minimumWalls) return undefined

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
      (!allowFullSpanOpenings && wallLength - openingWidthCm < 30) ||
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

  const roomCandidates: PlanRoomShape[] = []
  for (const rawRoom of (Array.isArray(source.rooms) ? source.rooms : []).slice(0, MAX_ROOMS)) {
    if (!rawRoom || typeof rawRoom !== 'object') continue
    const room = rawRoom as Record<string, unknown>
    const nameLimit = Object.hasOwn(room, 'sourceNumbers') ? 80 : 40
    const name = typeof room.name === 'string' ? room.name.trim().slice(0, nameLimit) : ''
    const rawPolygon = Array.isArray(room.polygon) ? room.polygon : []
    const vertices = rawPolygon.slice(0, MAX_POINTS).map((entry) => point(entry, widthCm, heightCm))
    const polygon = vertices.filter((entry): entry is PlanPoint => entry !== undefined)
    if (
      !name ||
      rawPolygon.length > MAX_POINTS ||
      polygon.length !== vertices.length ||
      polygon.length < 3 ||
      planPolygonAreaM2(polygon) < 0.5 ||
      polygonCrossesItself(polygon)
    ) {
      warnings.push('Контур одной комнаты отброшен: он не образует многоугольник.')
      continue
    }
    let identity: PlanRoomIdentity
    if (Object.hasOwn(room, 'sourceNumbers')) {
      const sourceNumbers = sharedSourceNumbers(room.sourceNumbers)
      if (!sourceNumbers || Object.hasOwn(room, 'sourceNumber')) {
        warnings.push('Контур одной общей зоны отброшен: номера помещений заданы неоднозначно.')
        continue
      }
      identity = { sourceNumbers }
    } else {
      const sourceNumber = planRoomSourceNumber(room.sourceNumber)
      identity = sourceNumber === undefined ? {} : { sourceNumber }
    }
    const spaceKind =
      room.spaceKind === 'balcony' || room.spaceKind === 'loggia' ? room.spaceKind : undefined
    roomCandidates.push({ name, ...identity, polygon, ...(spaceKind ? { spaceKind } : {}) })
  }
  const ownership = new Map<number, number>()
  for (const room of roomCandidates) {
    for (const number of planShapeSourceNumbers(room))
      ownership.set(number, (ownership.get(number) ?? 0) + 1)
  }
  const rooms = roomCandidates.filter((room) => {
    const duplicate = planShapeSourceNumbers(room).some(
      (number) => (ownership.get(number) ?? 0) > 1,
    )
    if (duplicate)
      warnings.push(
        `Контур «${room.name}» отброшен: привязка неоднозначна — номер помещения принадлежит нескольким контурам.`,
      )
    return !duplicate
  })

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

  const rawFootprint = Array.isArray(source.footprint) ? source.footprint : []
  const footprintPoints = rawFootprint.slice(0, 200).map((entry) => point(entry, widthCm, heightCm))
  const footprint = footprintPoints.filter((entry): entry is PlanPoint => entry !== undefined)
  const validFootprint =
    rawFootprint.length >= 3 &&
    rawFootprint.length <= 200 &&
    footprint.length === rawFootprint.length &&
    planPolygonAreaM2(footprint) > 0.0001 &&
    !polygonCrossesItself(footprint)
  if (source.footprint != null && !validFootprint)
    warnings.push('Граница пола не замкнута или повреждена: уточните её по исходному плану.')

  return {
    version: 1,
    status: 'draft',
    widthCm,
    heightCm,
    walls,
    openings,
    obstacles,
    rooms,
    ...(validFootprint ? { footprint } : {}),
    warnings: [...new Set(warnings)].slice(0, 8),
  }
}

/** Превращает непроверенный ответ vision-модели в безопасную для расчётов 2D-схему. */
export function parsePlanGeometry(
  raw: unknown,
  options: { allowFullSpanOpenings?: boolean } = {},
): PlanGeometry | undefined {
  return parsePlanGeometryInternal(raw, 3, options.allowFullSpanOpenings === true)
}

/**
 * Повторная проверка схемы, отредактированной в браузере. В сеть она ходит уже в сантиметрах,
 * а основной парсер принимает миллиметры, поэтому явно переводим каждое поле и прогоняем через
 * те же ограничения, что ответ vision-модели.
 */
export function validatePlanGeometryEdit(
  raw: unknown,
  mode: 'draft' | 'confirm' = 'confirm',
): PlanGeometry | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const source = raw as Record<string, unknown>
  const millimetres = (value: unknown) => {
    const number = finite(value)
    return number === undefined ? undefined : number * 10
  }
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
        spaceKind: room.spaceKind,
        ...(Object.hasOwn(room, 'sourceNumbers')
          ? {
              sourceNumbers: room.sourceNumbers,
              ...(Object.hasOwn(room, 'sourceNumber') ? { sourceNumber: room.sourceNumber } : {}),
            }
          : { sourceNumber: room.sourceNumber }),
        polygon: (Array.isArray(room.polygon) ? room.polygon : [])
          .slice(0, MAX_POINTS + 1)
          .map(convertPoint),
      }
    })
  return parsePlanGeometryInternal(
    {
      widthMm: millimetres(source.widthCm),
      heightMm: millimetres(source.heightCm),
      walls,
      openings,
      rooms,
      footprint: Array.isArray(source.footprint)
        ? source.footprint.slice(0, 201).map(convertPoint)
        : undefined,
    },
    mode === 'draft' ? 0 : 3,
    true,
  )
}

/** Связывает контуры с экспликацией, сверяет площади и габариты без исправления исходных чисел. */
export function reconcilePlanGeometryRooms(
  geometry: PlanGeometry | undefined,
  rooms: readonly PlanRoomArea[],
): PlanGeometry | undefined {
  if (!geometry || rooms.length === 0) return geometry
  const normalize = (name: string) => name.trim().toLocaleLowerCase('ru').replaceAll('ё', 'е')
  const baseName = (name: string) => normalize(name).replace(/ \d+$/, '')
  const kept: PlanRoomShape[] = []
  const warnings: string[] = []
  const candidatesFor = (room: PlanRoomShape): readonly PlanRoomArea[] => {
    const numbers = planShapeSourceNumbers(room)
    if (numbers.length)
      return rooms.filter((candidate) => numbers.includes(candidate.sourceNumber ?? 0))
    const exact = rooms.filter((candidate) => normalize(candidate.name) === normalize(room.name))
    return exact.length > 0
      ? exact
      : rooms.filter((candidate) => baseName(candidate.name) === baseName(room.name))
  }
  const resolvedNumbers = (room: PlanRoomShape): readonly number[] => {
    const numbers = planShapeSourceNumbers(room)
    if (numbers.length) return numbers
    const candidates = candidatesFor(room)
    const number = candidates.length === 1 ? candidates[0]?.sourceNumber : undefined
    return number === undefined ? [] : [number]
  }
  const ownership = new Map<number, number>()
  for (const room of geometry.rooms) {
    for (const number of resolvedNumbers(room))
      ownership.set(number, (ownership.get(number) ?? 0) + 1)
  }
  for (const room of geometry.rooms) {
    if (room.sourceNumbers !== undefined) {
      const numbers = sharedSourceNumbers(room.sourceNumbers)
      const members = numbers?.map((number) => {
        const candidates = rooms.filter((candidate) => candidate.sourceNumber === number)
        return candidates.length === 1 ? candidates[0] : undefined
      })
      if (
        !numbers ||
        Object.hasOwn(room, 'sourceNumber') ||
        members?.some((member) => !member) ||
        numbers.some((number) => (ownership.get(number) ?? 0) > 1)
      ) {
        warnings.push(
          `Контур «${room.name}» отброшен: общая зона неоднозначно связана с экспликацией.`,
        )
        continue
      }
      // Compare only a complete sum of printed areas; never distribute it or infer sides.
      const areas = (members ?? []).map((member) => member?.areaM2)
      const expectedArea = areas.every((area) => area !== undefined && area > 0)
        ? areas.reduce<number>((sum, area) => sum + (area ?? 0), 0)
        : undefined
      if (
        expectedArea !== undefined &&
        Math.abs(planPolygonAreaM2(room.polygon) - expectedArea) / expectedArea > 0.33
      ) {
        warnings.push(
          `Контур «${room.name}» отброшен: площадь не совпала с суммой подписей общей зоны.`,
        )
        continue
      }
      kept.push({ ...room, sourceNumbers: numbers })
      continue
    }
    const candidates = candidatesFor(room)
    const expected = candidates.length === 1 ? candidates[0] : undefined
    const duplicateNumber = resolvedNumbers(room).some((number) => (ownership.get(number) ?? 0) > 1)
    if (!expected || duplicateNumber) {
      warnings.push(
        `Контур «${room.name}» отброшен: привязка к помещению неоднозначна или отсутствует.`,
      )
      continue
    }
    const actual = planPolygonAreaM2(room.polygon)
    if (
      expected.areaM2 !== undefined &&
      Math.abs(actual - expected.areaM2) / expected.areaM2 > 0.33
    ) {
      warnings.push(
        `Контур «${expected.name}» отброшен: геометрическая площадь не совпала с подписью.`,
      )
      continue
    }
    const xs = room.polygon.map((point) => point.xCm)
    const ys = room.polygon.map((point) => point.yCm)
    const widthCm = Math.max(...xs) - Math.min(...xs)
    const depthCm = Math.max(...ys) - Math.min(...ys)
    // Даже равная площадь не обнаружит перестановку осей или чужую размерную цепочку.
    // Порог отсеивает грубый конфликт; прохождение не доказывает точность обмера.
    const sideConflicts = (read: number | undefined, measured: number) =>
      read !== undefined && read > 0 && Math.abs(read - measured) / read > ROOM_SIDE_TOLERANCE
    if (sideConflicts(expected.widthCm, widthCm) || sideConflicts(expected.depthCm, depthCm)) {
      warnings.push(
        `Контур «${expected.name}» отброшен: габариты по осям не совпали с подписями комнаты.`,
      )
      continue
    }
    kept.push({
      ...room,
      name: expected.name,
      ...(expected.spaceKind ? { spaceKind: expected.spaceKind } : {}),
      ...(expected.sourceNumber === undefined ? {} : { sourceNumber: expected.sourceNumber }),
    })
  }
  return {
    ...geometry,
    rooms: kept,
    warnings: [...new Set([...warnings, ...geometry.warnings])].slice(0, 8),
  }
}
