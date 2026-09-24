import { planPolygonAreaM2 } from '@uyut/ai'
import type { PlanImageCalibration, PlanPoint, PlanRoomShape } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import { inspectPlanGeometry, inspectPlanRoomAreas } from './plan-geometry-inspection'
import { planImageMatrix } from './plan-image-calibration'

// Ручная разметка локального снимка plans/Снимок экрана 2026-09-12 174014.png.
// Это benchmark растра, а не обмер и не схема для пользовательского проекта.
const calibration: PlanImageCalibration = {
  imageWidthPx: 903,
  imageHeightPx: 847,
  pixelStart: { x: 458, y: 94 },
  pixelEnd: { x: 812, y: 94 },
  worldStart: { xCm: 400, yCm: 90 },
  lengthCm: 303.9,
  direction: 'right',
}

const labelledRooms = [
  {
    name: 'Санузел',
    areaM2: 2.7,
    pixels: [
      [104, 301],
      [278, 301],
      [278, 516],
      [104, 516],
    ],
  },
  {
    name: 'Кухня',
    areaM2: 5.4,
    pixels: [
      [104, 516],
      [442, 516],
      [442, 742],
      [104, 742],
    ],
  },
  {
    name: 'Гостиная',
    areaM2: 14.9,
    pixels: [
      [456, 164],
      [830, 164],
      [830, 706],
      [456, 706],
    ],
  },
  {
    name: 'Прихожая',
    areaM2: 5.8,
    pixels: [
      [166, 50],
      [275, 50],
      [275, 164],
      [440, 164],
      [440, 360],
      [280, 360],
      [280, 300],
      [104, 300],
      [104, 164],
      [166, 164],
    ],
  },
] as const

function toWorld([x, y]: readonly [number, number]): PlanPoint {
  const [a, b, c, d, e, f] = planImageMatrix(calibration)
  return { xCm: a * x + c * y + e, yCm: b * x + d * y + f }
}

const rooms: PlanRoomShape[] = labelledRooms.map((room) => ({
  name: room.name,
  polygon: room.pixels.map(toWorld),
}))

describe('ручная разметка реального плана 28,8 м²', () => {
  it('covers all four labelled rooms with non-self-crossing contours', () => {
    expect(rooms.map((room) => room.name)).toEqual(['Санузел', 'Кухня', 'Гостиная', 'Прихожая'])
    expect(
      inspectPlanGeometry({ widthCm: 900, heightCm: 800, walls: [], openings: [], rooms }),
    ).toEqual([])
  })

  it('does not conceal a hallway mismatch behind the near-matching apartment total', () => {
    const areas = rooms.map((room) => planPolygonAreaM2(room.polygon))
    const total = areas.reduce((sum, area) => sum + area, 0)
    expect(total).toBeCloseTo(28.3, 0)
    expect(Math.abs(total - 28.8) / 28.8).toBeLessThan(0.02)
    for (const index of [0, 1, 2]) {
      const labelled = labelledRooms[index]
      if (!labelled) throw new Error('Отсутствует подписанная комната в эталонном плане')
      expect(Math.abs((areas[index] ?? 0) - labelled.areaM2) / labelled.areaM2).toBeLessThan(0.05)
    }
    expect(areas[3]).toBeLessThan(5.1)
    expect(labelledRooms[3].areaM2).toBe(5.8)
    expect(inspectPlanRoomAreas(rooms, labelledRooms)).toEqual([
      expect.objectContaining({ id: 'manual-room-area-3', roomIndexes: [3] }),
    ])
  })
})
