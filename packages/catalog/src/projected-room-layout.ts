import type { PlanGeometry, PlanPoint, RoomMeasurements } from '@uyut/db'
import { isWetRoomName } from '@uyut/db/room-purpose'
import { isPlanRoomSourceNumber } from '@uyut/db/source-room-number'
import { z } from 'zod'
import { type LayoutItem, type LayoutRoomKind, layoutRoom, type RoomLayout } from './layout'
import { cross, integerPoints, onIntegerSegment, sign, vector } from './plan-exact-geometry'
import { roomLayoutInputFromSelectedGeometry } from './room-geometry-layout'

const MAX_KEY_LENGTH = 300_000
type Binding = NonNullable<RoomMeasurements['projectedContour']>
export type ProjectedContourOption = {
  roomIndex: number
  name: string
  sourceNumbers: number[]
  polygon: PlanPoint[]
}

/** Full JSON snapshot, with stable object keys and unchanged array order/numeric values. */
export function projectedGeometryKey(geometry: PlanGeometry | undefined): string | null {
  if (!geometry) return null
  const active = new Set<object>()
  let nodes = 0
  let characters = 0
  const encode = (value: unknown, depth: number): string => {
    if (++nodes > 30_000 || depth > 32) throw new Error('Geometry snapshot budget')
    if (value === null || typeof value === 'boolean' || typeof value === 'number') {
      if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Nonfinite value')
      const result = JSON.stringify(value)
      characters += result.length
      return result
    }
    if (typeof value === 'string') {
      if (value.length > MAX_KEY_LENGTH) throw new Error('Oversized string')
      const result = JSON.stringify(value)
      characters += result.length
      return result
    }
    if (!value || typeof value !== 'object' || active.has(value)) throw new Error('Invalid JSON')
    if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
      throw new Error('Non-JSON object')
    active.add(value)
    const result = Array.isArray(value)
      ? `[${value.map((entry) => encode(entry, depth + 1)).join(',')}]`
      : `{${Object.keys(value)
          .sort()
          .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
          .map(
            (key) =>
              `${encode(key, depth + 1)}:${encode((value as Record<string, unknown>)[key], depth + 1)}`,
          )
          .join(',')}}`
    active.delete(value)
    if (characters > MAX_KEY_LENGTH || result.length > MAX_KEY_LENGTH)
      throw new Error('Oversized geometry snapshot')
    return result
  }
  try {
    return encode(geometry, 0)
  } catch {
    return null
  }
}

const coordinate = z.number().finite().min(0).max(5000)
const length = z.number().finite().positive().max(5000)
const point = z.object({ xCm: coordinate, yCm: coordinate })
const polygon = z.array(point).min(3).max(200)
const id = z.string().min(1).max(200)
const rect = { xCm: coordinate, yCm: coordinate, widthCm: length, depthCm: length }
const geometrySchema = z.object({
  version: z.literal(1),
  status: z.literal('draft'),
  source: z.literal('manual'),
  widthCm: length,
  heightCm: length,
  warnings: z.array(z.string().max(4000)).max(2000),
  rooms: z
    .array(
      z.object({
        name: id,
        polygon,
        sourceNumber: z.number().refine(isPlanRoomSourceNumber).optional(),
        sourceNumbers: z.array(z.number().refine(isPlanRoomSourceNumber)).min(2).max(12).optional(),
        spaceKind: z.enum(['interior', 'balcony', 'loggia']).optional(),
      }),
    )
    .min(1)
    .max(200),
  walls: z
    .array(z.object({ id, start: point, end: point, kind: z.enum(['outer', 'inner']) }))
    .max(2000),
  openings: z
    .array(
      z.object({
        id,
        wallId: id,
        type: z.enum(['door', 'window', 'balcony']),
        offsetCm: coordinate,
        widthCm: length,
        sillHeightCm: coordinate.optional(),
        clearance: z
          .object({
            side: z.enum(['left', 'right']),
            depthCm: length,
            shape: z.enum(['rectangle', 'swing']).optional(),
            hinge: z.enum(['start', 'end']).optional(),
          })
          .optional(),
      }),
    )
    .max(2000),
  pdfCalibration: z.object({
    sourceState: z.literal('proposed'),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/i),
    pdfPage: z.number().int().min(1).max(1000),
    cmPerPoint: length,
    origin: z.object({ x: z.number().finite(), y: z.number().finite() }),
    derivedOpeningIds: z.array(id).max(2000),
  }),
  voids: z.array(z.object({ id, polygon })).max(200).optional(),
  obstacles: z
    .array(
      z.object({
        id,
        kind: z.enum(['column', 'shaft', 'fixed']),
        ...rect,
        label: z.string().optional(),
      }),
    )
    .max(200)
    .optional(),
  utilityPoints: z
    .array(
      z.object({
        id,
        kind: z.enum(['water', 'drain', 'vent', 'socket', 'gas', 'radiator']),
        xCm: coordinate,
        yCm: coordinate,
        reachCm: coordinate.optional(),
      }),
    )
    .max(200)
    .optional(),
  kitchenItems: z
    .array(
      z.object({
        id,
        ...rect,
        front: z.enum(['top', 'right', 'bottom', 'left']).optional(),
        openingDepthCm: coordinate.optional(),
        passageCm: coordinate.optional(),
        installationGaps: z
          .object({ top: coordinate, right: coordinate, bottom: coordinate, left: coordinate })
          .optional(),
      }),
    )
    .max(200)
    .optional(),
})

function simplePolygon(polygon: PlanPoint[]): boolean {
  const points = integerPoints(polygon)
  if (new Set(polygon.map((p) => `${p.xCm}:${p.yCm}`)).size !== polygon.length) return false
  let area = 0n
  for (let index = 0; index < points.length; index++) {
    const a = points[index]
    const b = points[(index + 1) % points.length]
    if (!a || !b) return false
    area += cross(a, b)
    for (let other = index + 1; other < points.length; other++) {
      if (other === index + 1 || (index === 0 && other === points.length - 1)) continue
      const c = points[other]
      const d = points[(other + 1) % points.length]
      if (!c || !d) return false
      const crosses =
        sign(cross(vector(a, b), vector(a, c))) * sign(cross(vector(a, b), vector(a, d))) < 0 &&
        sign(cross(vector(c, d), vector(c, a))) * sign(cross(vector(c, d), vector(c, b))) < 0
      if (
        crosses ||
        onIntegerSegment(c, a, b) ||
        onIntegerSegment(d, a, b) ||
        onIntegerSegment(a, c, d) ||
        onIntegerSegment(b, c, d)
      )
        return false
    }
  }
  return area !== 0n
}

function eligibleGeometry(geometry: PlanGeometry | undefined): geometry is PlanGeometry {
  if (
    !geometry ||
    geometry.verticalReference !== undefined ||
    geometry.requiresSourceReviewReimport ||
    !projectedGeometryKey(geometry)
  )
    return false
  if (!geometrySchema.safeParse(geometry).success) return false
  if (geometry.rooms.reduce((total, room) => total + room.polygon.length, 0) > 2000) return false
  const polygons = [
    ...geometry.rooms.map((room) => room.polygon),
    ...(geometry.voids ?? []).map((hole) => hole.polygon),
  ]
  if (polygons.reduce((total, ring) => total + ring.length, 0) > 4096) return false
  if (
    polygons.some(
      (ring) =>
        !simplePolygon(ring) ||
        ring.some((p) => p.xCm > geometry.widthCm || p.yCm > geometry.heightCm),
    )
  )
    return false
  if (new Set(geometry.walls.map((wall) => wall.id)).size !== geometry.walls.length) return false
  if (
    geometry.walls.some(
      (wall) => wall.start.xCm === wall.end.xCm && wall.start.yCm === wall.end.yCm,
    )
  )
    return false
  const walls = new Map(geometry.walls.map((wall) => [wall.id, wall]))
  if (new Set(geometry.openings.map((opening) => opening.id)).size !== geometry.openings.length)
    return false
  return geometry.openings.every((opening) => {
    const wall = walls.get(opening.wallId)
    return (
      wall &&
      opening.offsetCm + opening.widthCm <=
        Math.hypot(wall.end.xCm - wall.start.xCm, wall.end.yCm - wall.start.yCm) + 0.1
    )
  })
}

export function projectedContourOptions(
  geometry: PlanGeometry | undefined,
): ProjectedContourOption[] {
  if (!eligibleGeometry(geometry)) return []
  const used = new Set<number>()
  const options: ProjectedContourOption[] = []
  for (const [roomIndex, room] of geometry.rooms.entries()) {
    const numbers =
      room.sourceNumbers ?? (room.sourceNumber === undefined ? [] : [room.sourceNumber])
    if (
      (room.sourceNumbers !== undefined &&
        (numbers.length < 2 || room.sourceNumber !== undefined)) ||
      numbers.length > 12 ||
      numbers.some((number) => !isPlanRoomSourceNumber(number) || used.has(number)) ||
      new Set(numbers).size !== numbers.length
    )
      return []
    for (const number of numbers) used.add(number)
    if (
      !numbers.length ||
      isWetRoomName(room.name) ||
      room.spaceKind === 'balcony' ||
      room.spaceKind === 'loggia' ||
      room.requiresImageTrace ||
      room.imageTrace
    )
      continue
    options.push({
      roomIndex,
      name: room.name,
      sourceNumbers: [...numbers],
      polygon: structuredClone(room.polygon),
    })
  }
  return options
}

export function createProjectedContourBinding(
  geometry: PlanGeometry | undefined,
  roomIndex: number,
): Binding | null {
  const option = projectedContourOptions(geometry).find((entry) => entry.roomIndex === roomIndex)
  const key = projectedGeometryKey(geometry)
  const source = geometry?.pdfCalibration
  if (!option || !key || !source) return null
  return {
    version: 1,
    geometryKey: key,
    sourceSha256: source.sourceSha256,
    pdfPage: source.pdfPage,
    roomIndex,
    sourceNumbers: option.sourceNumbers,
  }
}

export function projectedLayoutWithMeasurements(
  name: string,
  measurements: RoomMeasurements | null | undefined,
  geometry: PlanGeometry | undefined,
  items: readonly LayoutItem[],
  kind?: LayoutRoomKind,
): RoomLayout | null {
  const binding = measurements?.projectedContour
  if (binding?.version !== 1 || !Array.isArray(binding.sourceNumbers)) return null
  const current = createProjectedContourBinding(geometry, binding.roomIndex)
  if (
    !current ||
    current.geometryKey !== binding.geometryKey ||
    current.sourceSha256 !== binding.sourceSha256 ||
    current.pdfPage !== binding.pdfPage ||
    JSON.stringify(current.sourceNumbers) !== JSON.stringify(binding.sourceNumbers)
  )
    return null
  const room = geometry?.rooms[binding.roomIndex]
  if (!geometry || !room) return null
  let input: ReturnType<typeof roomLayoutInputFromSelectedGeometry>
  try {
    input = roomLayoutInputFromSelectedGeometry(geometry, room, measurements)
  } catch {
    return null
  }
  if (!input) return null
  const notice = `Проектный контур, лист ${binding.pdfPage}, номера ${binding.sourceNumbers.join(' + ')}. Это предварительная обстановка по чертежу, не натурный обмер.`
  const sourceWarnings = geometry.warnings.filter((warning) => warning.startsWith(`${room.name}:`))
  const sharedAreaNotice =
    binding.sourceNumbers.length > 1
      ? 'Внутри общей области функциональные зоны отдельно не размечены. Автоматическое место мебели — предложение; сверьте его назначение и при необходимости закрепите вручную.'
      : ''
  input.missingSafetyData.push(
    notice,
    ...sourceWarnings,
    ...(sharedAreaNotice ? [sharedAreaNotice] : []),
    'Сверьте проёмы, открывание, препятствия и вертикальные размеры на месте; проектные позиции не подтверждают монтаж и проходы.',
  )
  const layout = layoutRoom({ ...input, roomName: name, roomKind: kind }, items)
  layout.projectedContour = { geometryKey: binding.geometryKey, roomIndex: binding.roomIndex }
  layout.measurementNote =
    `${notice} Контур перенесён без растягивания по прежним меркам. Общая отметка пола, стены и потолки не достраиваются. ${sourceWarnings.join(' ')} ${sharedAreaNotice}`.trim()
  layout.safetyChecks.push({
    id: 'projected-source',
    label: 'Предварительная проектная обстановка',
    detail: notice,
    status: 'preliminary',
  })
  for (const check of layout.safetyChecks) {
    if (check.status === 'checked') check.status = 'preliminary'
  }
  if (layout.safetySummary.status === 'checked' || layout.safetySummary.status === 'preliminary')
    layout.safetySummary = {
      status: 'preliminary',
      title: 'Проектная схема — требуется сверка на месте',
      detail: notice,
    }
  return layout
}
