import type { CatalogCategory } from '@uyut/db'
import type { DimensionsCm } from './dimensions'
import { parseWallReservations, type WallReservation } from './openings'
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
  /** Предметы без размеров: их разместить не из чего, пока размеры не появятся */
  unmeasured: Array<{ id: string; title: string }>
  /** Проёмы и инженерные зоны, уверенно извлечённые из описания комнаты */
  reservations: WallReservation[]
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
  const { width, depth } = dimensions
  if (!width || !depth) {
    return null
  }
  // Раскладка отвечает не только за длину вдоль стены, но и за выступ в комнату. Поэтому
  // частичный размер здесь хуже отсутствующего: выдуманная глубина создаёт ложный проход.
  return { widthCm: width, depthCm: depth }
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
function widestRoute(placed: readonly Placement[], room: Size): number {
  const step = Math.max(
    GRID_CM,
    Math.ceil(Math.sqrt((room.widthCm * room.depthCm) / GRID_CELLS) / GRID_CM) * GRID_CM,
  )
  const cols = Math.max(1, Math.floor(room.widthCm / step))
  const rows = Math.max(1, Math.floor(room.depthCm / step))
  const busy = new Uint8Array(cols * rows)
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
  room: { widthCm?: number; depthCm?: number; layoutNotes?: string | null },
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
      reservations: [],
    }
  }

  const offFloor: string[] = []
  const unmeasured: Array<{ id: string; title: string }> = []
  const problems: LayoutProblem[] = []
  const placed: Placement[] = []
  const reservations = parseWallReservations(room.layoutNotes, { widthCm, depthCm })

  type Rect = { xCm: number; yCm: number; widthCm: number; depthCm: number }
  const overlaps = (a: Rect, b: Rect) =>
    a.xCm < b.xCm + b.widthCm - 0.5 &&
    b.xCm < a.xCm + a.widthCm - 0.5 &&
    a.yCm < b.yCm + b.depthCm - 0.5 &&
    b.yCm < a.yCm + a.depthCm - 0.5
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

  type Homeless = { id: string; title: string; size: Size }
  const homeless: Homeless[] = []

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
    const insideRoom =
      at.xCm >= -0.5 &&
      at.yCm >= -0.5 &&
      at.xCm + size.widthCm <= widthCm + 0.5 &&
      at.yCm + size.depthCm <= depthCm + 0.5
    if (!insideRoom) {
      return false
    }
    const blocksWall = reservations.some(
      (reservation) =>
        reservation.wall === wall &&
        along < reservation.toCm - 0.5 &&
        reservation.fromCm < along + item.size.widthCm - 0.5,
    )
    const collides = placed.some((other) => overlaps(rect, other))
    const blocksAccess = clearanceRects.some((clearance) => overlaps(rect, clearance))
    if (blocksWall || collides || blocksAccess) {
      return false
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
    cursor[wall] = Math.max(cursor[wall], along + item.size.widthCm)
    depths[wall] = Math.max(depths[wall], item.size.depthCm)
    return true
  }

  const layOut = (wall: LayoutWall) => {
    const span = spanOf(wall, depths, { widthCm, depthCm })
    cursor[wall] = span.from
    for (const item of walls[wall].items) {
      // Места вдоль стены не осталось, либо предмет глубже самой комнаты: рисовать его
      // поверх стены нельзя, а молча выбросить — тем более. Такие предметы уходят
      // во второй заход, где им ищут место на любой стене
      if (cursor[wall] + item.size.widthCm > span.to + 0.5 || !put(wall, item, cursor[wall])) {
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
      for (let along = 0; along + item.size.widthCm <= length + 0.5; along += RETRY_STEP_CM) {
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
      problems.push({ kind: 'noWall', title: item.title, widthCm: item.size.widthCm })
    }
  }

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
    ].sort((a, b) => a[0] - b[0])
    let occupiedCm = 0
    let endCm = 0
    for (const [from, to] of intervals) {
      if (to <= endCm) continue
      occupiedCm += to - Math.max(from, endCm)
      endCm = to
    }
    freeWallCm += Math.max(0, wallLength - occupiedCm)
  }

  const centerWidthCm = widthCm - depths.left - depths.right
  const centerDepthCm = depthCm - depths.top - depths.bottom

  const centerItems = sized
    .filter((entry) => entry.spot === 'center')
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
      title: entry.item.title,
      xCm: depths.left + centerUsedCm + clearance,
      yCm: depths.top + (centerDepthCm - entry.size.depthCm) / 2,
      widthCm: entry.size.widthCm,
      depthCm: entry.size.depthCm,
      wall: 'center',
    }
    if (clearanceRects.some((clearanceRect) => overlaps(centerPlacement, clearanceRect))) {
      problems.push({ kind: 'noCenter', title: entry.item.title })
      continue
    }
    placed.push(centerPlacement)
    centerUsedCm += needWidth
  }

  // Проход — это самое узкое место на маршруте, по которому можно обойти всю комнату,
  // а не просто расстояние между двумя стенками мебели
  const walkwayCm = widestRoute(placed, { widthCm, depthCm })
  if (placed.length > 0 && walkwayCm < WALKWAY_CM) {
    problems.push({ kind: 'narrowWalkway', gapCm: walkwayCm })
  }

  return {
    widthCm,
    depthCm,
    placed,
    freeWallCm: Math.round(freeWallCm),
    walkwayCm,
    problems,
    offFloor,
    unmeasured,
    reservations,
  }
}
