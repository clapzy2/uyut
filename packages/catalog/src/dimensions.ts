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
// Не начинаем с середины числа или десятичной дроби. Запятая между словами
// и первым размером допустима даже без пробела: «3 ящика,1200×450×760 мм».
const TRIPLE =
  /(?<!\d)(?<!\d[.,])(\d{2,4}(?:[.,]\d+)?)\s*[х×x*]\s*(\d{2,4}(?:[.,]\d+)?)\s*[х×x*]\s*(\d{2,4}(?:[.,]\d+)?)(?!\d)\s*(мм|см|mm|cm)?/gi
const PAIR =
  /(?<!\d)(?<!\d[.,])(\d{2,4}(?:[.,]\d+)?)\s*[х×x*]\s*(\d{2,4}(?:[.,]\d+)?)\s*(мм|см|mm|cm)/gi
const NAMED_AXIS =
  /(?<![\p{L}\p{N}_])(ширина|глубина|высота)\s*\((мм|см|mm|cm)\)\s*:\s*(\d{2,4}(?:[.,]\d+)?)(?!\d|[.,]\d)/giu
const DIMENSION_SECTION =
  /(?:размеры|габариты)\s+(?:изделия|товара|дивана|кровати|предмета|упаковки|коробки|матраса|спального места|ниши)|упаковка|матрас|спальное место|спальная поверхность|внутренние (?:размеры|габариты)/giu
const BODY_SECTION = /^(?:размеры|габариты)\s+(?:изделия|товара|дивана|кровати|предмета)$/iu

/**
 * Размеры, которые описывают не сам предмет. «Диван, спальное место 1100×1920» — это
 * размер в разложенном виде, а не то, сколько места диван займёт у стены. Для проверки «влезет ли»
 * такое число вреднее пустого поля.
 */
const NOT_THE_OBJECT =
  /(спальное место|спальная поверхность|матрас|упаковк|в упаковке|короб|ниша|ниши|внутренн)[^.;]{0,30}$/i

/**
 * У товара, который сам является матрасом, его размеры описывают предмет.
 * У кровати размер матраса или спального места не доказывает наружный размер рамы.
 */
const NOT_THE_MATTRESS =
  /(спальное место|спальная поверхность|упаковк|в упаковке|короб|ниша|ниши|внутренн)[^.;]{0,30}$/i

/** Первое совпадение, перед которым не стоит оговорки вроде «спальное место». */
function firstAboutTheObject(
  text: string,
  pattern: RegExp,
  skip: RegExp = NOT_THE_OBJECT,
): RegExpExecArray | null {
  pattern.lastIndex = 0
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const prefix = text.slice(0, match.index)
    if (!skip.test(prefix) && !/[х×x*]\s*$/i.test(prefix)) {
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
  const cm = value / divisor
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
  /** @deprecated Sleeping sizes never prove an outer bed-frame footprint. */
  sleepingIsFootprint?: boolean
}

export function parseDimensionsCm(text: string, _options: ParseOptions = {}): DimensionsCm {
  const skip = /^матрас(?:\s|$)/iu.test(text.trim()) ? NOT_THE_MATTRESS : NOT_THE_OBJECT
  const named: DimensionsCm = {}
  const conflictingAxes = new Set<keyof DimensionsCm>()
  let hasNamedAxes = false
  let excludedSection = false
  let scannedUntil = 0
  let sectionStart = 0
  for (const match of text.matchAll(NAMED_AXIS)) {
    hasNamedAxes = true
    const preceding = text.slice(scannedUntil, match.index)
    for (const section of preceding.matchAll(DIMENSION_SECTION)) {
      excludedSection = !BODY_SECTION.test(section[0])
      sectionStart = scannedUntil + section.index + section[0].length
    }
    scannedUntil = match.index
    if (excludedSection || skip.test(text.slice(sectionStart, match.index))) continue
    const label = match[1]?.toLowerCase()
    const axis = label === 'ширина' ? 'width' : label === 'глубина' ? 'depth' : 'height'
    if (conflictingAxes.has(axis)) continue
    const value = Number(match[3]?.replace(',', '.'))
    const centimetres = sane(value, unitDivisor(match[2], [value]))
    if (centimetres === undefined || (named[axis] !== undefined && named[axis] !== centimetres)) {
      conflictingAxes.add(axis)
      delete named[axis]
      continue
    }
    named[axis] = centimetres
  }
  // An explicit but conflicting/excluded axis must never fall back to an unrelated tuple.
  if (hasNamedAxes) return named
  const triple = firstAboutTheObject(text, TRIPLE, skip)
  if (triple) {
    const values = [triple[1], triple[2], triple[3]].map((value) =>
      Number(value?.replace(',', '.')),
    )
    const divisor = unitDivisor(triple[4], values)
    const [width, depth, height] = values.map((value) => sane(value, divisor))
    return { width, depth, height }
  }
  const pair = firstAboutTheObject(text, PAIR, skip)
  if (pair) {
    const values = [pair[1], pair[2]].map((value) => Number(value?.replace(',', '.')))
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
