import type { DimensionsCm } from './dimensions'

export type RoomSpot = { name: string; widthCm: number }

/**
 * Влезет ли предмет хоть в один промеренный участок стены.
 *
 * `fits` — влезает; `tight` — влезает впритык, и это стоит сказать вслух; `tooWide` —
 * не встанет никуда; `unknown` — не хватает чисел, и тогда лучше молчать, чем угадывать.
 */
export type FitVerdict = {
  state: 'fits' | 'tight' | 'tooWide' | 'tooTall' | 'unknown'
  /** Почему нельзя дать положительный ответ. Нужна интерфейсу, чтобы не прятать неопределённость. */
  reason?: 'itemDimensions' | 'roomDimensions' | 'wallMeasurements'
  /** Участок, о котором идёт речь: самый широкий из промеренных */
  spot?: RoomSpot
  itemCm?: number
  /** Насколько шире или выше, в сантиметрах: для tooWide и tooTall */
  overCm?: number
  /** Высота потолка, с которой сравнивали: только для tooTall */
  ceilingCm?: number
  /** Фактическое расстояние до потолка, если корпус проходит по высоте впритык. */
  ceilingGapCm?: number
}

/** Меньше этого запаса встаёт впритык: плинтус, обои и открывание дверец съедают сантиметры. */
const TIGHT_CM = 5

/** Известная большая сторона основания. Высота не занимает место вдоль стены. */
export function footprintCm(dimensions: DimensionsCm | undefined): number | undefined {
  const sides = [dimensions?.width, dimensions?.depth].filter(
    (side): side is number => typeof side === 'number' && Number.isFinite(side) && side > 0,
  )
  return sides.length ? Math.max(...sides) : undefined
}

/** Высота проверяется независимо от того, известны ли стороны основания. */
export function heightCm(dimensions: DimensionsCm | undefined): number | undefined {
  const height = dimensions?.height
  return height !== undefined && Number.isFinite(height) && height > 0 ? height : undefined
}

/**
 * Всё, что известно о комнате в сантиметрах.
 *
 * Участки меряют рулеткой, коробку читают с плана. Это разные по силе числа: участок говорит
 * и «встанет», и «не встанет», а коробка — только «не встанет», потому что вдоль стены
 * обычно есть дверь, батарея или угол, и всей её длины под шкаф нет.
 */
export type RoomLimits = {
  /** Existing room measurements cannot prove fit in a separately selected proposed contour. */
  projectedContour?: { version: 1 }
  spots?: readonly RoomSpot[]
  ceilingCm?: number
  /** Стороны комнаты с плана */
  widthCm?: number
  depthCm?: number
}

/** Самая длинная стена комнаты: предмет шире неё не встанет ни при какой расстановке. */
const LONGEST_WALL = 'самая длинная стена'

export function checkFit(dimensions: DimensionsCm | undefined, limits: RoomLimits): FitVerdict {
  if (limits.projectedContour) return { state: 'unknown', reason: 'roomDimensions' }
  const { ceilingCm } = limits
  const tall = heightCm(dimensions)
  const gap = ceilingCm && ceilingCm > 0 && tall !== undefined ? ceilingCm - tall : undefined
  if (gap !== undefined && gap < 0) {
    return {
      state: 'tooTall',
      itemCm: footprintCm(dimensions),
      ceilingCm,
      overCm: -gap,
    }
  }
  const verdict = checkWallLength(dimensions, limits)
  return gap !== undefined && gap <= TIGHT_CM ? { ...verdict, ceilingGapCm: gap } : verdict
}

function checkWallLength(dimensions: DimensionsCm | undefined, limits: RoomLimits): FitVerdict {
  const measured = (limits.spots ?? []).filter((spot) => spot.widthCm > 0)
  // Для установки фасадом вдоль выбранного простенка сравниваем именно ширину.
  const itemCm = measured.length ? dimensions?.width : footprintCm(dimensions)
  if (itemCm === undefined || !Number.isFinite(itemCm) || itemCm <= 0) {
    return { state: 'unknown', reason: 'itemDimensions' }
  }
  const fullFootprint = Boolean(dimensions?.width && dimensions.depth)
  if (measured.length === 0) {
    // Только коробка комнаты: утверждать «встанет» не из чего, а «не встанет» — точно.
    const sides = [limits.widthCm, limits.depthCm].filter(
      (side): side is number => typeof side === 'number' && Number.isFinite(side) && side > 0,
    )
    const longest = sides.length === 2 ? Math.max(...sides) : undefined
    if (longest !== undefined && itemCm > longest) {
      return {
        state: 'tooWide',
        spot: { name: LONGEST_WALL, widthCm: longest },
        itemCm,
        overCm: itemCm - longest,
      }
    }
    return {
      state: 'unknown',
      reason: longest === undefined ? 'roomDimensions' : 'wallMeasurements',
      itemCm,
    }
  }
  const widest = measured.reduce((best, spot) => (spot.widthCm > best.widthCm ? spot : best))
  if (itemCm > widest.widthCm) {
    return { state: 'tooWide', spot: widest, itemCm, overCm: itemCm - widest.widthCm }
  }
  // Одной стороны достаточно, чтобы доказать «не встанет», но недостаточно для положительного
  // ответа: неизвестная глубина может перекрыть проход или упереться в мебель напротив.
  if (!fullFootprint) {
    return { state: 'unknown', reason: 'itemDimensions', itemCm }
  }
  return {
    state: widest.widthCm - itemCm < TIGHT_CM ? 'tight' : 'fits',
    spot: widest,
    itemCm,
  }
}
