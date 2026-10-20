import polygonClipping, { type Polygon } from 'polygon-clipping'
import type { nativeFillCandidates } from './plan-native-fill-candidates'
import { polygonWithin } from './plan-page-review'
import type { PagePoint, PdfLinework } from './plan-pdf-linework'

type FillInventory = ReturnType<typeof nativeFillCandidates>

/**
 * Наружная граница застройки по нарисованной краске листа.
 *
 * На обмерных листах тело стены нарисовано такой же заливкой, как и пол комнаты.
 * Объединение всех заливок даёт внешнюю грань наружных стен — это **оболочка
 * застройки**, а не чистый пол: внутрь неё входят тела стен. Поэтому роль здесь
 * всегда `outer-wall-envelope`, и отдельную границу пола она не заменяет.
 *
 * Предложение отдаётся человеку на сверку и не подтверждает геометрию само по себе.
 * Любая вершина кольца обязана быть исходным узлом PDF: булева операция может
 * создать точку пересечения, которой на чертеже нет, и такую границу мы не предлагаем.
 */
export function nativeOuterEnvelope(input: {
  inventory: FillInventory
  work: PdfLinework
  /** Контуры комнат, которые человек уже взял: по ним видно, где оболочку надо поправить. */
  rooms?: readonly { sourceNumber: number; polygon: readonly PagePoint[] }[]
}) {
  const { inventory, work } = input
  const held = (reason: string) => ({
    status: 'held' as const,
    reason,
    polygon: null,
    holes: 0,
    roomsOutside: [] as number[],
  })
  if (inventory.refusalReason) return held(inventory.refusalReason)
  if (inventory.truncated) return held('incomplete-fill-inventory')
  if (!inventory.candidates.length) return held('no-source-paint')
  if (inventory.candidates.length > 200) return held('fill-inventory-limit')
  const polygons = inventory.candidates.map(
    (candidate): Polygon => [candidate.polygon.map((point) => [point.x, point.y])],
  )
  let union: ReturnType<typeof polygonClipping.union>
  try {
    union = polygonClipping.union(polygons[0] as Polygon, ...polygons.slice(1))
  } catch {
    return held('unsupported-paint-union')
  }
  // Несколько несвязных пятен краски — это не одна квартира, выбор за человеком.
  if (union.length !== 1) return held('multiple-paint-components')
  const component = union[0]
  const ring = component?.[0]
  if (!ring || ring.length < 4) return held('unsupported-paint-union')
  // polygon-clipping замыкает кольцо повтором первой точки.
  const polygon = ring.slice(0, -1).map(([x, y]) => ({ x: x as number, y: y as number }))
  if (polygon.length < 3 || polygon.length > 100) return held('outer-envelope-vertex-limit')
  const nodes = new Set<string>()
  for (const path of work.paths) for (const point of path.points) nodes.add(`${point.x}:${point.y}`)
  if (polygon.some((point) => !nodes.has(`${point.x}:${point.y}`)))
    return held('outer-envelope-vertex-not-native')
  // Краска не всегда доходит до угла: тогда комната выходит за кольцо, и схема такую
  // границу не примет. Это не повод прятать предложение — человеку нужно показать,
  // что именно поправить, а не выдавать подсказку за проверенный контур.
  const roomsOutside = (input.rooms ?? [])
    .filter((room) => !polygonWithin(room.polygon, polygon))
    .map((room) => room.sourceNumber)
  return {
    status: 'diagnostic' as const,
    reason: null,
    polygon: polygon as PagePoint[],
    /** Незакрашенные области внутри оболочки: шахты и проёмы. Отдельная сверка. */
    holes: (component?.length ?? 1) - 1,
    /** Комнаты, выходящие за предложенное кольцо: подсказку нужно поправить. */
    roomsOutside,
  }
}
