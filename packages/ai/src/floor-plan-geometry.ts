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

/**
 * Геометрия, восстановленная с картинки плана.
 *
 * Даже валидная схема остаётся draft: код умеет доказать, что дверь лежит на стене, но не
 * умеет доказать, что зрячая модель выбрала на исходном чертеже именно ту стену.
 */
export type PlanGeometry = {
  version: 1
  status: 'draft'
  widthCm: number
  heightCm: number
  walls: PlanWall[]
  openings: PlanOpening[]
  rooms: PlanRoomShape[]
  warnings: string[]
}

const MIN_CANVAS_CM = 100
const MAX_CANVAS_CM = 10_000
const MIN_WALL_CM = 20
const MAX_WALL_CM = 5_000
const MAX_POINTS = 30

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

function cleanId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const id = value.trim().slice(0, 40)
  return /^[a-zA-Z0-9_-]+$/.test(id) ? id : undefined
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
  for (const rawWall of Array.isArray(source.walls) ? source.walls : []) {
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
  for (const rawOpening of Array.isArray(source.openings) ? source.openings : []) {
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
      (type !== 'door' && type !== 'window' && type !== 'balcony')
    ) {
      warnings.push('Один проём отброшен: он не помещается на указанной стене.')
      continue
    }
    openingIds.add(id)
    openings.push({ id, type, wallId, offsetCm, widthCm: openingWidthCm })
  }

  const rooms: PlanRoomShape[] = []
  for (const rawRoom of Array.isArray(source.rooms) ? source.rooms : []) {
    if (!rawRoom || typeof rawRoom !== 'object') continue
    const room = rawRoom as Record<string, unknown>
    const name = typeof room.name === 'string' ? room.name.trim().slice(0, 40) : ''
    const polygon = (Array.isArray(room.polygon) ? room.polygon : [])
      .slice(0, MAX_POINTS)
      .map((entry) => point(entry, widthCm, heightCm))
      .filter((entry): entry is PlanPoint => entry !== undefined)
    if (!name || polygon.length < 3) {
      warnings.push('Контур одной комнаты отброшен: он не образует многоугольник.')
      continue
    }
    rooms.push({ name, polygon })
  }

  return {
    version: 1,
    status: 'draft',
    widthCm,
    heightCm,
    walls,
    openings,
    rooms,
    warnings: [...new Set(warnings)].slice(0, 8),
  }
}
