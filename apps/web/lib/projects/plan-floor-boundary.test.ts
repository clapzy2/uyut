import { parsePlanGeometry, validatePlanGeometryEdit } from '@uyut/ai'
import type { PlanPoint } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import { floorBoundaryFromWalls } from './plan-floor-boundary'
import { buildPlanScene } from './plan-scene-geometry'
import { planVolume } from './plan-volume'

// Synthetic regression shape, not measurements of the cropped 28.8 m² image.
const balconyFloor: PlanPoint[] = [
  { xCm: 0, yCm: 0 },
  { xCm: 400, yCm: 0 },
  { xCm: 400, yCm: 360 },
  { xCm: 320, yCm: 400 },
  { xCm: 250, yCm: 380 },
  { xCm: 250, yCm: 300 },
  { xCm: 0, yCm: 300 },
]

const walls = balconyFloor.map((start, index) => ({
  id: `wall-${index}`,
  kind: 'outer' as const,
  start,
  end: balconyFloor[(index + 1) % balconyFloor.length] as PlanPoint,
}))

describe('image floor with a projecting diagonal balcony', () => {
  it('keeps the exact points from parsing through an edited draft to the 3D floor', () => {
    const mm = (point: PlanPoint) => ({ xMm: point.xCm * 10, yMm: point.yCm * 10 })
    const candidate = parsePlanGeometry({
      widthMm: 4000,
      heightMm: 4000,
      footprint: balconyFloor.map(mm),
      walls: walls.map((wall) => ({ ...wall, start: mm(wall.start), end: mm(wall.end) })),
      rooms: [{ name: 'Балкон', polygon: balconyFloor.slice(2, 6).map(mm) }],
    })
    expect(candidate?.footprint).toEqual(balconyFloor)
    const edited = validatePlanGeometryEdit(candidate, 'confirm')
    expect(edited?.footprint).toEqual(balconyFloor)
    if (!edited) throw new Error('Missing parsed draft')
    expect(planVolume(edited)).toBeNull()
    const model = planVolume({ ...edited, status: 'confirmed' })
    expect(model?.floor).toEqual(balconyFloor)
    expect(model?.rooms?.[0]).toMatchObject({ title: 'Балкон', sourceOnly: true })
    if (!model) throw new Error('Missing viewing model')
    const scene = buildPlanScene(model)
    const floor = scene.surfaces.find((surface) => surface.kind === 'floor')
    const positions = floor?.geometry.getAttribute('position')
    expect(positions?.count).toBe(balconyFloor.length)
    balconyFloor.forEach((point, index) => {
      expect(positions?.getX(index)).toBeCloseTo(point.xCm / 100, 6)
      expect(positions?.getZ(index)).toBeCloseTo(point.yCm / 100, 6)
    })
    for (const surface of scene.surfaces) surface.geometry.dispose()
    for (const line of scene.lines) line.geometry.dispose()
  })

  it('copies a closed ring without losing diagonals and refuses to bridge an open edge', () => {
    expect(floorBoundaryFromWalls([...walls].reverse())).toHaveLength(7)
    expect(floorBoundaryFromWalls(walls)).toEqual(balconyFloor)
    expect(floorBoundaryFromWalls(walls.slice(0, -1))).toBeUndefined()
  })

  it('does not replace a missing or self-crossing floor by the bounding rectangle', () => {
    const base = { version: 1, widthCm: 400, heightCm: 400, walls, rooms: [], openings: [] }
    expect(validatePlanGeometryEdit(base, 'draft')?.footprint).toBeUndefined()
    expect(
      validatePlanGeometryEdit(
        {
          ...base,
          footprint: [balconyFloor[0], balconyFloor[2], balconyFloor[1], balconyFloor[6]],
        },
        'draft',
      )?.footprint,
    ).toBeUndefined()
  })

  it('uses a space kind for a balcony whose project name is not the word balcony', () => {
    const model = planVolume({
      version: 1,
      status: 'confirmed',
      widthCm: 400,
      heightCm: 400,
      footprint: balconyFloor,
      walls,
      openings: [],
      warnings: [],
      rooms: [{ name: 'Тёплая зона', spaceKind: 'loggia', polygon: balconyFloor.slice(2, 6) }],
    })
    expect(model?.rooms?.[0]).toMatchObject({ title: 'Тёплая зона', sourceOnly: true })
  })
})
