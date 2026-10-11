import type { PlanGeometry, PlanPoint, PlanVerticalReference } from '@uyut/db'
import polygonClipping, { type Polygon, type Ring } from 'polygon-clipping'
import { inspectPlanVerticalReference } from './plan-vertical-reference'
import type { VolumeFloorSurface } from './plan-volume-types'

type SignedFloors =
  | { ok: true; reference: PlanVerticalReference; surfaces: VolumeFloorSurface[] }
  | { ok: false; error: string }

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, entry) =>
    entry && typeof entry === 'object' && !Array.isArray(entry)
      ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)))
      : entry,
  )
}

/** Exact provenance key, not a rounded coordinate hash or a client certification. */
export function verticalReferenceReviewKey(reference: PlanVerticalReference): string {
  return canonical({
    id: reference.id,
    kind: reference.kind,
    zeroFloorId: reference.zeroFloorId,
    verifiedAt: reference.verifiedAt,
    verifiedBy: reference.verifiedBy,
    source: reference.source,
    contextSnapshot: reference.contextSnapshot,
    ceilings: reference.ceilings,
  })
}

function openRing(points: readonly PlanPoint[]): PlanPoint[] {
  const result = points.map((point) => ({ ...point }))
  const first = result[0]
  const last = result.at(-1)
  if (first && last && first.xCm === last.xCm && first.yCm === last.yCm) result.pop()
  return result
}

type IntegerPoint = { x: bigint; y: bigint }

function decimalIntegers(numbers: number[]) {
  const values = numbers.map((value) => {
    const [mantissa = '', exponent = '0'] = value.toString().split('e')
    const [whole = '', fraction = ''] = mantissa.split('.')
    const places = fraction.length - Number(exponent)
    return {
      integer: BigInt(whole + fraction) * (places < 0 ? 10n ** BigInt(-places) : 1n),
      places: Math.max(0, places),
    }
  })
  const precision = Math.max(...values.map(({ places }) => places))
  const coordinates = values.map(
    ({ integer, places }) => integer * 10n ** BigInt(precision - places),
  )
  return { coordinates, precision }
}

/** Arithmetic on entered decimal centimetres, without adding a measurement tolerance. */
export function signedElevationSum(base: number, height: number): number {
  if (![base, height].every(Number.isFinite)) throw new Error('Invalid elevation arithmetic')
  const { coordinates, precision } = decimalIntegers([base, height])
  const result = Number(`${(coordinates[0] as bigint) + (coordinates[1] as bigint)}e-${precision}`)
  if (!Number.isFinite(result)) throw new Error('Elevation exceeds the supported numeric range')
  return result
}

function integerRing(points: PlanPoint[]): IntegerPoint[] {
  const { coordinates } = decimalIntegers(points.flatMap((point) => [point.xCm, point.yCm]))
  return points.map((_point, index) => ({
    x: coordinates[index * 2] as bigint,
    y: coordinates[index * 2 + 1] as bigint,
  }))
}

const turn = (a: IntegerPoint, b: IntegerPoint, c: IntegerPoint) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
const between = (value: bigint, a: bigint, b: bigint) =>
  value >= (a < b ? a : b) && value <= (a > b ? a : b)
const on = (point: IntegerPoint, a: IntegerPoint, b: IntegerPoint) =>
  turn(a, b, point) === 0n && between(point.x, a.x, b.x) && between(point.y, a.y, b.y)

function edgesMeet(a: IntegerPoint, b: IntegerPoint, c: IntegerPoint, d: IntegerPoint): boolean {
  return (
    (turn(a, b, c) * turn(a, b, d) < 0n && turn(c, d, a) * turn(c, d, b) < 0n) ||
    on(a, c, d) ||
    on(b, c, d) ||
    on(c, a, b) ||
    on(d, a, b)
  )
}

/** Topology in the declared decimal coordinates; no physical snapping tolerance. */
function validRing(points: readonly PlanPoint[], budget: { remaining: number }): boolean {
  const ring = openRing(points)
  if (
    ring.length < 3 ||
    ring.length > 200 ||
    ring.some(
      (point) =>
        !Number.isFinite(point.xCm) ||
        !Number.isFinite(point.yCm) ||
        point.xCm < 0 ||
        point.yCm < 0 ||
        point.xCm > 10000 ||
        point.yCm > 10000,
    )
  )
    return false
  const vertices = integerRing(ring)
  let area = 0n
  for (let index = 0; index < vertices.length; index++) {
    const a = vertices[index] as IntegerPoint
    const b = vertices[(index + 1) % vertices.length] as IntegerPoint
    const c = vertices[(index + 2) % vertices.length] as IntegerPoint
    if (a.x === b.x && a.y === b.y) return false
    if (turn(a, b, c) === 0n && (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) < 0n)
      return false
    area += a.x * b.y - b.x * a.y
    for (let other = index + 2; other < vertices.length; other++) {
      if (index === 0 && other === vertices.length - 1) continue
      if (--budget.remaining < 0) return false
      if (
        edgesMeet(
          a,
          b,
          vertices[other] as IntegerPoint,
          vertices[(other + 1) % vertices.length] as IntegerPoint,
        )
      )
        return false
    }
  }
  return area !== 0n
}

const body = (points: readonly PlanPoint[]): Polygon => [
  openRing(points).map(({ xCm, yCm }) => [xCm, yCm]),
]
const points = (ring: Ring): PlanPoint[] => openRing(ring.map(([xCm, yCm]) => ({ xCm, yCm })))

/** Known surfaces only. The footprint is an extent, never a replacement slab at zero. */
export function signedPlanFloors(geometry: PlanGeometry): SignedFloors | undefined {
  if (geometry.verticalReference === undefined) return undefined
  const fail = (error: string): SignedFloors => ({ ok: false, error })
  if (geometry.requiresSourceReviewReimport)
    return fail(
      'Исходная разметка PDF изменилась. Обновите перенос схемы перед проверкой уровней пола.',
    )
  const inputPolygons = [
    geometry.footprint ?? [],
    ...geometry.rooms.map((room) => room.polygon),
    ...(geometry.voids ?? []).map((region) => region.polygon),
  ]
  if (inputPolygons.reduce((total, polygon) => total + polygon.length, 0) > 4096)
    return fail('Слишком сложные контуры для ограниченной проверки уровней пола.')
  const referenceIssue = inspectPlanVerticalReference(geometry)[0]
  if (referenceIssue) return fail(referenceIssue.message)
  if (geometry.status !== 'confirmed')
    return fail('Сначала подтвердите горизонтальную схему для переноса отметок пола.')
  const reference = geometry.verticalReference
  const footprint = geometry.footprint
  if (!reference || !footprint)
    return fail('Для переноса отметок нужна сверенная граница квартиры.')
  const polygons = [
    footprint,
    ...reference.floors.map((floor) => floor.room.polygon),
    ...(geometry.voids ?? []).map((region) => region.polygon),
  ]
  if (polygons.reduce((total, polygon) => total + polygon.length, 0) > 4096)
    return fail('Слишком сложные контуры для ограниченной проверки уровней пола.')
  const budget = { remaining: 500000 }
  if (polygons.some((polygon) => !validRing(polygon, budget)))
    return fail(
      'Проверьте замкнутые контуры пола и пустот: они не должны самопересекаться или иметь нулевую площадь.',
    )
  try {
    const extent = body(footprint)
    const floors = reference.floors.map((floor) => body(floor.room.polygon))
    if (
      floors.some(
        (floor, index) =>
          polygonClipping.difference(floor, extent).length > 0 ||
          floors
            .slice(index + 1)
            .some((other) => polygonClipping.intersection(floor, other).length > 0),
      )
    )
      return fail(
        'Контуры физических полов перекрываются или выходят за сверенную границу квартиры.',
      )
    const voids = (geometry.voids ?? []).map((region) => body(region.polygon))
    const surfaces: VolumeFloorSurface[] = []
    for (const [index, floor] of reference.floors.entries()) {
      const original = floors[index]
      if (!original) return fail('Не найден физический владелец пола.')
      const clipped = voids.length ? polygonClipping.difference(original, ...voids) : [original]
      if (!clipped.length)
        return fail('Контур пола целиком занят пустотой; уточните его физического владельца.')
      for (const [part, polygon] of clipped.entries()) {
        const outer = polygon[0]
        if (!outer) return fail('Не удалось сохранить границу физического пола.')
        surfaces.push({
          id: `${floor.id}:${part}`,
          floorId: floor.id,
          title: floor.room.name,
          floor: points(outer),
          voids: polygon.slice(1).map(points),
          elevationCm: floor.elevationCm,
          surface: floor.surface,
          roomId: `plan-floor:${floor.id}`,
        })
      }
    }
    if (
      !surfaces.length ||
      surfaces.length > 200 ||
      surfaces.reduce(
        (count, surface) =>
          count +
          surface.floor.length +
          surface.voids.reduce((holes, ring) => holes + ring.length, 0),
        0,
      ) > 4096
    )
      return fail('Слишком сложный результат разделения физического пола.')
    return { ok: true, reference, surfaces }
  } catch {
    return fail('Не удалось однозначно отделить пол от пустот. Сверьте контуры.')
  }
}
