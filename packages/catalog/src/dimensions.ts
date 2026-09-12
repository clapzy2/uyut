/** Габариты предмета в сантиметрах. Любое поле может отсутствовать. */
export type DimensionsCm = { width?: number; depth?: number; height?: number }

/** Разумные границы для мебели в сантиметрах: снизу отсекают мусор, сверху — опечатки. */
const MIN_CM = 15
const MAX_CM = 400

/**
 * Больше этого в сантиметрах мебели не бывает, значит число записано в миллиметрах.
 * Порог взят с запасом от MAX_CM: угловой диван в 400 см существует, в 401 см — нет.
 */
const LOOKS_LIKE_MM = 401

// Числа с разделителем: «1300×850×750 мм», «120х60х75», «200 x 300 см».
// Ровно четыре цифры максимум, и перед числом не должно быть цифры или точки,
// иначе разбор начинается с середины числа: у «2042×946×700» так получалась ширина 42.
const TRIPLE = /(?<![\d.,])(\d{2,4})\s*[х×x*]\s*(\d{2,4})\s*[х×x*]\s*(\d{2,4})\s*(мм|см|mm|cm)?/gi
const PAIR = /(?<![\d.,])(\d{2,4})\s*[х×x*]\s*(\d{2,4})\s*(мм|см|mm|cm)/gi

/**
 * Размеры, которые описывают не сам предмет. «Диван, спальное место 1100×1920» — это
 * размер в разложенном виде, а не то, сколько места диван займёт у стены. Для проверки «влезет ли»
 * такое число вреднее пустого поля.
 */
const NOT_THE_OBJECT =
  /(спальное место|спальная поверхность|матрас|упаковк|в упаковке|короб|ниша|ниши|внутренн)[^.;]{0,30}$/i

/**
 * То же самое для кровати. У неё спальное место и есть габарит: рама шире сантиметров
 * на пять, и это ближе к правде, чем пустое поле. У дивана наоборот — там спальное место
 * меряется в разложенном виде и к месту у стены отношения не имеет.
 *
 * Замер на боевом каталоге: из 301 кровати размеры были у 127. Остальные подписаны
 * «спальное место 1600×2000 мм», и мы их выбрасывали.
 */
const NOT_THE_BED = /(упаковк|в упаковке|короб|ниша|ниши|внутренн)[^.;]{0,30}$/i

/** Первое совпадение, перед которым не стоит оговорки вроде «спальное место». */
function firstAboutTheObject(
  text: string,
  pattern: RegExp,
  skip: RegExp = NOT_THE_OBJECT,
): RegExpExecArray | null {
  pattern.lastIndex = 0
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (!skip.test(text.slice(0, match.index))) {
      return match
    }
  }
  return null
}

function unitDivisor(unit: string | undefined, values: number[]): number {
  const normalized = unit?.toLowerCase()
  if (normalized === 'мм' || normalized === 'mm') {
    return 10
  }
  if (normalized === 'см' || normalized === 'cm') {
    return 1
  }
  // Единицу не написали: судим по самому числу. «2042×946×700» это миллиметры,
  // как бы ни хотелось прочитать их сантиметрами.
  return values.some((value) => value >= LOOKS_LIKE_MM) ? 10 : 1
}

function sane(value: number, divisor: number): number | undefined {
  const cm = Math.round(value / divisor)
  return cm >= MIN_CM && cm <= MAX_CM ? cm : undefined
}

/**
 * Габариты из названия или описания товара.
 *
 * Магазины пишут размеры и в сантиметрах, и в миллиметрах, и без единиц вовсе. Прежний разбор
 * знал только сантиметры и брал не больше трёх цифр, поэтому «Кровать, 2042×946×700 мм»
 * превращалась в кровать шириной 42 см. По замеру на боевом каталоге такой мусор составлял
 * седьмую часть всех распознанных размеров, и это хуже, чем отсутствие размера: на пустое поле
 * можно не полагаться, а неверному числу веришь.
 */
export type ParseOptions = {
  /** Спальное место считать габаритом: верно для кровати и матраса, неверно для дивана */
  sleepingIsFootprint?: boolean
}

export function parseDimensionsCm(text: string, options: ParseOptions = {}): DimensionsCm {
  const skip = options.sleepingIsFootprint ? NOT_THE_BED : NOT_THE_OBJECT
  const triple = firstAboutTheObject(text, TRIPLE, skip)
  if (triple) {
    const values = [Number(triple[1]), Number(triple[2]), Number(triple[3])]
    const divisor = unitDivisor(triple[4], values)
    const [width, depth, height] = values.map((value) => sane(value, divisor))
    return { width, depth, height }
  }
  const pair = firstAboutTheObject(text, PAIR, skip)
  if (pair) {
    const values = [Number(pair[1]), Number(pair[2])]
    const divisor = unitDivisor(pair[3], values)
    const [width, depth] = values.map((value) => sane(value, divisor))
    return { width, depth }
  }
  return {}
}

/** Есть ли хоть один размер: пустой объект в базу писать незачем. */
export function hasAnyDimension(dimensions: DimensionsCm): boolean {
  return (
    dimensions.width !== undefined ||
    dimensions.depth !== undefined ||
    dimensions.height !== undefined
  )
}
