import type { CatalogCategory } from '@uyut/db'
import type { DimensionsCm } from './dimensions'
import { parseWallReservations, type WallReservation, type WallReservationKind } from './openings'
import type { CatalogSubcategory } from './subcategories'

/**
 * Расстановка выбранной мебели по комнате, вид сверху.
 *
 * Это не дизайн-проект и не претендует на него: комната здесь прямоугольник, а предметы —
 * прямоугольники у стен. Смысл в другом. Картинка, которую рисует модель, сантиметров не знает,
 * и на ней в комнату влезает что угодно. Здесь считается арифметика: сумма ширин против длины
 * стен, остаток посередине против ширины прохода. Ответ «не влезает» получается до покупки,
 * а не после доставки.
 *
 * Проёмы учитываются, когда человек явно указал стену в описании комнаты. Если сторона не
 * названа, ничего не угадываем и не выдаём приблизительную схему за исполнительный чертёж.
 */

/** Минимальный проход, по которому человек проходит не боком */
export const WALKWAY_CM = 70

/** Сколько нужно от края обеденного стола до стены или мебели, чтобы отодвинуть стул */
export const CHAIR_PULLOUT_CM = 75

/** Вокруг журнального столика ходить не нужно, достаточно дотянуться */
export const COFFEE_CLEARANCE_CM = 40

export type LayoutItem = {
  id: string
  title: string
  category: CatalogCategory
  subcategory?: CatalogSubcategory
  dimensions: DimensionsCm | null
  operationClearance?: OperationClearanceCm | null
  /** Подтверждённое место от левого верхнего угла комнаты; без него место ищется автоматически. */
  placement?: {
    xCm: number
    yCm: number
    rotation: 0 | 90
    /** Куда обращена рабочая сторона предмета; без значения направление выводится от стены. */
    frontDirection?: LayoutDirection
  } | null
  quantity: number
}

/** Измеренный запас для использования мебели; ни одно поле не заполняется автоматически. */
export type OperationClearanceCm = { front?: number; side?: number; around?: number }

export type LayoutWall = 'top' | 'right' | 'bottom' | 'left'

/** Направление от предмета в координатах плана. */
export type LayoutDirection = 'up' | 'right' | 'down' | 'left'

export type LayoutPoint = {
  xCm: number
  yCm: number
}

/** Точный проём на любом участке контура комнаты. */
export type FloorReservation = {
  kind: WallReservationKind
  start: LayoutPoint
  end: LayoutPoint
  clearanceCm: number
  sillHeightCm?: number
}

/** Точная зона пола, которую нельзя занимать мебелью: дуга двери или запас у радиатора. */
export type FloorKeepClearZone = {
  kind: 'door' | 'balcony' | 'radiator'
  label: string
  polygon: LayoutPoint[]
}

export type Placement = {
  id: string
  /** Строка списка покупок, из которой получился прямоугольник. */
  itemId: string
  title: string
  /** Сантиметры от левого верхнего угла комнаты */
  xCm: number
  yCm: number
  widthCm: number
  depthCm: number
  wall: LayoutWall | 'perimeter' | 'center'
}

/** Зона, которую мебель не занимает постоянно, но которая нужна при её использовании. */
export type FunctionalZone = Rect & {
  itemId: string
  /** Конкретный прямоугольник мебели, которому принадлежит зона (важно при quantity > 1). */
  placementId: string
  title: string
  kind: 'front' | 'side' | 'around'
  direction: LayoutDirection | 'around'
  source: 'measured' | 'preliminary'
  clearanceCm: number
}

export type LayoutProblem =
  | { kind: 'noWall'; title: string; widthCm: number }
  | { kind: 'noCenter'; title: string }
  | { kind: 'narrowWalkway'; gapCm: number }
  | { kind: 'invalidPlacement'; title: string; reason: 'outside' | 'blocked' | 'collision' }
  | { kind: 'noRoomSize' }

export type RoomLayout = {
  /** Условия достоверности исходных размеров, показываются вместе со схемой. */
  measurementNote?: string
  widthCm: number
  depthCm: number
  /** Реальный контур пола в локальных координатах комнаты. */
  floorPolygon?: LayoutPoint[]
  placed: Placement[]
  /** Свободная длина стен после расстановки, сантиметры */
  freeWallCm: number
  /** Самый узкий проход между расставленным, сантиметры */
  walkwayCm: number
  problems: LayoutProblem[]
  /** Предметы, которые пол не занимают: люстры, картины, текстиль */
  offFloor: string[]
  /** Предметы без размеров: их разместить не из чего, пока размеры не появятся */
  unmeasured: Array<{ id: string; title: string }>
  /** Проёмы и инженерные зоны, уверенно извлечённые из описания комнаты */
  reservations: WallReservation[]
  /** Точные проёмы, включая стены ниш и выступов. */
  floorReservations: FloorReservation[]
  keepClearZones: FloorKeepClearZone[]
  functionalZones: FunctionalZone[]
  /** Предметы, для которых рабочую зону можно задать или уточнить. */
  operationInputs: Array<{
    id: string
    title: string
    kind: 'front' | 'side' | 'around'
    valueCm?: number
  }>
  /** Измеренная мебель, которую можно закрепить в точных координатах. */
  placementInputs: Array<{
    id: string
    title: string
    widthCm: number
    depthCm: number
    heightCm?: number
    xCm?: number
    yCm?: number
    rotation: 0 | 90
    frontDirection?: LayoutDirection
    operationKind?: 'front' | 'side' | 'around'
  }>
  /** Какие обмеры ещё нужны, чтобы проверка не подставляла типовые числа. */
  missingSafetyData: string[]
  /** Откуда взялись координаты проёмов. */
  reservationSource: 'geometry' | 'description' | 'none'
}

export type RoomLayoutInput = {
  widthCm?: number
  depthCm?: number
  layoutNotes?: string | null
  /** Реальный контур пола в локальных координатах комнаты. */
  floorPolygon?: readonly LayoutPoint[]
  /** Точные участки из подтверждённой 2D-схемы. Пустой массив тоже является точным ответом. */
  reservations?: readonly WallReservation[]
  /** Точные проёмы на произвольных участках контура. */
  floorReservations?: readonly FloorReservation[]
  /** Точные зоны открывания и инженерные резервы в локальных координатах комнаты. */
  keepClearZones?: readonly FloorKeepClearZone[]
  missingSafetyData?: readonly string[]
}

/** Где предмет стоит: у стены, посреди комнаты или нигде, потому что он висит. */
type Spot = 'wall' | 'center' | 'floorFree' | 'none'

function spotFor(item: LayoutItem): Spot {
  switch (item.category) {
    case 'bed':
    case 'sofa':
      return 'wall'
    case 'storage':
      return 'wall'
    case 'table':
      if (item.subcategory === 'dining' || item.subcategory === 'coffee') {
        return 'center'
      }
      return 'wall'
    case 'chair':
      // Стулья задвинуты под стол и своего места на полу не просят; кресло стоит отдельно
      return item.subcategory === 'armchair' ? 'wall' : 'none'
    case 'lamp':
      return item.subcategory === 'floorLamp' ? 'floorFree' : 'none'
    case 'rug':
      // Ковёр лежит на полу и ходить по нему можно: проход он не сужает
      return 'none'
    default:
      return 'none'
  }
}

/** Ширина вдоль стены и глубина от стены. Порядок сторон в фидах: ширина × глубина × высота. */
function footprint(dimensions: DimensionsCm | null): Size | null {
  if (!dimensions) {
    return null
  }
  const { width, depth } = dimensions
  if (!width || !depth) {
    return null
  }
  // Раскладка отвечает не только за длину вдоль стены, но и за выступ в комнату. Поэтому
  // частичный размер здесь хуже отсутствующего: выдуманная глубина создаёт ложный проход.
  return {
    widthCm: width,
    depthCm: depth,
    ...(dimensions.height === undefined ? {} : { heightCm: dimensions.height }),
  }
}

type Size = { widthCm: number; depthCm: number; heightCm?: number }

export type Rect = { xCm: number; yCm: number; widthCm: number; depthCm: number }

type FloorEdge = {
  orientation: 'horizontal' | 'vertical'
  fixedCm: number
  fromCm: number
  toCm: number
  inward: 1 | -1
}

// Только погрешность вычислений, не разрешение мебели выступать за стену на полсантиметра.
const GEOMETRY_EPSILON_CM = 1e-7

function pointOnSegment(point: LayoutPoint, start: LayoutPoint, end: LayoutPoint): boolean {
  const cross =
    (point.xCm - start.xCm) * (end.yCm - start.yCm) -
    (point.yCm - start.yCm) * (end.xCm - start.xCm)
  if (Math.abs(cross) > GEOMETRY_EPSILON_CM) return false
  return (
    point.xCm >= Math.min(start.xCm, end.xCm) - GEOMETRY_EPSILON_CM &&
    point.xCm <= Math.max(start.xCm, end.xCm) + GEOMETRY_EPSILON_CM &&
    point.yCm >= Math.min(start.yCm, end.yCm) - GEOMETRY_EPSILON_CM &&
    point.yCm <= Math.max(start.yCm, end.yCm) + GEOMETRY_EPSILON_CM
  )
}

/** Граница считается частью комнаты: мебель может стоять вплотную к стене. */
function pointInFloor(point: LayoutPoint, polygon: readonly LayoutPoint[]): boolean {
  let inside = false
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index]
    const end = polygon[(index + 1) % polygon.length]
    if (!start || !end) continue
    if (pointOnSegment(point, start, end)) return true
    if (
      start.yCm > point.yCm !== end.yCm > point.yCm &&
      point.xCm <
        ((end.xCm - start.xCm) * (point.yCm - start.yCm)) / (end.yCm - start.yCm) + start.xCm
    ) {
      inside = !inside
    }
  }
  return inside
}

/**
 * Весь прямоугольник мебели должен находиться на полу, а не только его центр.
 * Помимо контрольных точек проверяем каждое ребро: узкий вырез может пройти между точками.
 */
export function rectInsideFloor(rect: Rect, polygon: readonly LayoutPoint[]): boolean {
  const xs = [rect.xCm, rect.xCm + rect.widthCm / 2, rect.xCm + rect.widthCm]
  const ys = [rect.yCm, rect.yCm + rect.depthCm / 2, rect.yCm + rect.depthCm]
  if (!xs.every((xCm) => ys.every((yCm) => pointInFloor({ xCm, yCm }, polygon)))) return false
  return !polygon.some((start, index) => {
    const end = polygon[(index + 1) % polygon.length]
    if (!end) return false
    let from = 0
    let to = 1
    for (const [origin, delta, low, high] of [
      [
        start.xCm,
        end.xCm - start.xCm,
        rect.xCm + GEOMETRY_EPSILON_CM,
        rect.xCm + rect.widthCm - GEOMETRY_EPSILON_CM,
      ],
      [
        start.yCm,
        end.yCm - start.yCm,
        rect.yCm + GEOMETRY_EPSILON_CM,
        rect.yCm + rect.depthCm - GEOMETRY_EPSILON_CM,
      ],
    ] as const) {
      if (Math.abs(delta) <= GEOMETRY_EPSILON_CM) {
        if (origin < low || origin > high) return false
      } else {
        const a = (low - origin) / delta
        const b = (high - origin) / delta
        from = Math.max(from, Math.min(a, b))
        to = Math.min(to, Math.max(a, b))
        if (from > to) return false
      }
    }
    return from <= to
  })
}

function validFloorPolygon(
  polygon: readonly LayoutPoint[] | undefined,
  room: Size,
): LayoutPoint[] | undefined {
  if (!polygon || polygon.length < 3) return undefined
  const copy = polygon.map((point) => ({ xCm: point.xCm, yCm: point.yCm }))
  return copy.every(
    (point) =>
      Number.isFinite(point.xCm) &&
      Number.isFinite(point.yCm) &&
      point.xCm >= -GEOMETRY_EPSILON_CM &&
      point.yCm >= -GEOMETRY_EPSILON_CM &&
      point.xCm <= room.widthCm + GEOMETRY_EPSILON_CM &&
      point.yCm <= room.depthCm + GEOMETRY_EPSILON_CM,
  )
    ? copy
    : undefined
}

function floorEdges(polygon: readonly LayoutPoint[]): FloorEdge[] {
  const edges: FloorEdge[] = []
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index]
    const end = polygon[(index + 1) % polygon.length]
    if (!start || !end) continue
    const horizontal = Math.abs(start.yCm - end.yCm) <= GEOMETRY_EPSILON_CM
    const vertical = Math.abs(start.xCm - end.xCm) <= GEOMETRY_EPSILON_CM
    if (!horizontal && !vertical) continue
    if (horizontal) {
      const fromCm = Math.min(start.xCm, end.xCm)
      const toCm = Math.max(start.xCm, end.xCm)
      if (toCm - fromCm <= GEOMETRY_EPSILON_CM) continue
      const fixedCm = (start.yCm + end.yCm) / 2
      const middleCm = (fromCm + toCm) / 2
      const inward: 1 | -1 = pointInFloor({ xCm: middleCm, yCm: fixedCm + 1 }, polygon) ? 1 : -1
      edges.push({ orientation: 'horizontal', fixedCm, fromCm, toCm, inward })
      continue
    }
    const fromCm = Math.min(start.yCm, end.yCm)
    const toCm = Math.max(start.yCm, end.yCm)
    if (toCm - fromCm <= GEOMETRY_EPSILON_CM) continue
    const fixedCm = (start.xCm + end.xCm) / 2
    const middleCm = (fromCm + toCm) / 2
    const inward: 1 | -1 = pointInFloor({ xCm: fixedCm + 1, yCm: middleCm }, polygon) ? 1 : -1
    edges.push({ orientation: 'vertical', fixedCm, fromCm, toCm, inward })
  }
  return edges
}

export function wallReservationToFloorReservation(
  reservation: WallReservation,
  roomWidthCm: number,
  roomDepthCm: number,
): FloorReservation {
  const base = {
    kind: reservation.kind,
    clearanceCm: reservation.clearanceCm,
    ...(reservation.sillHeightCm === undefined ? {} : { sillHeightCm: reservation.sillHeightCm }),
  }
  switch (reservation.wall) {
    case 'top':
      return {
        ...base,
        start: { xCm: reservation.fromCm, yCm: 0 },
        end: { xCm: reservation.toCm, yCm: 0 },
      }
    case 'bottom':
      return {
        ...base,
        start: { xCm: reservation.fromCm, yCm: roomDepthCm },
        end: { xCm: reservation.toCm, yCm: roomDepthCm },
      }
    case 'left':
      return {
        ...base,
        start: { xCm: 0, yCm: reservation.fromCm },
        end: { xCm: 0, yCm: reservation.toCm },
      }
    case 'right':
      return {
        ...base,
        start: { xCm: roomWidthCm, yCm: reservation.fromCm },
        end: { xCm: roomWidthCm, yCm: reservation.toCm },
      }
  }
}

export function floorReservationRect(
  reservation: FloorReservation,
  polygon: readonly LayoutPoint[],
): Rect | null {
  if (reservation.clearanceCm <= 0) return null
  const horizontal = Math.abs(reservation.start.yCm - reservation.end.yCm) <= GEOMETRY_EPSILON_CM
  const vertical = Math.abs(reservation.start.xCm - reservation.end.xCm) <= GEOMETRY_EPSILON_CM
  if (!horizontal && !vertical) return null
  if (horizontal) {
    const fromCm = Math.min(reservation.start.xCm, reservation.end.xCm)
    const toCm = Math.max(reservation.start.xCm, reservation.end.xCm)
    const yCm = (reservation.start.yCm + reservation.end.yCm) / 2
    const middleCm = (fromCm + toCm) / 2
    const inward = pointInFloor({ xCm: middleCm, yCm: yCm + 1 }, polygon) ? 1 : -1
    return {
      xCm: fromCm,
      yCm: inward > 0 ? yCm : yCm - reservation.clearanceCm,
      widthCm: toCm - fromCm,
      depthCm: reservation.clearanceCm,
    }
  }
  const fromCm = Math.min(reservation.start.yCm, reservation.end.yCm)
  const toCm = Math.max(reservation.start.yCm, reservation.end.yCm)
  const xCm = (reservation.start.xCm + reservation.end.xCm) / 2
  const middleCm = (fromCm + toCm) / 2
  const inward = pointInFloor({ xCm: xCm + 1, yCm: middleCm }, polygon) ? 1 : -1
  return {
    xCm: inward > 0 ? xCm : xCm - reservation.clearanceCm,
    yCm: fromCm,
    widthCm: reservation.clearanceCm,
    depthCm: toCm - fromCm,
  }
}

export function rectBlocksFloorReservation(rect: Rect, reservation: FloorReservation): boolean {
  const horizontal = Math.abs(reservation.start.yCm - reservation.end.yCm) <= GEOMETRY_EPSILON_CM
  if (horizontal) {
    const yCm = (reservation.start.yCm + reservation.end.yCm) / 2
    const fromCm = Math.min(reservation.start.xCm, reservation.end.xCm)
    const toCm = Math.max(reservation.start.xCm, reservation.end.xCm)
    return (
      yCm >= rect.yCm - GEOMETRY_EPSILON_CM &&
      yCm <= rect.yCm + rect.depthCm + GEOMETRY_EPSILON_CM &&
      fromCm < rect.xCm + rect.widthCm - GEOMETRY_EPSILON_CM &&
      rect.xCm < toCm - GEOMETRY_EPSILON_CM
    )
  }
  const vertical = Math.abs(reservation.start.xCm - reservation.end.xCm) <= GEOMETRY_EPSILON_CM
  if (!vertical) return false
  const xCm = (reservation.start.xCm + reservation.end.xCm) / 2
  const fromCm = Math.min(reservation.start.yCm, reservation.end.yCm)
  const toCm = Math.max(reservation.start.yCm, reservation.end.yCm)
  return (
    xCm >= rect.xCm - GEOMETRY_EPSILON_CM &&
    xCm <= rect.xCm + rect.widthCm + GEOMETRY_EPSILON_CM &&
    fromCm < rect.yCm + rect.depthCm - GEOMETRY_EPSILON_CM &&
    rect.yCm < toCm - GEOMETRY_EPSILON_CM
  )
}

export function reservationBlocksHeight(
  reservation: Pick<FloorReservation, 'kind' | 'sillHeightCm'>,
  item: { heightCm?: number },
): boolean {
  if (reservation.kind !== 'window' || reservation.sillHeightCm === undefined) return true
  return item.heightCm === undefined || item.heightCm >= reservation.sillHeightCm
}

/** SAT для прямоугольника и выпуклой зоны. Касание границ допустимо, пересечение — нет. */
export function rectOverlapsPolygon(rect: Rect, polygon: readonly LayoutPoint[]): boolean {
  if (polygon.length < 3) return false
  const rectPoints = [
    { xCm: rect.xCm, yCm: rect.yCm },
    { xCm: rect.xCm + rect.widthCm, yCm: rect.yCm },
    { xCm: rect.xCm + rect.widthCm, yCm: rect.yCm + rect.depthCm },
    { xCm: rect.xCm, yCm: rect.yCm + rect.depthCm },
  ]
  for (const shape of [rectPoints, polygon]) {
    for (let index = 0; index < shape.length; index += 1) {
      const start = shape[index]
      const end = shape[(index + 1) % shape.length]
      if (!start || !end) continue
      const length = Math.hypot(end.xCm - start.xCm, end.yCm - start.yCm)
      if (length <= GEOMETRY_EPSILON_CM) continue
      const nx = -(end.yCm - start.yCm) / length
      const ny = (end.xCm - start.xCm) / length
      const rectProjection = rectPoints.map((point) => point.xCm * nx + point.yCm * ny)
      const polygonProjection = polygon.map((point) => point.xCm * nx + point.yCm * ny)
      if (
        Math.max(...rectProjection) <= Math.min(...polygonProjection) + GEOMETRY_EPSILON_CM ||
        Math.max(...polygonProjection) <= Math.min(...rectProjection) + GEOMETRY_EPSILON_CM
      )
        return false
    }
  }
  return true
}

type WallState = {
  wall: LayoutWall
  lengthCm: number
  usedCm: number
  /** Насколько мебель этой стены выступает в комнату */
  depthCm: number
  items: Array<{ id: string; title: string; size: Size }>
}

/**
 * Разворот предмета по стене. В координатах комнаты widthCm — всегда протяжённость по горизонтали,
 * depthCm — по вертикали, поэтому у боковых стен стороны меняются местами.
 */
function sizeOnWall(wall: LayoutWall, size: Size): Size {
  return wall === 'top' || wall === 'bottom'
    ? size
    : {
        widthCm: size.depthCm,
        depthCm: size.widthCm,
        ...(size.heightCm === undefined ? {} : { heightCm: size.heightCm }),
      }
}

function operationRequirement(
  item: LayoutItem,
): { kind: 'front' | 'side' | 'around'; fallbackCm?: number } | null {
  if (item.category === 'sofa') return { kind: 'front' }
  if (item.category === 'bed') return { kind: 'side' }
  if (
    item.category === 'storage' &&
    (!item.subcategory || ['wardrobe', 'dresser', 'cabinet'].includes(item.subcategory))
  ) {
    return { kind: 'front' }
  }
  if (item.category === 'table' && item.subcategory === 'dining') {
    return { kind: 'around', fallbackCm: CHAIR_PULLOUT_CM }
  }
  if (item.category === 'table' && item.subcategory === 'desk') {
    return { kind: 'front' }
  }
  if (item.category === 'table' && item.subcategory === 'coffee') {
    return { kind: 'around', fallbackCm: COFFEE_CLEARANCE_CM }
  }
  return null
}

/** Рабочая зона предмета в выбранном месте. Общая функция нужна серверу и живому 2D-превью. */
export function functionalZoneRect(
  rect: Rect,
  requirement: Pick<FunctionalZone, 'kind' | 'clearanceCm'>,
  direction: LayoutDirection | 'around',
): Rect {
  const { kind, clearanceCm: clearance } = requirement
  if (kind === 'around' || direction === 'around') {
    return {
      xCm: rect.xCm - clearance,
      yCm: rect.yCm - clearance,
      widthCm: rect.widthCm + clearance * 2,
      depthCm: rect.depthCm + clearance * 2,
    }
  }
  const side = kind === 'side' ? clearance : 0
  const front = kind === 'front' ? clearance : 0
  switch (direction) {
    case 'down':
      return {
        xCm: rect.xCm - side,
        yCm: rect.yCm,
        widthCm: rect.widthCm + side * 2,
        depthCm: rect.depthCm + front,
      }
    case 'up':
      return {
        xCm: rect.xCm - side,
        yCm: rect.yCm - front,
        widthCm: rect.widthCm + side * 2,
        depthCm: rect.depthCm + front,
      }
    case 'right':
      return {
        xCm: rect.xCm,
        yCm: rect.yCm - side,
        widthCm: rect.widthCm + front,
        depthCm: rect.depthCm + side * 2,
      }
    case 'left':
      return {
        xCm: rect.xCm - front,
        yCm: rect.yCm - side,
        widthCm: rect.widthCm + front,
        depthCm: rect.depthCm + side * 2,
      }
  }
}

function directionFromWall(wall: LayoutWall | 'perimeter' | 'center'): LayoutDirection | 'around' {
  switch (wall) {
    case 'top':
      return 'down'
    case 'right':
      return 'left'
    case 'bottom':
      return 'up'
    case 'left':
      return 'right'
    case 'perimeter':
    case 'center':
      return 'around'
  }
}

function operationZone(
  item: LayoutItem,
  rect: Rect,
  wall: LayoutWall | 'perimeter' | 'center',
  placementId: string,
  frontDirection?: LayoutDirection,
): FunctionalZone | null {
  const requirement = operationRequirement(item)
  if (!requirement) return null
  const measured = item.operationClearance?.[requirement.kind]
  const clearance = measured ?? requirement.fallbackCm
  if (!clearance || clearance <= 0) return null
  const base = {
    itemId: item.id,
    placementId,
    title: item.title,
    kind: requirement.kind,
    direction: frontDirection ?? directionFromWall(wall),
    source: measured ? ('measured' as const) : ('preliminary' as const),
    clearanceCm: clearance,
  }
  return { ...base, ...functionalZoneRect(rect, base, base.direction) }
}

/** Угол предмета в координатах комнаты. Размер здесь уже развёрнут по стене. */
function cornerOf(
  wall: LayoutWall,
  along: number,
  size: Size,
  room: Size,
): { xCm: number; yCm: number } {
  switch (wall) {
    case 'top':
      return { xCm: along, yCm: 0 }
    case 'bottom':
      return { xCm: along, yCm: room.depthCm - size.depthCm }
    case 'left':
      return { xCm: 0, yCm: along }
    default:
      return { xCm: room.widthCm - size.widthCm, yCm: along }
  }
}

/**
 * Отрезок стены, на который можно ставить.
 *
 * Угол комнаты принадлежит сразу двум стенам, и без разведения шкаф у левой стены и комод
 * у верхней вставали в одну клетку. Уступают углы только боковые стены: этого достаточно,
 * чтобы прямоугольники не пересекались, а горизонтальные сохраняют всю свою длину. Резать
 * обе пары — значит объявлять бездомной мебель, которой на стене есть место: на переборе
 * из семи с половиной тысяч комнат так терялось шесть процентов раскладок.
 */
function spanOf(
  wall: LayoutWall,
  depths: Record<LayoutWall, number>,
  room: Size,
): { from: number; to: number } {
  return wall === 'top' || wall === 'bottom'
    ? { from: 0, to: room.widthCm }
    : { from: depths.top, to: room.depthCm - depths.bottom }
}

/** Шаг сетки, на которой проверяется проходимость. Пять сантиметров — точнее, чем мерит рулетка. */
const GRID_CM = 5

/** Потолок числа клеток: у квартиры-студии на двадцать метров сетка иначе разрастается. */
const GRID_CELLS = 10_000

/** Выше этого ширина прохода уже ни на что не влияет, и искать её точнее незачем. */
const ROUTE_CAP_CM = 150

/** Кусок свободного пола меньше этого считаем закутком, а не отрезанной частью комнаты. */
const ISLAND_CELLS = 20

/**
 * Самый широкий маршрут по комнате.
 *
 * Считать зазоры между парами предметов бесполезно: угол бывает заперт мебелью соседних стен,
 * которые друг напротив друга не стоят вовсе. Поэтому комната растеризуется, и для каждой ширины
 * прохода проверяется, остаётся ли свободный пол единым куском. Возвращается наибольшая ширина,
 * при которой по комнате ещё можно пройти всюду.
 */
function widestRoute(
  placed: readonly Rect[],
  room: Size,
  floorPolygon?: readonly LayoutPoint[],
): number {
  const step = Math.max(
    GRID_CM,
    Math.ceil(Math.sqrt((room.widthCm * room.depthCm) / GRID_CELLS) / GRID_CM) * GRID_CM,
  )
  const cols = Math.max(1, Math.floor(room.widthCm / step))
  const rows = Math.max(1, Math.floor(room.depthCm / step))
  const busy = new Uint8Array(cols * rows)
  if (floorPolygon) {
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const center = { xCm: (x + 0.5) * step, yCm: (y + 0.5) * step }
        if (!pointInFloor(center, floorPolygon)) busy[y * cols + x] = 1
      }
    }
  }
  for (const place of placed) {
    const fromX = Math.max(0, Math.floor(place.xCm / step))
    const toX = Math.min(cols, Math.ceil((place.xCm + place.widthCm) / step))
    const fromY = Math.max(0, Math.floor(place.yCm / step))
    const toY = Math.min(rows, Math.ceil((place.yCm + place.depthCm) / step))
    for (let y = fromY; y < toY; y += 1) {
      for (let x = fromX; x < toX; x += 1) {
        busy[y * cols + x] = 1
      }
    }
  }
  // Сумма по прямоугольнику за одно обращение: иначе на каждую клетку пришлось бы обходить
  // весь квадрат прохода заново
  const sums = new Int32Array((cols + 1) * (rows + 1))
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      sums[(y + 1) * (cols + 1) + x + 1] =
        (busy[y * cols + x] as number) +
        (sums[y * (cols + 1) + x + 1] as number) +
        (sums[(y + 1) * (cols + 1) + x] as number) -
        (sums[y * (cols + 1) + x] as number)
    }
  }
  const busyIn = (x0: number, y0: number, x1: number, y1: number) =>
    (sums[y1 * (cols + 1) + x1] as number) -
    (sums[y0 * (cols + 1) + x1] as number) -
    (sums[y1 * (cols + 1) + x0] as number) +
    (sums[y0 * (cols + 1) + x0] as number)

  const fits = (widthCells: number): boolean => {
    // Клетка проходима, если вокруг неё умещается свободный квадрат нужной ширины
    const half = Math.floor(widthCells / 2)
    const open = new Uint8Array(cols * rows)
    let total = 0
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const x0 = Math.max(0, x - half)
        const y0 = Math.max(0, y - half)
        const x1 = Math.min(cols, x + widthCells - half)
        const y1 = Math.min(rows, y + widthCells - half)
        if (x1 - x0 < widthCells || y1 - y0 < widthCells) {
          continue
        }
        if (busyIn(x0, y0, x1, y1) === 0) {
          open[y * cols + x] = 1
          total += 1
        }
      }
    }
    if (total === 0) {
      return false
    }
    // Обходим первый найденный кусок: если за его пределами остался ещё один заметный,
    // значит, часть комнаты пешком недостижима
    const seen = new Uint8Array(cols * rows)
    const stack: number[] = []
    const first = open.indexOf(1)
    stack.push(first)
    seen[first] = 1
    let reached = 0
    while (stack.length > 0) {
      const at = stack.pop() as number
      reached += 1
      const x = at % cols
      const y = (at - x) / cols
      const around = [
        x > 0 ? at - 1 : -1,
        x + 1 < cols ? at + 1 : -1,
        y > 0 ? at - cols : -1,
        y + 1 < rows ? at + cols : -1,
      ]
      for (const next of around) {
        if (next >= 0 && open[next] === 1 && seen[next] === 0) {
          seen[next] = 1
          stack.push(next)
        }
      }
    }
    return total - reached < ISLAND_CELLS
  }

  // Проходимость только сужается с ростом ширины, поэтому ищем делением пополам,
  // а не перебором: у большой комнаты перебор шагами по пять сантиметров занимал секунды
  let low = 0
  let high = Math.floor(Math.min(room.widthCm, room.depthCm, ROUTE_CAP_CM) / step)
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (fits(middle)) {
      low = middle
    } else {
      high = middle - 1
    }
  }
  return low * step
}

const OPPOSITE: Record<LayoutWall, LayoutWall> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
}

/**
 * Влезет ли предмет к этой стене, не упёршись в мебель напротив.
 *
 * Стена бывает достаточно длинной, а комната при этом узкой: шкаф глубиной 165 см у левой стены
 * и такой же у правой в комнате шириной 252 см смыкаются посередине. Длина стены об этом
 * ничего не говорит, поэтому глубину проверяем отдельно.
 */
function depthFits(wall: WallState, item: Size, walls: Record<LayoutWall, WallState>, room: Size) {
  const across = wall.wall === 'top' || wall.wall === 'bottom' ? room.depthCm : room.widthCm
  const opposite = walls[OPPOSITE[wall.wall]].depthCm
  return Math.max(wall.depthCm, item.depthCm) + opposite <= across
}

type Sized = {
  item: LayoutItem
  size: Size
  spot: Spot
  placement?: {
    xCm: number
    yCm: number
    rotation: 0 | 90
    frontDirection?: LayoutDirection
  }
}

/**
 * Сколько места нужно вокруг предмета посреди комнаты. У обеденного стола это отодвинутый стул,
 * у журнального — вытянутая рука: требовать вокруг журнального столика проход в семьдесят
 * сантиметров бессмысленно, он для того и стоит вплотную к дивану.
 */
function clearanceOf(entry: Sized): number {
  return (
    entry.item.operationClearance?.around ??
    (entry.item.subcategory === 'dining' ? CHAIR_PULLOUT_CM : COFFEE_CLEARANCE_CM)
  )
}

/**
 * Раскладывает мебель: крупное к стенам, стол посередине.
 *
 * Двумя проходами. Сначала предметы разбираются по стенам — на ту, где больше свободного места.
 * Куда именно вдоль стены встанет предмет, на этом шаге ещё неизвестно: это зависит от того,
 * насколько выступит мебель соседних стен, а она разбирается здесь же. Координаты считаются
 * вторым проходом, когда глубина каждой стены уже известна.
 *
 * Это не оптимальная упаковка и не пытается ею быть: нам нужен ответ «влезает или нет»,
 * а не лучшая из возможных расстановок.
 */
export function layoutRoom(room: RoomLayoutInput, items: readonly LayoutItem[]): RoomLayout {
  const widthCm = room.widthCm ?? 0
  const depthCm = room.depthCm ?? 0
  const floorPolygon = validFloorPolygon(room.floorPolygon, { widthCm, depthCm })
  if (widthCm <= 0 || depthCm <= 0) {
    return {
      widthCm,
      depthCm,
      placed: [],
      freeWallCm: 0,
      walkwayCm: 0,
      problems: [{ kind: 'noRoomSize' }],
      offFloor: [],
      unmeasured: [],
      reservations: [],
      floorReservations: [],
      keepClearZones: [],
      functionalZones: [],
      operationInputs: [],
      placementInputs: [],
      missingSafetyData: [],
      reservationSource: 'none',
    }
  }

  const offFloor: string[] = []
  const unmeasured: Array<{ id: string; title: string }> = []
  const problems: LayoutProblem[] = []
  const placed: Placement[] = []
  const functionalZones: FunctionalZone[] = []
  const operationInputs: RoomLayout['operationInputs'] = []
  const placementInputs: RoomLayout['placementInputs'] = []
  const itemById = new Map(items.map((item) => [item.id, item]))
  const explicitReservations = room.reservations
  const explicitFloorReservations = room.floorReservations
  const hasGeometryReservations =
    explicitReservations !== undefined || explicitFloorReservations !== undefined
  const reservations =
    explicitReservations !== undefined
      ? explicitReservations.map((reservation) => ({ ...reservation }))
      : parseWallReservations(room.layoutNotes, { widthCm, depthCm })
  const reservationSource = hasGeometryReservations
    ? 'geometry'
    : reservations.length > 0
      ? 'description'
      : 'none'
  const floorReservations =
    explicitFloorReservations?.map((reservation) => ({
      ...reservation,
      start: { ...reservation.start },
      end: { ...reservation.end },
    })) ?? []
  const keepClearZones =
    room.keepClearZones
      ?.filter(
        (zone) =>
          zone.polygon.length >= 3 &&
          zone.polygon.every((point) => Number.isFinite(point.xCm) && Number.isFinite(point.yCm)),
      )
      .map((zone) => ({
        ...zone,
        polygon: zone.polygon.map((point) => ({ ...point })),
      })) ?? []
  const missingSafetyData = [...new Set(room.missingSafetyData ?? [])]
  const wallFloorReservations = reservations.map((reservation) =>
    wallReservationToFloorReservation(reservation, widthCm, depthCm),
  )
  const blockingFloorReservations = [...floorReservations, ...wallFloorReservations]

  const overlaps = (a: Rect, b: Rect) =>
    a.xCm < b.xCm + b.widthCm - GEOMETRY_EPSILON_CM &&
    b.xCm < a.xCm + a.widthCm - GEOMETRY_EPSILON_CM &&
    a.yCm < b.yCm + b.depthCm - GEOMETRY_EPSILON_CM &&
    b.yCm < a.yCm + a.depthCm - GEOMETRY_EPSILON_CM
  const clearanceRects: Rect[] = reservations
    .filter((reservation) => reservation.clearanceCm > 0)
    .map((reservation) => {
      const length = reservation.toCm - reservation.fromCm
      switch (reservation.wall) {
        case 'top':
          return {
            xCm: reservation.fromCm,
            yCm: 0,
            widthCm: length,
            depthCm: reservation.clearanceCm,
          }
        case 'bottom':
          return {
            xCm: reservation.fromCm,
            yCm: depthCm - reservation.clearanceCm,
            widthCm: length,
            depthCm: reservation.clearanceCm,
          }
        case 'left':
          return {
            xCm: 0,
            yCm: reservation.fromCm,
            widthCm: reservation.clearanceCm,
            depthCm: length,
          }
        case 'right':
          return {
            xCm: widthCm - reservation.clearanceCm,
            yCm: reservation.fromCm,
            widthCm: reservation.clearanceCm,
            depthCm: length,
          }
        default:
          return { xCm: 0, yCm: 0, widthCm: 0, depthCm: 0 }
      }
    })
  if (floorPolygon) {
    for (const reservation of floorReservations) {
      const clearance = floorReservationRect(reservation, floorPolygon)
      if (clearance) clearanceRects.push(clearance)
    }
  }

  const sized: Sized[] = []
  for (const item of items) {
    const spot = spotFor(item)
    if (spot === 'none') {
      offFloor.push(item.title)
      continue
    }
    const size = footprint(item.dimensions)
    if (!size) {
      unmeasured.push({ id: item.id, title: item.title })
      continue
    }
    const operation = operationRequirement(item)
    if (operation) {
      const valueCm = item.operationClearance?.[operation.kind]
      operationInputs.push({
        id: item.id,
        title: item.title,
        kind: operation.kind,
        ...(valueCm === undefined ? {} : { valueCm }),
      })
    }
    placementInputs.push({
      id: item.id,
      title: item.title,
      widthCm: size.widthCm,
      depthCm: size.depthCm,
      ...(size.heightCm === undefined ? {} : { heightCm: size.heightCm }),
      ...(item.placement ? { xCm: item.placement.xCm, yCm: item.placement.yCm } : {}),
      rotation: item.placement?.rotation ?? 0,
      ...(item.placement?.frontDirection ? { frontDirection: item.placement.frontDirection } : {}),
      ...(operation ? { operationKind: operation.kind } : {}),
    })
    // Два одинаковых стула занимают пол дважды: количество разворачивается в отдельные предметы
    for (let copy = 0; copy < Math.max(1, item.quantity); copy += 1) {
      sized.push({
        item,
        size,
        spot,
        ...(copy === 0 && item.placement ? { placement: item.placement } : {}),
      })
    }
  }

  const walls: Record<LayoutWall, WallState> = {
    top: { wall: 'top', lengthCm: widthCm, usedCm: 0, depthCm: 0, items: [] },
    bottom: { wall: 'bottom', lengthCm: widthCm, usedCm: 0, depthCm: 0, items: [] },
    left: { wall: 'left', lengthCm: depthCm, usedCm: 0, depthCm: 0, items: [] },
    right: { wall: 'right', lengthCm: depthCm, usedCm: 0, depthCm: 0, items: [] },
  }
  const order: LayoutWall[] = ['top', 'bottom', 'left', 'right']

  type Homeless = { id: string; title: string; size: Size }
  const homeless: Homeless[] = []

  const wallItems = sized
    .filter((entry) => !entry.placement && (entry.spot === 'wall' || entry.spot === 'floorFree'))
    .sort((a, b) => b.size.widthCm - a.size.widthCm)

  for (const entry of wallItems) {
    const roomy = order
      .map((wall) => walls[wall])
      .filter(
        (wall) =>
          wall.lengthCm - wall.usedCm >= entry.size.widthCm &&
          depthFits(wall, entry.size, walls, { widthCm, depthCm }),
      )
      .sort((a, b) => b.lengthCm - b.usedCm - (a.lengthCm - a.usedCm))[0]
    // Не нашлось стены по длине — не приговор: свободный кусок ищет второй заход
    if (!roomy) {
      homeless.push({ id: entry.item.id, title: entry.item.title, size: entry.size })
      continue
    }
    roomy.items.push({ id: entry.item.id, title: entry.item.title, size: entry.size })
    roomy.usedCm += entry.size.widthCm
    roomy.depthCm = Math.max(roomy.depthCm, entry.size.depthCm)
  }

  // Горизонтальные стены кладутся первыми и на всю длину: их глубина задаёт отступ боковым.
  // Сначала считаем её только по назначенным предметам, потом уточняем по поставленным —
  // отвергнутая мебель не должна отрезать углы, которых она не занимает.
  const depths: Record<LayoutWall, number> = { top: 0, bottom: 0, left: 0, right: 0 }
  let freeWallCm = 0

  const cursor: Record<LayoutWall, number> = { top: 0, bottom: 0, left: 0, right: 0 }

  /**
   * Встанет ли предмет именно сюда. Проверяем сам прямоугольник против уже поставленных,
   * а не глубину стены целиком: у стены бывает занята половина, и грубая проверка
   * отказывала предмету, которому места хватало на второй половине.
   */
  const put = (wall: LayoutWall, item: Homeless, along: number): boolean => {
    const size = sizeOnWall(wall, item.size)
    const at = cornerOf(wall, along, size, { widthCm, depthCm })
    const rect = { ...at, ...size }
    const sourceItem = itemById.get(item.id)
    const placementId = `${item.id}-${placed.length}`
    const zone = sourceItem ? operationZone(sourceItem, rect, wall, placementId) : null
    const insideRoom =
      at.xCm >= -GEOMETRY_EPSILON_CM &&
      at.yCm >= -GEOMETRY_EPSILON_CM &&
      at.xCm + size.widthCm <= widthCm + GEOMETRY_EPSILON_CM &&
      at.yCm + size.depthCm <= depthCm + GEOMETRY_EPSILON_CM
    if (!insideRoom) {
      return false
    }
    const zoneInsideRoom =
      !zone ||
      (zone.xCm >= -GEOMETRY_EPSILON_CM &&
        zone.yCm >= -GEOMETRY_EPSILON_CM &&
        zone.xCm + zone.widthCm <= widthCm + GEOMETRY_EPSILON_CM &&
        zone.yCm + zone.depthCm <= depthCm + GEOMETRY_EPSILON_CM)
    if (!zoneInsideRoom) return false
    if (floorPolygon && !rectInsideFloor(rect, floorPolygon)) {
      return false
    }
    if (floorPolygon && zone && !rectInsideFloor(zone, floorPolygon)) return false
    const blocksWall = reservations.some(
      (reservation) =>
        reservation.wall === wall &&
        reservationBlocksHeight(reservation, item.size) &&
        along < reservation.toCm - GEOMETRY_EPSILON_CM &&
        reservation.fromCm < along + item.size.widthCm - GEOMETRY_EPSILON_CM,
    )
    const collides = placed.some((other) => overlaps(rect, other))
    const blocksFunctionalZone = functionalZones.some((other) => overlaps(rect, other))
    const operationCollides =
      zone !== null &&
      (placed.some((other) => overlaps(zone, other)) ||
        functionalZones.some((other) => overlaps(zone, other)))
    const blocksAccess = clearanceRects.some((clearance) => overlaps(rect, clearance))
    const blocksFloorOpening = blockingFloorReservations.some(
      (reservation) =>
        reservationBlocksHeight(reservation, item.size) &&
        rectBlocksFloorReservation(rect, reservation),
    )
    const blocksKeepClearZone = keepClearZones.some((zone) =>
      rectOverlapsPolygon(rect, zone.polygon),
    )
    const operationBlocksAccess =
      zone !== null &&
      (clearanceRects.some((clearance) => overlaps(zone, clearance)) ||
        keepClearZones.some((keepClear) => rectOverlapsPolygon(zone, keepClear.polygon)))
    if (
      blocksWall ||
      blocksFloorOpening ||
      collides ||
      blocksFunctionalZone ||
      operationCollides ||
      blocksAccess ||
      blocksKeepClearZone ||
      operationBlocksAccess
    ) {
      return false
    }
    placed.push({
      id: placementId,
      itemId: item.id,
      title: item.title,
      xCm: at.xCm,
      yCm: at.yCm,
      widthCm: size.widthCm,
      depthCm: size.depthCm,
      wall,
    })
    if (zone) functionalZones.push(zone)
    cursor[wall] = Math.max(cursor[wall], along + item.size.widthCm)
    depths[wall] = Math.max(depths[wall], item.size.depthCm)
    return true
  }

  const perimeterEdges = floorPolygon
    ? floorEdges(floorPolygon).toSorted((a, b) => b.toCm - b.fromCm - (a.toCm - a.fromCm))
    : []

  /** Ставит предмет к стене ниши или выступа, которой нет среди четырёх сторон рамки. */
  const putOnFloorEdge = (edge: FloorEdge, item: Homeless, alongCm: number): boolean => {
    const rect: Rect =
      edge.orientation === 'horizontal'
        ? {
            xCm: alongCm,
            yCm: edge.inward > 0 ? edge.fixedCm : edge.fixedCm - item.size.depthCm,
            widthCm: item.size.widthCm,
            depthCm: item.size.depthCm,
          }
        : {
            xCm: edge.inward > 0 ? edge.fixedCm : edge.fixedCm - item.size.depthCm,
            yCm: alongCm,
            widthCm: item.size.depthCm,
            depthCm: item.size.widthCm,
          }
    if (!floorPolygon || !rectInsideFloor(rect, floorPolygon)) return false
    const sourceItem = itemById.get(item.id)
    const zoneWall: LayoutWall =
      edge.orientation === 'horizontal'
        ? edge.inward > 0
          ? 'top'
          : 'bottom'
        : edge.inward > 0
          ? 'left'
          : 'right'
    const placementId = `${item.id}-${placed.length}`
    const zone = sourceItem ? operationZone(sourceItem, rect, zoneWall, placementId) : null
    if (zone && !rectInsideFloor(zone, floorPolygon)) return false
    if (placed.some((other) => overlaps(rect, other))) return false
    if (functionalZones.some((other) => overlaps(rect, other))) return false
    if (
      zone &&
      (placed.some((other) => overlaps(zone, other)) ||
        functionalZones.some((other) => overlaps(zone, other)))
    )
      return false
    if (clearanceRects.some((clearance) => overlaps(rect, clearance))) return false
    if (
      blockingFloorReservations.some(
        (reservation) =>
          reservationBlocksHeight(reservation, item.size) &&
          rectBlocksFloorReservation(rect, reservation),
      ) ||
      keepClearZones.some((zone) => rectOverlapsPolygon(rect, zone.polygon))
    ) {
      return false
    }
    placed.push({
      id: placementId,
      itemId: item.id,
      title: item.title,
      ...rect,
      wall: 'perimeter',
    })
    if (zone) functionalZones.push(zone)
    return true
  }

  const manualEntries = sized.filter((entry) => entry.placement)
  for (const entry of manualEntries) {
    const fixed = entry.placement
    if (!fixed) continue
    const rotated = fixed.rotation === 90
    const rect: Rect = {
      xCm: fixed.xCm,
      yCm: fixed.yCm,
      widthCm: rotated ? entry.size.depthCm : entry.size.widthCm,
      depthCm: rotated ? entry.size.widthCm : entry.size.depthCm,
    }
    const touchesTop = Math.abs(rect.yCm) <= GEOMETRY_EPSILON_CM
    const touchesBottom = Math.abs(rect.yCm + rect.depthCm - depthCm) <= GEOMETRY_EPSILON_CM
    const touchesLeft = Math.abs(rect.xCm) <= GEOMETRY_EPSILON_CM
    const touchesRight = Math.abs(rect.xCm + rect.widthCm - widthCm) <= GEOMETRY_EPSILON_CM
    const wall: Placement['wall'] = touchesTop
      ? 'top'
      : touchesBottom
        ? 'bottom'
        : touchesLeft
          ? 'left'
          : touchesRight
            ? 'right'
            : 'center'
    const placementId = `${entry.item.id}-${placed.length}`
    const zone = operationZone(entry.item, rect, wall, placementId, entry.placement?.frontDirection)
    const insideBounds =
      rect.xCm >= -GEOMETRY_EPSILON_CM &&
      rect.yCm >= -GEOMETRY_EPSILON_CM &&
      rect.xCm + rect.widthCm <= widthCm + GEOMETRY_EPSILON_CM &&
      rect.yCm + rect.depthCm <= depthCm + GEOMETRY_EPSILON_CM
    const insideFloor = !floorPolygon || rectInsideFloor(rect, floorPolygon)
    const zoneInside =
      !zone ||
      (floorPolygon
        ? rectInsideFloor(zone, floorPolygon)
        : zone.xCm >= 0 &&
          zone.yCm >= 0 &&
          zone.xCm + zone.widthCm <= widthCm &&
          zone.yCm + zone.depthCm <= depthCm)
    if (!insideBounds || !insideFloor || !zoneInside) {
      problems.push({ kind: 'invalidPlacement', title: entry.item.title, reason: 'outside' })
      continue
    }
    const collision =
      placed.some((other) => overlaps(rect, other)) ||
      functionalZones.some((other) => overlaps(rect, other)) ||
      (zone !== null &&
        (placed.some((other) => overlaps(zone, other)) ||
          functionalZones.some((other) => overlaps(zone, other))))
    if (collision) {
      problems.push({ kind: 'invalidPlacement', title: entry.item.title, reason: 'collision' })
      continue
    }
    const blocked =
      clearanceRects.some((clearance) => overlaps(rect, clearance)) ||
      blockingFloorReservations.some(
        (reservation) =>
          reservationBlocksHeight(reservation, entry.size) &&
          rectBlocksFloorReservation(rect, reservation),
      ) ||
      keepClearZones.some((keepClear) => rectOverlapsPolygon(rect, keepClear.polygon)) ||
      (zone !== null &&
        (clearanceRects.some((clearance) => overlaps(zone, clearance)) ||
          keepClearZones.some((keepClear) => rectOverlapsPolygon(zone, keepClear.polygon))))
    if (blocked) {
      problems.push({ kind: 'invalidPlacement', title: entry.item.title, reason: 'blocked' })
      continue
    }
    placed.push({
      id: placementId,
      itemId: entry.item.id,
      title: entry.item.title,
      ...rect,
      wall,
    })
    if (zone) functionalZones.push(zone)
    if (wall !== 'center') {
      const inwardDepth = wall === 'top' || wall === 'bottom' ? rect.depthCm : rect.widthCm
      depths[wall] = Math.max(depths[wall], inwardDepth)
    }
  }

  const layOut = (wall: LayoutWall) => {
    const span = spanOf(wall, depths, { widthCm, depthCm })
    cursor[wall] = span.from
    for (const item of walls[wall].items) {
      // Места вдоль стены не осталось, либо предмет глубже самой комнаты: рисовать его
      // поверх стены нельзя, а молча выбросить — тем более. Такие предметы уходят
      // во второй заход, где им ищут место на любой стене
      if (
        cursor[wall] + item.size.widthCm > span.to + GEOMETRY_EPSILON_CM ||
        !put(wall, item, cursor[wall])
      ) {
        homeless.push(item)
      }
    }
  }

  for (const wall of ['top', 'bottom'] as const) {
    layOut(wall)
  }
  for (const wall of ['left', 'right'] as const) {
    layOut(wall)
  }

  /**
   * Второй заход для тех, кому не хватило назначенной стены.
   *
   * Сюда попадает всё, чему не хватило места при назначении или на назначенной стене. Стену
   * выбирают по её полной длине, а раскладка отдаёт боковым только промежуток между верхней
   * и нижней мебелью, и «не встаёт» получали предметы, которым место было: на переборе
   * случайных комнат так врал каждый шестой ответ. Здесь каждая стена просматривается целиком,
   * и только после этого отказ становится отказом.
   */
  const RETRY_STEP_CM = 5
  homeless.sort((a, b) => b.size.widthCm - a.size.widthCm)
  for (const item of homeless) {
    let standing = false
    for (const candidate of ['top', 'bottom', 'left', 'right'] as const) {
      // Во втором заходе стена просматривается целиком, от угла до угла: отступ под соседнюю
      // стену нужен первому проходу для опрятной расстановки, а здесь мы ищем любое место,
      // и от наложения защищает точная проверка прямоугольника
      const length = candidate === 'top' || candidate === 'bottom' ? widthCm : depthCm
      for (
        let along = 0;
        along + item.size.widthCm <= length + GEOMETRY_EPSILON_CM;
        along += RETRY_STEP_CM
      ) {
        if (put(candidate, item, along)) {
          standing = true
          break
        }
      }
      if (standing) {
        break
      }
    }
    if (!standing) {
      for (const edge of perimeterEdges) {
        for (
          let alongCm = edge.fromCm;
          alongCm + item.size.widthCm <= edge.toCm + GEOMETRY_EPSILON_CM;
          alongCm += RETRY_STEP_CM
        ) {
          if (putOnFloorEdge(edge, item, alongCm)) {
            standing = true
            break
          }
        }
        if (standing) break
      }
    }
    if (!standing) {
      problems.push({ kind: 'noWall', title: item.title, widthCm: item.size.widthCm })
    }
  }

  const freeLength = (
    fromCm: number,
    toCm: number,
    intervals: ReadonlyArray<readonly [number, number]>,
  ) => {
    const clipped = intervals
      .map(([from, to]) => [Math.max(from, fromCm), Math.min(to, toCm)] as const)
      .filter(([from, to]) => to > from)
      .sort((a, b) => a[0] - b[0])
    let occupiedCm = 0
    let endCm = fromCm
    for (const [from, to] of clipped) {
      if (to <= endCm) continue
      occupiedCm += to - Math.max(from, endCm)
      endCm = to
    }
    return Math.max(0, toCm - fromCm - occupiedCm)
  }

  if (floorPolygon) {
    for (const edge of perimeterEdges) {
      const openingIntervals = blockingFloorReservations.flatMap((reservation) => {
        if (edge.orientation === 'horizontal') {
          const sameLine =
            Math.abs(reservation.start.yCm - reservation.end.yCm) <= GEOMETRY_EPSILON_CM &&
            Math.abs(reservation.start.yCm - edge.fixedCm) <= GEOMETRY_EPSILON_CM
          return sameLine
            ? [
                [
                  Math.min(reservation.start.xCm, reservation.end.xCm),
                  Math.max(reservation.start.xCm, reservation.end.xCm),
                ] as const,
              ]
            : []
        }
        const sameLine =
          Math.abs(reservation.start.xCm - reservation.end.xCm) <= GEOMETRY_EPSILON_CM &&
          Math.abs(reservation.start.xCm - edge.fixedCm) <= GEOMETRY_EPSILON_CM
        return sameLine
          ? [
              [
                Math.min(reservation.start.yCm, reservation.end.yCm),
                Math.max(reservation.start.yCm, reservation.end.yCm),
              ] as const,
            ]
          : []
      })
      const furnitureIntervals = placed.flatMap((place) => {
        if (edge.orientation === 'horizontal') {
          const touches =
            Math.abs(place.yCm - edge.fixedCm) <= GEOMETRY_EPSILON_CM ||
            Math.abs(place.yCm + place.depthCm - edge.fixedCm) <= GEOMETRY_EPSILON_CM
          return touches ? [[place.xCm, place.xCm + place.widthCm] as const] : []
        }
        const touches =
          Math.abs(place.xCm - edge.fixedCm) <= GEOMETRY_EPSILON_CM ||
          Math.abs(place.xCm + place.widthCm - edge.fixedCm) <= GEOMETRY_EPSILON_CM
        return touches ? [[place.yCm, place.yCm + place.depthCm] as const] : []
      })
      freeWallCm += freeLength(edge.fromCm, edge.toCm, [...openingIntervals, ...furnitureIntervals])
    }
  } else {
    for (const wall of ['top', 'bottom', 'left', 'right'] as const) {
      const wallLength = wall === 'top' || wall === 'bottom' ? widthCm : depthCm
      const intervals = [
        ...reservations
          .filter((reservation) => reservation.wall === wall)
          .map((reservation) => [reservation.fromCm, reservation.toCm] as const),
        ...placed
          .filter((place) => place.wall === wall)
          .map((place) =>
            wall === 'top' || wall === 'bottom'
              ? ([place.xCm, place.xCm + place.widthCm] as const)
              : ([place.yCm, place.yCm + place.depthCm] as const),
          ),
      ]
      freeWallCm += freeLength(0, wallLength, intervals)
    }
  }

  const centerWidthCm = widthCm - depths.left - depths.right
  const centerDepthCm = depthCm - depths.top - depths.bottom

  const centerItems = sized
    .filter((entry) => !entry.placement && entry.spot === 'center')
    .sort((a, b) => b.size.widthCm - a.size.widthCm)

  // Предметы посередине встают в ряд слева направо, а не все в одну точку: иначе журнальный
  // столик оказывался внутри обеденного, и оба считались поместившимися
  let centerUsedCm = 0
  for (const entry of centerItems) {
    // Вокруг обеденного стола нужен отодвинутый стул, вокруг журнального — вытянутая рука.
    // Предмет ставится, только если его собственный запас помещается, поэтому отдельной
    // жалобы на тесноту вокруг него потом уже не нужно.
    const clearance = clearanceOf(entry)
    const needWidth = entry.size.widthCm + clearance * 2
    const needDepth = entry.size.depthCm + clearance * 2
    if (centerUsedCm + needWidth > centerWidthCm || needDepth > centerDepthCm) {
      problems.push({ kind: 'noCenter', title: entry.item.title })
      continue
    }
    const centerPlacement: Placement = {
      id: `${entry.item.id}-${placed.length}`,
      itemId: entry.item.id,
      title: entry.item.title,
      xCm: depths.left + centerUsedCm + clearance,
      yCm: depths.top + (centerDepthCm - entry.size.depthCm) / 2,
      widthCm: entry.size.widthCm,
      depthCm: entry.size.depthCm,
      wall: 'center',
    }
    const zone = operationZone(entry.item, centerPlacement, 'center', centerPlacement.id)
    if (
      clearanceRects.some((clearanceRect) => overlaps(centerPlacement, clearanceRect)) ||
      keepClearZones.some((zone) => rectOverlapsPolygon(centerPlacement, zone.polygon))
    ) {
      problems.push({ kind: 'noCenter', title: entry.item.title })
      continue
    }
    if (floorPolygon && !rectInsideFloor(centerPlacement, floorPolygon)) {
      problems.push({ kind: 'noCenter', title: entry.item.title })
      continue
    }
    if (
      zone &&
      ((floorPolygon
        ? !rectInsideFloor(zone, floorPolygon)
        : zone.xCm < 0 ||
          zone.yCm < 0 ||
          zone.xCm + zone.widthCm > widthCm ||
          zone.yCm + zone.depthCm > depthCm) ||
        placed.some((other) => overlaps(zone, other)) ||
        functionalZones.some((other) => overlaps(zone, other)) ||
        clearanceRects.some((clearance) => overlaps(zone, clearance)) ||
        keepClearZones.some((keepClear) => rectOverlapsPolygon(zone, keepClear.polygon)))
    ) {
      problems.push({ kind: 'noCenter', title: entry.item.title })
      continue
    }
    placed.push(centerPlacement)
    if (zone) functionalZones.push(zone)
    centerUsedCm += needWidth
  }

  // Проход — это самое узкое место на маршруте, по которому можно обойти всю комнату,
  // а не просто расстояние между двумя стенками мебели
  const walkwayCm = widestRoute([...placed, ...functionalZones], { widthCm, depthCm }, floorPolygon)
  if (placed.length > 0 && walkwayCm < WALKWAY_CM) {
    problems.push({ kind: 'narrowWalkway', gapCm: walkwayCm })
  }

  return {
    widthCm,
    depthCm,
    ...(floorPolygon ? { floorPolygon } : {}),
    placed,
    freeWallCm: Math.round(freeWallCm),
    walkwayCm,
    problems,
    offFloor,
    unmeasured,
    reservations,
    floorReservations,
    keepClearZones,
    functionalZones,
    operationInputs: [
      ...new Map(operationInputs.map((entry) => [`${entry.id}-${entry.kind}`, entry])).values(),
    ],
    placementInputs: [...new Map(placementInputs.map((entry) => [entry.id, entry])).values()],
    missingSafetyData,
    reservationSource,
  }
}
