// Площадь набирают в полях руками, и одни и те же цифры приходят то с точкой, то с запятой,
// то с лишним мусором из буфера. Разбор живёт здесь, чтобы форма и диалоги считали одинаково.

/** Тот же потолок, что в areaSchema: больше двух тысяч метров это уже не квартира */
const MAX_AREA_M2 = 2000

/**
 * Приводит набранное к виду «1234,5»: только цифры, одна запятая, один знак после неё.
 * Промежуточные состояния вроде «18,» остаются как есть, иначе запятую нельзя было бы набрать.
 */
export function normalizeAreaInput(raw: string): string {
  const digitsAndCommas = raw.replace(/[^\d.,]/g, '').replace(/\./g, ',')
  const [whole = '', ...tail] = digitsAndCommas.split(',')
  const head = whole.slice(0, 4)
  if (tail.length === 0) {
    return head
  }
  return `${head},${tail.join('').slice(0, 1)}`
}

/** Число из поля или null, если площадь пустая либо бессмысленная */
export function parseArea(raw: string): number | null {
  const normalized = raw.trim().replace(',', '.')
  if (normalized === '') {
    return null
  }
  const number = Number(normalized)
  if (!Number.isFinite(number) || number <= 0 || number > MAX_AREA_M2) {
    return null
  }
  return Math.round(number * 100) / 100
}

/** Подпись под полем: пустая площадь это норма, а вот «0» или «5000» человек должен увидеть */
export function areaError(raw: string): string | undefined {
  if (raw.trim() === '' || parseArea(raw) !== null) {
    return undefined
  }
  return `Введите число не больше ${MAX_AREA_M2}`
}

/**
 * Правка поля на месте для форм на react-hook-form. Значение переписываем, только если маска
 * и правда что-то изменила: присвоение value уносит курсор в конец строки.
 */
export function applyAreaMask(field: HTMLInputElement): void {
  const next = normalizeAreaInput(field.value)
  if (next !== field.value) {
    field.value = next
  }
}
