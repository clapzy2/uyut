import { describe, expect, it } from 'vitest'
import { formatPhoneInput } from './phone'

describe('formatPhoneInput', () => {
  it('собирает номер по мере набора цифр', () => {
    expect(formatPhoneInput('9')).toBe('+7 (9')
    expect(formatPhoneInput('900')).toBe('+7 (900')
    expect(formatPhoneInput('9001')).toBe('+7 (900) 1')
    expect(formatPhoneInput('9001234567')).toBe('+7 (900) 123-45-67')
  })

  it('любая запись одного номера даёт один и тот же вид', () => {
    const expected = '+7 (900) 000-00-00'
    expect(formatPhoneInput('+7 900 000-00-00')).toBe(expected)
    expect(formatPhoneInput('8 900 0000000')).toBe(expected)
    expect(formatPhoneInput('79000000000')).toBe(expected)
    expect(formatPhoneInput('9000000000')).toBe(expected)
  })

  it('пустое остаётся пустым: телефон необязательный', () => {
    expect(formatPhoneInput('')).toBe('')
    expect(formatPhoneInput('   ')).toBe('')
    expect(formatPhoneInput('+')).toBe('')
  })

  it('backspace стирает ровно одну цифру и не упирается в хвост', () => {
    let value = formatPhoneInput('9001234567')
    const seen = [value]
    while (value !== '') {
      value = formatPhoneInput(value.slice(0, -1))
      seen.push(value)
    }
    // Одиннадцать цифр, значит одиннадцать шагов до пустого поля
    expect(seen.length).toBe(12)
    expect(seen[1]).toBe('+7 (900) 123-45-6')
    expect(seen).toContain('+7 (900')
    expect(seen.at(-2)).toBe('+7')
  })

  it('лишние цифры из буфера отбрасываются', () => {
    expect(formatPhoneInput('790012345678888')).toBe('+7 (900) 123-45-67')
  })
})
