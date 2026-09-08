// Телефон уходит в PDF, и мастеру приятнее видеть его в привычном виде. Человек набирает
// цифры, а скобки и дефисы расставляются сами.

const NATIONAL_DIGITS = 10

/**
 * Оставляет от набранного только цифры и приводит их к российским одиннадцати:
 * ведущая восьмёрка становится семёркой, номер без кода страны её получает.
 */
function nationalDigits(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits === '') {
    return ''
  }
  const first = digits[0]
  const rest = first === '7' || first === '8' ? digits.slice(1) : digits
  return rest.slice(0, NATIONAL_DIGITS)
}

/**
 * «+7 (999) 123-45-67» из чего угодно: «8 900 0000000», «79000000000», «+7 900 000-00-00»
 * дают один и тот же результат. Пустое остаётся пустым — телефон необязательный.
 *
 * Разделители дописываются только перед следующей цифрой, поэтому backspace всегда стирает
 * ровно одну цифру и не упирается в хвост из скобки с пробелом.
 */
export function formatPhoneInput(raw: string): string {
  const digits = nationalDigits(raw)
  if (raw.replace(/\D/g, '') === '') {
    return ''
  }
  let result = '+7'
  if (digits.length > 0) {
    result += ` (${digits.slice(0, 3)}`
  }
  if (digits.length > 3) {
    result += `) ${digits.slice(3, 6)}`
  }
  if (digits.length > 6) {
    result += `-${digits.slice(6, 8)}`
  }
  if (digits.length > 8) {
    result += `-${digits.slice(8, 10)}`
  }
  return result
}
