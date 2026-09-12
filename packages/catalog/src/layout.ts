import type { CatalogCategory } from '@uyut/db'
import type { DimensionsCm } from './dimensions'
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
 * Чего план не знает и знать не может: где дверь, где окно, куда открываются створки.
 * Поэтому свободная стена показывается числом, а не выдаётся за запас.
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
  quantity: number
}

export type LayoutWall = 'top' | 'right' | 'bottom' | 'left'

export type Placement = {
  id: string
  title: string
  /** Сантиметры от левого верхнего угла комнаты */
  xCm: number
  yCm: number
  widthCm: number
  depthCm: number
  wall: LayoutWall | 'center'
}

export type LayoutProblem =
  | { kind: 'noWall'; title: string; widthCm: number }
  | { kind: 'noCenter'; title: string }
  | { kind: 'narrowWalkway'; gapCm: number }
  | { kind: 'noRoomSize' }

export type RoomLayout = {
  widthCm: number
  depthCm: number
  placed: Placement[]
  /** Свободная длина стен после расстановки, сантиметры */
  freeWallCm: number
  /** Самый узкий проход между расставленным, сантиметры */
  walkwayCm: number
  problems: LayoutProblem[]
  /** Предметы, которые пол не занимают: люстры, картины, текстиль */
  offFloor: string[]
  /** Предметы без размеров в карточке магазина: их разместить не из чего */
  unmeasured: string[]
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
function footprint(dimensions: DimensionsCm | null): { widthCm: number; depthCm: number } | null {
  if (!dimensions) {
    return null
  }
  const { width, depth, height } = dimensions
  if (width !== undefined && depth !== undefined && height !== undefined) {
    return { widthCm: Math.max(width, depth), depthCm: Math.min(width, depth) }
  }
  const known = [width, depth, height].filter(
    (side): side is number => typeof side === 'number' && side > 0,
  )
  if (known.length === 0) {
    return null
  }
  // Сторон меньше трёх: какая из них высота, знать неоткуда. Берём наибольшую за ширину
  // и считаем предмет квадратным в плане — это осторожнее, чем угадать в свою пользу.
  const side = Math.max(...known)
  return { widthCm: side, depthCm: Math.min(side, 60) }
}

type WallState = { wall: LayoutWall; lengthCm: number; usedCm: number; depthCm: number }

/** Угол предмета в координатах комнаты. widthCm и depthCm здесь уже развёрнуты по стене. */
function placeOnWall(
  state: WallState,
  size: { widthCm: number; depthCm: number },
  room: { widthCm: number; depthCm: number },
): { xCm: number; yCm: number } {
  const along = state.usedCm
  switch (state.wall) {
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
 * Разворот предмета по стене. В координатах комнаты widthCm — всегда протяжённость по горизонтали,
 * depthCm — по вертикали, поэтому у боковых стен стороны меняются местами.
 */
function sizeOnWall(
  wall: LayoutWall,
  size: { widthCm: number; depthCm: number },
): { widthCm: number; depthCm: number } {
  return wall === 'top' || wall === 'bottom'
    ? size
    : { widthCm: size.depthCm, depthCm: size.widthCm }
}

/**
 * Раскладывает мебель: крупное к стенам, стол посередине.
 *
 * Каждый предмет уходит на ту стену, где больше свободного места. Это не оптимальная упаковка
 * и не пытается ею быть: нам нужен ответ «влезает или нет», а не лучшая из возможных расстановок.
 */
export function layoutRoom(
  room: { widthCm?: number; depthCm?: number },
  items: readonly LayoutItem[],
): RoomLayout {
  const widthCm = room.widthCm ?? 0
  const depthCm = room.depthCm ?? 0
  const empty: RoomLayout = {
    widthCm,
    depthCm,
    placed: [],
    freeWallCm: 0,
    walkwayCm: 0,
    problems: [{ kind: 'noRoomSize' }],
    offFloor: [],
    unmeasured: [],
  }
  if (widthCm <= 0 || depthCm <= 0) {
    return empty
  }

  const offFloor: string[] = []
  const unmeasured: string[] = []
  const problems: LayoutProblem[] = []
  const placed: Placement[] = []

  type Sized = { item: LayoutItem; size: { widthCm: number; depthCm: number }; spot: Spot }
  const sized: Sized[] = []
  for (const item of items) {
    const spot = spotFor(item)
    if (spot === 'none') {
      offFloor.push(item.title)
      continue
    }
    const size = footprint(item.dimensions)
    if (!size) {
      unmeasured.push(item.title)
      continue
    }
    // Два одинаковых стула занимают пол дважды: количество разворачивается в отдельные предметы
    for (let copy = 0; copy < Math.max(1, item.quantity); copy += 1) {
      sized.push({ item, size, spot })
    }
  }

  const walls: WallState[] = [
    { wall: 'top', lengthCm: widthCm, usedCm: 0, depthCm: 0 },
    { wall: 'bottom', lengthCm: widthCm, usedCm: 0, depthCm: 0 },
    { wall: 'left', lengthCm: depthCm, usedCm: 0, depthCm: 0 },
    { wall: 'right', lengthCm: depthCm, usedCm: 0, depthCm: 0 },
  ]

  const wallItems = sized
    .filter((entry) => entry.spot === 'wall' || entry.spot === 'floorFree')
    .sort((a, b) => b.size.widthCm - a.size.widthCm)

  for (const entry of wallItems) {
    const roomy = walls
      .filter((wall) => wall.lengthCm - wall.usedCm >= entry.size.widthCm)
      .sort((a, b) => b.lengthCm - b.usedCm - (a.lengthCm - a.usedCm))[0]
    if (!roomy) {
      problems.push({ kind: 'noWall', title: entry.item.title, widthCm: entry.size.widthCm })
      continue
    }
    const size = sizeOnWall(roomy.wall, entry.size)
    const at = placeOnWall(roomy, size, { widthCm, depthCm })
    placed.push({
      id: `${entry.item.id}-${placed.length}`,
      title: entry.item.title,
      xCm: at.xCm,
      yCm: at.yCm,
      widthCm: size.widthCm,
      depthCm: size.depthCm,
      wall: roomy.wall,
    })
    roomy.usedCm += entry.size.widthCm
    roomy.depthCm = Math.max(roomy.depthCm, entry.size.depthCm)
  }

  const byWall = new Map(walls.map((wall) => [wall.wall, wall]))
  const freeLeft = byWall.get('left')?.depthCm ?? 0
  const freeRight = byWall.get('right')?.depthCm ?? 0
  const freeTop = byWall.get('top')?.depthCm ?? 0
  const freeBottom = byWall.get('bottom')?.depthCm ?? 0
  const centerWidthCm = widthCm - freeLeft - freeRight
  const centerDepthCm = depthCm - freeTop - freeBottom

  let walkwayCm = Math.min(centerWidthCm, centerDepthCm)

  const centerItems = sized
    .filter((entry) => entry.spot === 'center')
    .sort((a, b) => b.size.widthCm - a.size.widthCm)
  for (const entry of centerItems) {
    const clearance = entry.item.subcategory === 'dining' ? CHAIR_PULLOUT_CM : COFFEE_CLEARANCE_CM
    const needWidth = entry.size.widthCm + clearance * 2
    const needDepth = entry.size.depthCm + clearance * 2
    if (needWidth > centerWidthCm || needDepth > centerDepthCm) {
      problems.push({ kind: 'noCenter', title: entry.item.title })
      continue
    }
    placed.push({
      id: `${entry.item.id}-${placed.length}`,
      title: entry.item.title,
      xCm: freeLeft + (centerWidthCm - entry.size.widthCm) / 2,
      yCm: freeTop + (centerDepthCm - entry.size.depthCm) / 2,
      widthCm: entry.size.widthCm,
      depthCm: entry.size.depthCm,
      wall: 'center',
    })
    walkwayCm = Math.min(
      walkwayCm,
      (centerWidthCm - entry.size.widthCm) / 2,
      (centerDepthCm - entry.size.depthCm) / 2,
    )
  }

  const rounded = Math.max(0, Math.round(walkwayCm))
  if (placed.length > 0 && rounded < WALKWAY_CM) {
    problems.push({ kind: 'narrowWalkway', gapCm: rounded })
  }

  return {
    widthCm,
    depthCm,
    placed,
    freeWallCm: Math.round(walls.reduce((sum, wall) => sum + (wall.lengthCm - wall.usedCm), 0)),
    walkwayCm: rounded,
    problems,
    offFloor,
    unmeasured,
  }
}
