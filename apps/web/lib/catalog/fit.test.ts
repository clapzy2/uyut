import { checkFit, footprintCm } from '@uyut/catalog'
import { describe, expect, it } from 'vitest'

const spots = [
  { name: 'простенок под окном', widthCm: 140 },
  { name: 'стена слева', widthCm: 320 },
]

describe('footprintCm', () => {
  it('у шкафа вдоль стены ширина, а не высота', () => {
    expect(footprintCm({ width: 100, depth: 35, height: 220 })).toBe(100)
  })

  it('у дивана вдоль стены всё та же ширина', () => {
    expect(footprintCm({ width: 220, depth: 95, height: 85 })).toBe(220)
  })

  it('когда сторон меньше трёх, берём наибольшую: высоту отличить неоткуда', () => {
    expect(footprintCm({ width: 120, depth: 45 })).toBe(120)
    expect(footprintCm({ height: 180 })).toBe(180)
  })

  it('без размеров ответа нет', () => {
    expect(footprintCm(undefined)).toBeUndefined()
    expect(footprintCm({})).toBeUndefined()
  })
})

describe('checkFit', () => {
  it('молчим, когда нечего сравнивать', () => {
    expect(checkFit({ width: 120, depth: 45, height: 80 }, []).state).toBe('unknown')
    expect(checkFit(undefined, spots).state).toBe('unknown')
  })

  it('встаёт свободно', () => {
    expect(checkFit({ width: 120, depth: 45, height: 80 }, spots).state).toBe('fits')
  })

  it('не встаёт никуда и говорим насколько', () => {
    const verdict = checkFit({ width: 360, depth: 95, height: 85 }, spots)
    expect(verdict.state).toBe('tooWide')
    expect(verdict.overCm).toBe(40)
    expect(verdict.spot?.name).toBe('стена слева')
  })

  it('впритык это отдельный ответ', () => {
    expect(checkFit({ width: 318, depth: 60, height: 200 }, spots).state).toBe('tight')
  })

  it('сравниваем с самым широким участком, а не с первым в списке', () => {
    const verdict = checkFit({ width: 200, depth: 60, height: 80 }, spots)
    expect(verdict.state).toBe('fits')
    expect(verdict.spot?.widthCm).toBe(320)
  })
})
