import { describe, expect, it } from 'vitest'
import { areaError, normalizeAreaInput, parseArea } from './area'

describe('normalizeAreaInput', () => {
  it('оставляет только цифры и один разделитель, всегда запятую', () => {
    expect(normalizeAreaInput('18.5')).toBe('18,5')
    expect(normalizeAreaInput('18 м²')).toBe('18')
    expect(normalizeAreaInput('18,5,7')).toBe('18,5')
    expect(normalizeAreaInput('abc')).toBe('')
  })

  it('не мешает набирать запятую: «18,» остаётся «18,»', () => {
    expect(normalizeAreaInput('18,')).toBe('18,')
    expect(normalizeAreaInput('18.')).toBe('18,')
  })

  it('обрезает лишние знаки после запятой и слишком длинную целую часть', () => {
    expect(normalizeAreaInput('18,55')).toBe('18,5')
    expect(normalizeAreaInput('123456')).toBe('1234')
  })

  it('прогон второй раз ничего не меняет', () => {
    for (const raw of ['', '18', '18,', '18,5', '1234,5']) {
      expect(normalizeAreaInput(normalizeAreaInput(raw))).toBe(normalizeAreaInput(raw))
    }
  })
})

describe('parseArea', () => {
  it('читает и точку, и запятую', () => {
    expect(parseArea('18,5')).toBe(18.5)
    expect(parseArea('18.5')).toBe(18.5)
    expect(parseArea(' 18 ')).toBe(18)
  })

  it('пустое поле это не ошибка, а отсутствие площади', () => {
    expect(parseArea('')).toBeNull()
    expect(parseArea('   ')).toBeNull()
  })

  it('ноль, мусор и площадь больше двух тысяч метров не проходят', () => {
    expect(parseArea('0')).toBeNull()
    expect(parseArea('-5')).toBeNull()
    expect(parseArea(',')).toBeNull()
    expect(parseArea('2000')).toBe(2000)
    expect(parseArea('2000,1')).toBeNull()
  })
})

describe('areaError', () => {
  it('молчит на пустом и на нормальном числе', () => {
    expect(areaError('')).toBeUndefined()
    expect(areaError('18,5')).toBeUndefined()
  })

  it('говорит про потолок, когда число не годится', () => {
    expect(areaError('0')).toBeDefined()
    expect(areaError('9999')).toBeDefined()
  })
})
