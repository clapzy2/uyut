import type { PlanPageSegmentRef, PlanPageVertexProof } from '@uyut/db'
import polygonClipping, { type Polygon } from 'polygon-clipping'
import type { nativeFillCandidates } from './plan-native-fill-candidates'
import { polygonWithin } from './plan-page-review'
import type { PagePoint, PdfLinework } from './plan-pdf-linework'
import {
  type NativePageSegment,
  nativeEdgeCrossing,
  nativePageSegments,
} from './plan-pdf-opening-endpoint'

/** Минимальная длина стены в метрической схеме: короче - стена отбрасывается. */
const MIN_METRIC_WALL_CM = 1

type FillInventory = ReturnType<typeof nativeFillCandidates>

const ref = ({
  operationIndex,
  subpathIndex,
  segmentIndex,
}: NativePageSegment): PlanPageSegmentRef => ({
  operationIndex,
  subpathIndex,
  segmentIndex,
})

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
  /** Масштаб листа: по нему видно рёбра короче минимальной стены метрической схемы. */
  cmPerPoint?: number
}) {
  const { inventory, work } = input
  const held = (reason: string) => ({
    status: 'held' as const,
    reason,
    polygon: null,
    holes: 0,
    roomsOutside: [] as number[],
    vertexProofs: [] as PlanPageVertexProof[],
    shortEdges: [] as { index: number; start: PagePoint; end: PagePoint; lengthCm: number }[],
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
  // Булева операция может поставить вершину в точке пересечения двух штрихов. Такая
  // точка на чертеже есть, просто её не рисовали отдельным узлом: принимаем её только
  // с доказательством - два исходных отрезка, которые пересекаются ровно здесь. Если
  // отрезок не единственный или пересечение не совпадает, оболочку не предлагаем.
  const vertexProofs: PlanPageVertexProof[] = []
  const segments = nativePageSegments(work)
  const refCount = new Map<string, number>()
  for (const segment of segments) {
    const key = `${segment.operationIndex}:${segment.subpathIndex}:${segment.segmentIndex}`
    refCount.set(key, (refCount.get(key) ?? 0) + 1)
  }
  const unique = (segment: NativePageSegment) =>
    refCount.get(`${segment.operationIndex}:${segment.subpathIndex}:${segment.segmentIndex}`) === 1
  for (const [vertexIndex, point] of polygon.entries()) {
    if (nodes.has(`${point.x}:${point.y}`)) continue
    const through = segments.filter(
      (segment) =>
        unique(segment) &&
        Math.min(segment.start.x, segment.end.x) <= point.x &&
        Math.max(segment.start.x, segment.end.x) >= point.x &&
        Math.min(segment.start.y, segment.end.y) <= point.y &&
        Math.max(segment.start.y, segment.end.y) >= point.y,
    )
    const crossings = through.flatMap((first) =>
      through.flatMap((second) => {
        if (first === second) return []
        const crossing = nativeEdgeCrossing([first.start, first.end], second)
        return crossing && crossing.x === point.x && crossing.y === point.y
          ? [[first, second] as const]
          : []
      }),
    )
    const pair = crossings[0]
    if (!pair) return held('outer-envelope-vertex-not-native')
    vertexProofs.push({
      vertexIndex,
      kind: 'bounded-native-crossing',
      segments: [
        { ...ref(pair[0]), start: { ...pair[0].start }, end: { ...pair[0].end } },
        { ...ref(pair[1]), start: { ...pair[1].start }, end: { ...pair[1].end } },
      ],
    })
  }
  // Краска не всегда доходит до угла: тогда комната выходит за кольцо, и схема такую
  // границу не примет. Это не повод прятать предложение — человеку нужно показать,
  // что именно поправить, а не выдавать подсказку за проверенный контур.
  // Метрическая схема отбрасывает стену короче сантиметра (MIN_WALL_CM в
  // floor-plan-geometry.ts), а перенос отказывается целиком, если хоть одна стена
  // отброшена. Поэтому уступ в краске длиной в несколько миллиметров блокирует весь
  // черновик. Называем такие рёбра поимённо: сливать две вершины за человека значило
  // бы менять чертёж.
  const cmPerPoint = input.cmPerPoint
  const shortEdges =
    cmPerPoint && cmPerPoint > 0
      ? polygon.flatMap((point, index) => {
          const next = polygon[(index + 1) % polygon.length] as PagePoint
          const dx = ((next.x - point.x) * work.pageWidth) / 1000
          const dy = ((next.y - point.y) * work.pageHeight) / 1000
          const lengthCm = Math.hypot(dx, dy) * cmPerPoint
          return lengthCm < MIN_METRIC_WALL_CM
            ? [
                {
                  index,
                  start: { x: point.x, y: point.y },
                  end: { x: next.x, y: next.y },
                  lengthCm: Math.round(lengthCm * 100) / 100,
                },
              ]
            : []
        })
      : []
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
    /** Доказательства вершин, которых нет среди исходных узлов. */
    vertexProofs,
    /** Рёбра короче минимальной стены: перенос в 2D отказывается из-за такого уступа. */
    shortEdges,
  }
}
