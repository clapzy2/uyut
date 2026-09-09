import { describe, expect, it } from 'vitest'
import { type MarkerBox, spreadMarkers } from './marker-layout'

const gap = (points: Array<{ x: number; y: number }>): number => {
  let smallest = Number.POSITIVE_INFINITY
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const left = points[i] as { x: number; y: number }
      const right = points[j] as { x: number; y: number }
      smallest = Math.min(smallest, Math.hypot(right.x - left.x, right.y - left.y))
    }
  }
  return smallest
}

describe('расстановка номерных меток', () => {
  it('далёкие предметы остаются на своих местах', () => {
    const boxes: MarkerBox[] = [
      { id: 'a', x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
      { id: 'b', x: 0.6, y: 0.6, w: 0.2, h: 0.2 },
    ]
    expect(spreadMarkers(boxes)).toEqual([
      { id: 'a', x: 0.2, y: 0.2 },
      { id: 'b', x: 0.7, y: 0.7 },
    ])
  })

  it('слипшиеся расходятся: кресло и тумба под столом стоят вплотную', () => {
    const boxes: MarkerBox[] = [
      { id: 'кресло', x: 0.5, y: 0.5, w: 0.1, h: 0.1 },
      { id: 'тумба', x: 0.51, y: 0.51, w: 0.1, h: 0.1 },
    ]
    expect(gap(spreadMarkers(boxes))).toBeGreaterThan(0.05)
  })

  it('совпавшие точь-в-точь тоже расходятся, а не делятся на ноль', () => {
    const boxes: MarkerBox[] = [
      { id: 'a', x: 0.4, y: 0.4, w: 0.2, h: 0.2 },
      { id: 'b', x: 0.4, y: 0.4, w: 0.2, h: 0.2 },
    ]
    const points = spreadMarkers(boxes)
    expect(points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true)
    expect(gap(points)).toBeGreaterThan(0.05)
  })

  it('метки не уезжают за край картинки', () => {
    const boxes: MarkerBox[] = Array.from({ length: 6 }, (_, index) => ({
      id: `предмет-${index}`,
      x: 0.9,
      y: 0.9,
      w: 0.08,
      h: 0.08,
    }))
    for (const point of spreadMarkers(boxes)) {
      expect(point.x).toBeGreaterThanOrEqual(0.04)
      expect(point.x).toBeLessThanOrEqual(0.96)
      expect(point.y).toBeGreaterThanOrEqual(0.04)
      expect(point.y).toBeLessThanOrEqual(0.96)
    }
  })

  it('порядок сохраняется: номер метки должен совпадать с номером предмета', () => {
    const boxes: MarkerBox[] = [
      { id: 'первый', x: 0.5, y: 0.5, w: 0.1, h: 0.1 },
      { id: 'второй', x: 0.5, y: 0.5, w: 0.1, h: 0.1 },
      { id: 'третий', x: 0.1, y: 0.1, w: 0.1, h: 0.1 },
    ]
    expect(spreadMarkers(boxes).map((point) => point.id)).toEqual(['первый', 'второй', 'третий'])
  })
})
