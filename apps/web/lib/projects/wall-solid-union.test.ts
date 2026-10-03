import type { PlanGeometry, PlanWall } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import { type PlanSolidFace, planVolume } from './plan-volume'

function wall(
  id: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  heightCm = 200,
): PlanWall {
  return {
    id,
    kind: 'inner',
    start: { xCm: x1, yCm: y1 },
    end: { xCm: x2, yCm: y2 },
    heightCm,
    measuredThicknessCm: 20,
  }
}

const base: PlanGeometry = {
  version: 1,
  status: 'confirmed',
  widthCm: 1000,
  heightCm: 1000,
  walls: [],
  openings: [],
  rooms: [],
  warnings: [],
  footprint: [
    { xCm: -20, yCm: -120 },
    { xCm: 1000, yCm: -120 },
    { xCm: 1000, yCm: 1000 },
    { xCm: -20, yCm: 1000 },
  ],
}

function volume(faces: PlanSolidFace[]): number {
  let result = 0
  for (const face of faces) {
    for (const ring of [face.points, ...(face.holes ?? [])]) {
      const a = ring[0]
      if (!a) continue
      for (let index = 1; index < ring.length - 1; index++) {
        const b = ring[index]
        const c = ring[index + 1]
        if (!b || !c) continue
        result +=
          (a.xCm * (b.yCm * c.zCm - b.zCm * c.yCm) -
            a.yCm * (b.xCm * c.zCm - b.zCm * c.xCm) +
            a.zCm * (b.xCm * c.yCm - b.yCm * c.xCm)) /
          6
      }
    }
  }
  return result
}

function model(walls: PlanWall[], openings: PlanGeometry['openings'] = []) {
  const result = planVolume({ ...base, walls, openings })
  if (!result) throw new Error('Union rejected')
  expect(result.joinedSolids).toBe(true)
  return result
}

describe('объединение объёмов стен', () => {
  it.each([
    ['Г-образный', wall('b', 300, 0, 300, 200), 1_980_000],
    ['Т-образный', wall('b', 150, 0, 150, 200), 1_960_000],
    ['крест', wall('b', 150, -100, 150, 100), 1_920_000],
  ] as const)('учитывает %s стык один раз', (_name, second, expected) => {
    const result = model([wall('a', 0, 0, 300, 0), second])
    expect(volume(result.solidFaces)).toBeCloseTo(expected, 5)
    expect(result.issues).toEqual([])
  })

  it('не считает пересечение выше короткой стены и удаляет внутренние горизонтальные грани', () => {
    const result = model([wall('a', 0, 0, 300, 0, 270), wall('b', 150, -100, 150, 100, 100)])
    expect(volume(result.solidFaces)).toBeCloseTo(1_980_000, 5)
    // At 100 cm only the exposed top of the short wall remains, not the full tall wall cap.
    const at100 = result.solidFaces.filter((face) =>
      face.points.every((point) => point.zCm === 100),
    )
    expect(at100).toHaveLength(2)
  })

  it('объединяет совпадающие и продолжающие друг друга стены, но не заполняет зазор', () => {
    const first = wall('a', 0, 0, 300, 0)
    expect(volume(model([first, wall('b', 300, 0, 0, 0)]).solidFaces)).toBeCloseTo(1_200_000, 5)
    const continued = model([first, wall('b', 300, 0, 500, 0)])
    expect(volume(continued.solidFaces)).toBeCloseTo(2_000_000, 5)
    expect(
      continued.solidFaces.some((face) => face.points.every((point) => point.xCm === 300)),
    ).toBe(false)
    const gap = model([first, wall('b', 301, 0, 500, 0)])
    expect(volume(gap.solidFaces)).toBeCloseTo(1_996_000, 5)
    expect(
      gap.solidFaces.filter((face) => face.points.every((point) => point.zCm === 200)),
    ).toHaveLength(2)
  })

  it('сохраняет пустой центр замкнутого контура, включая отверстия в верхней грани', () => {
    const result = model([
      wall('a', 0, 0, 200, 0),
      wall('b', 200, 0, 200, 200),
      wall('c', 200, 200, 0, 200),
      wall('d', 0, 200, 0, 0),
    ])
    expect(volume(result.solidFaces)).toBeCloseTo(3_120_000, 5)
    const top = result.solidFaces.find((face) => face.points.every((point) => point.zCm === 200))
    expect(top?.holes).toHaveLength(1)
  })

  it('сохраняет объём при наклоне осей, обратном направлении и другом порядке стен', () => {
    const original = [wall('a', 0, 0, 300, 0), wall('b', 150, -100, 150, 100)]
    const rotate = (point: PlanWall['start']) => ({
      xCm: 400 + (point.xCm - point.yCm) / Math.sqrt(2),
      yCm: 400 + (point.xCm + point.yCm) / Math.sqrt(2),
    })
    const rotated = original
      .map((item) => ({
        ...item,
        start: rotate(item.end),
        end: rotate(item.start),
      }))
      .reverse()
    expect(volume(model(rotated).solidFaces)).toBeCloseTo(1_920_000, 5)
  })

  it('не превращает стену с неизвестной толщиной в объём и не меняет исходные мерки', () => {
    const walls = [
      wall('a', 0, 0, 300, 0),
      wall('b', 150, -100, 150, 100),
      { ...wall('c', 0, 200, 300, 200), measuredThicknessCm: undefined },
    ]
    const source = { ...base, walls }
    const before = structuredClone(source)
    const result = planVolume(source)
    expect(result?.joinedSolids).toBe(true)
    expect(result?.walls.find((item) => item.wallId === 'c')?.solid).toBeUndefined()
    expect(volume(result?.solidFaces ?? [])).toBeCloseTo(1_920_000, 5)
    expect(source).toEqual(before)
  })

  it('не удаляет другую стену ради проёма и предупреждает о реальном перекрытии', () => {
    const first = wall('a', 0, 0, 300, 0, 270)
    const second = wall('b', 150, -100, 150, 100, 270)
    const door = {
      id: 'door',
      type: 'door' as const,
      wallId: 'a',
      offsetCm: 100,
      widthCm: 100,
      bottomCm: 0,
      heightCm: 210,
    }
    const result = model([first, second], [door])
    expect(result.issues[0]).toMatchObject({ openingIds: ['door'], wallIds: ['a', 'b'] })
    // 1,620,000 - 420,000 + 1,080,000 - 24,000 cm³: overlap remains only above the door.
    expect(volume(result.solidFaces)).toBeCloseTo(2_256_000, 5)
    const secondDoor = { ...door, id: 'other', wallId: 'b', offsetCm: 80, widthCm: 40 }
    expect(model([first, second], [door, secondDoor]).issues).toEqual([])
  })

  it('не предупреждает о касании и о стене ниже оконного проёма', () => {
    const window = {
      id: 'window',
      type: 'window' as const,
      wallId: 'a',
      offsetCm: 100,
      widthCm: 100,
      bottomCm: 80,
      heightCm: 100,
    }
    const first = wall('a', 0, 0, 300, 0)
    expect(model([first, wall('b', 150, -100, 150, 100, 80)], [window]).issues).toEqual([])
    expect(model([first, wall('b', 90, -100, 90, 100)], [window]).issues).toEqual([])
  })
})
