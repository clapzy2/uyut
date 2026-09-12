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
    // Порядку сторон верим, а не берём наибольшую за ширину: у кровати 180×200 длинная сторона —
    // это глубина, она уходит в комнату, а вдоль стены встаёт изголовье в 180 см. На боевом
    // каталоге порядок соблюдают: у 71 процента товаров со всеми тремя размерами глубина
    // и правда оказалась наименьшей стороной.
    return { widthCm: width, depthCm: depth }
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

type Size = { widthCm: number; depthCm: number }

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
    : { widthCm: size.depthCm, depthCm: size.widthCm }
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
 * Углы отданы соседним стенам: угол комнаты принадлежит сразу двум, и без этого отступа шкаф
 * у левой стены и комод у верхней вставали в одну и ту же клетку. На картинке они наезжали друг
 * на друга, а в ответе стояло «всё помещается».
 */
function spanOf(
  wall: LayoutWall,
  depths: Record<LayoutWall, number>,
  room: Size,
): { from: number; to: number } {
  return wall === 'top' || wall === 'bottom'
    ? { from: depths.left, to: room.widthCm - depths.right }
    : { from: depths.top, to: room.depthCm - depths.bottom }
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

type Sized = { item: LayoutItem; size: Size; spot: Spot }

/**
 * Сколько места нужно вокруг предмета посреди комнаты. У обеденного стола это отодвинутый стул,
 * у журнального — вытянутая рука: требовать вокруг журнального столика проход в семьдесят
 * сантиметров бессмысленно, он для того и стоит вплотную к дивану.
 */
function clearanceOf(entry: Sized): number {
  return entry.item.subcategory === 'dining' ? CHAIR_PULLOUT_CM : COFFEE_CLEARANCE_CM
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
export function layoutRoom(
  room: { widthCm?: number; depthCm?: number },
  items: readonly LayoutItem[],
): RoomLayout {
  const widthCm = room.widthCm ?? 0
  const depthCm = room.depthCm ?? 0
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
    }
  }

  const offFloor: string[] = []
  const unmeasured: string[] = []
  const problems: LayoutProblem[] = []
  const placed: Placement[] = []

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

  const walls: Record<LayoutWall, WallState> = {
    top: { wall: 'top', lengthCm: widthCm, usedCm: 0, depthCm: 0, items: [] },
    bottom: { wall: 'bottom', lengthCm: widthCm, usedCm: 0, depthCm: 0, items: [] },
    left: { wall: 'left', lengthCm: depthCm, usedCm: 0, depthCm: 0, items: [] },
    right: { wall: 'right', lengthCm: depthCm, usedCm: 0, depthCm: 0, items: [] },
  }
  const order: LayoutWall[] = ['top', 'bottom', 'left', 'right']

  const wallItems = sized
    .filter((entry) => entry.spot === 'wall' || entry.spot === 'floorFree')
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
    if (!roomy) {
      problems.push({ kind: 'noWall', title: entry.item.title, widthCm: entry.size.widthCm })
      continue
    }
    roomy.items.push({ id: entry.item.id, title: entry.item.title, size: entry.size })
    roomy.usedCm += entry.size.widthCm
    roomy.depthCm = Math.max(roomy.depthCm, entry.size.depthCm)
  }

  const depths: Record<LayoutWall, number> = {
    top: walls.top.depthCm,
    bottom: walls.bottom.depthCm,
    left: walls.left.depthCm,
    right: walls.right.depthCm,
  }

  let freeWallCm = 0
  for (const wall of order) {
    const span = spanOf(wall, depths, { widthCm, depthCm })
    let along = span.from
    for (const item of walls[wall].items) {
      const size = sizeOnWall(wall, item.size)
      const at = cornerOf(wall, along, size, { widthCm, depthCm })
      const insideRoom =
        at.xCm >= -0.5 &&
        at.yCm >= -0.5 &&
        at.xCm + size.widthCm <= widthCm + 0.5 &&
        at.yCm + size.depthCm <= depthCm + 0.5
      // Угол соседней стены съел место, либо предмет глубже самой комнаты: рисовать его
      // поверх стены нельзя, а молча выбросить — тем более
      if (along + item.size.widthCm > span.to + 0.5 || !insideRoom) {
        problems.push({ kind: 'noWall', title: item.title, widthCm: item.size.widthCm })
        continue
      }
      placed.push({
        id: `${item.id}-${placed.length}`,
        title: item.title,
        xCm: at.xCm,
        yCm: at.yCm,
        widthCm: size.widthCm,
        depthCm: size.depthCm,
        wall,
      })
      along += item.size.widthCm
    }
    freeWallCm += Math.max(0, span.to - along)
  }

  const centerWidthCm = widthCm - depths.left - depths.right
  const centerDepthCm = depthCm - depths.top - depths.bottom

  const centerItems = sized
    .filter((entry) => entry.spot === 'center')
    .sort((a, b) => b.size.widthCm - a.size.widthCm)

  // Предметы посередине встают в ряд слева направо, а не все в одну точку: иначе журнальный
  // столик оказывался внутри обеденного, и оба считались поместившимися
  let centerUsedCm = 0
  let requiredCm = centerItems.length > 0 ? 0 : WALKWAY_CM
  let walkwayCm = Math.min(centerWidthCm, centerDepthCm)
  for (const entry of centerItems) {
    const clearance = clearanceOf(entry)
    const needWidth = entry.size.widthCm + clearance * 2
    const needDepth = entry.size.depthCm + clearance * 2
    if (centerUsedCm + needWidth > centerWidthCm || needDepth > centerDepthCm) {
      problems.push({ kind: 'noCenter', title: entry.item.title })
      continue
    }
    placed.push({
      id: `${entry.item.id}-${placed.length}`,
      title: entry.item.title,
      xCm: depths.left + centerUsedCm + clearance,
      yCm: depths.top + (centerDepthCm - entry.size.depthCm) / 2,
      widthCm: entry.size.widthCm,
      depthCm: entry.size.depthCm,
      wall: 'center',
    })
    centerUsedCm += needWidth
    // Проход меряем тем, что просит сам предмет: вокруг журнального столика сорок сантиметров —
    // это норма, а не теснота, и жаловаться на них было бы враньём
    requiredCm = Math.max(requiredCm, clearance)
    walkwayCm = Math.min(walkwayCm, (centerDepthCm - entry.size.depthCm) / 2)
  }

  const rounded = Math.max(0, Math.round(walkwayCm))
  if (placed.length > 0 && rounded < requiredCm) {
    problems.push({ kind: 'narrowWalkway', gapCm: rounded })
  }

  return {
    widthCm,
    depthCm,
    placed,
    freeWallCm: Math.round(freeWallCm),
    walkwayCm: rounded,
    problems,
    offFloor,
    unmeasured,
  }
}
