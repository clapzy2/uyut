import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VOLUME_TILT,
  volumeOrbit,
  volumeProjector,
  volumeViewBox,
} from './plan-volume-camera'

describe('камера объёмного просмотра', () => {
  it('не искажает пространственную длину при произвольном повороте и наклоне', () => {
    for (const angle of [0, 37, 90, 183, 270, 360]) {
      for (const tilt of [15, DEFAULT_VOLUME_TILT, 80]) {
        const point = volumeProjector(angle, tilt)({ xCm: 73, yCm: 121 }, 85)
        expect(Math.hypot(point.x, point.y, point.depth)).toBeCloseTo(Math.hypot(73, 121, 85), 9)
      }
    }
  })
  it('сохраняет исходные изометрические пропорции и одинаковый масштаб во всех осях', () => {
    const project = volumeProjector(0, DEFAULT_VOLUME_TILT)
    const x = project({ xCm: 100, yCm: 0 })
    const y = project({ xCm: 0, yCm: 100 })
    const z = project({ xCm: 0, yCm: 0 }, 100)
    expect(x.x).toBeCloseTo(-y.x, 9)
    expect(x.y).toBeCloseTo(y.y, 9)
    expect(Math.hypot(x.x, x.y)).toBeCloseTo(Math.abs(z.y), 9)
    expect(x.x / x.y).toBeCloseTo(Math.sqrt(3), 9)
  })
  it('поворот на полный круг возвращает те же координаты без изменения исходника', () => {
    const point = { xCm: 73, yCm: 121 }
    const before = structuredClone(point)
    const first = volumeProjector(0, 50)(point, 80)
    const full = volumeProjector(360, 50)(point, 80)
    expect(full.x).toBeCloseTo(first.x, 9)
    expect(full.y).toBeCloseTo(first.y, 9)
    expect(point).toEqual(before)
  })
  it('ограничивает наклон при перетаскивании и корректно оборачивает поворот', () => {
    expect(volumeOrbit(350, 35, 100, -1000)).toEqual({ angle: 30, tilt: 80 })
    expect(volumeOrbit(10, 35, -100, 1000)).toEqual({ angle: 330, tilt: 15 })
  })
  it('приближает относительно центра, не масштабируя мировые координаты', () => {
    const points = [
      { x: 0, y: 10, depth: 0 },
      { x: 200, y: 110, depth: 0 },
    ]
    const [x1, y1, w1, h1] = volumeViewBox(points, 1).split(' ').map(Number)
    const [x2, y2, w2, h2] = volumeViewBox(points, 2).split(' ').map(Number)
    if (
      x1 === undefined ||
      y1 === undefined ||
      w1 === undefined ||
      h1 === undefined ||
      x2 === undefined ||
      y2 === undefined ||
      w2 === undefined ||
      h2 === undefined
    )
      throw new Error('Incomplete view box')
    expect(w2).toBe(w1 / 2)
    expect(h2).toBe(h1 / 2)
    expect(x2 + w2 / 2).toBeCloseTo(x1 + w1 / 2)
    expect(y2 + h2 / 2).toBeCloseTo(y1 + h1 / 2)
  })
})
