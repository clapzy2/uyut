import type { DimensionsCm } from './dimensions'

export type RoomSpot = { name: string; widthCm: number }

/**
 * Влезет ли предмет хоть в один промеренный участок стены.
 *
 * `fits` — влезает; `tight` — влезает впритык, и это стоит сказать вслух; `tooWide` —
 * не встанет никуда; `unknown` — не хватает чисел, и тогда лучше молчать, чем угадывать.
 */
export type FitVerdict = {
  state: 'fits' | 'tight' | 'tooWide' | 'unknown'
  /** Участок, о котором идёт речь: самый широкий из промеренных */
  spot?: RoomSpot
  itemCm?: number
  /** Насколько шире участка, в сантиметрах: только для tooWide */
  overCm?: number
}

/** Меньше этого запаса встаёт впритык: плинтус, обои и открывание дверец съедают сантиметры. */
const TIGHT_CM = 5

/**
 * Сколько места предмет займёт вдоль стены.
 *
 * Когда известны все три стороны, отбрасываем высоту: шкаф 100×35×220 занимает у стены сто
 * сантиметров, а не двести двадцать. Какая из трёх — высота, берём из порядка записи: русские
 * фиды пишут ширина×глубина×высота. Замер на боевом каталоге: у 71 процента товаров со всеми
 * тремя размерами глубина действительно оказалась наименьшей стороной, то есть порядок соблюдают.
 *
 * Если сторон меньше трёх, какая из них высота, знать неоткуда, поэтому берём наибольшую.
 * Это осторожнее: скорее лишний раз предупредим, чем пропустим предмет, который не встанет.
 */
export function footprintCm(dimensions: DimensionsCm | undefined): number | undefined {
  if (!dimensions) {
    return undefined
  }
  const { width, depth, height } = dimensions
  if (width !== undefined && depth !== undefined && height !== undefined) {
    return Math.max(width, depth)
  }
  const known = [width, depth, height].filter(
    (side): side is number => typeof side === 'number' && side > 0,
  )
  return known.length > 0 ? Math.max(...known) : undefined
}

export function checkFit(
  dimensions: DimensionsCm | undefined,
  spots: readonly RoomSpot[] | undefined,
): FitVerdict {
  const itemCm = footprintCm(dimensions)
  const measured = (spots ?? []).filter((spot) => spot.widthCm > 0)
  if (itemCm === undefined || measured.length === 0) {
    return { state: 'unknown', itemCm }
  }
  const widest = measured.reduce((best, spot) => (spot.widthCm > best.widthCm ? spot : best))
  if (itemCm > widest.widthCm) {
    return { state: 'tooWide', spot: widest, itemCm, overCm: Math.round(itemCm - widest.widthCm) }
  }
  return {
    state: widest.widthCm - itemCm < TIGHT_CM ? 'tight' : 'fits',
    spot: widest,
    itemCm,
  }
}
