import type { PlanGeometry, PlanOpeningBinding, PlanPoint, PlanWallFacePair } from '@uyut/db'
import { type BufferGeometry, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { buildPlanScene, type PlanScene } from './plan-scene-geometry'
import { applyPlanVerticalReference } from './plan-vertical-reference'
import { planVolume } from './plan-volume'

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Missing synthetic fixture element')
  return value
}

function box(x: number, y: number, width: number, depth: number): PlanPoint[] {
  return [
    { xCm: x, yCm: y },
    { xCm: x + width, yCm: y },
    { xCm: x + width, yCm: y + depth },
    { xCm: x, yCm: y + depth },
  ]
}

/** Synthetic field survey, not measurements of the user's apartment or source PDF. */
function fixture(voidKind?: 'inside' | 'touching') {
  const geometry: PlanGeometry = {
    version: 1,
    status: 'confirmed',
    widthCm: 600,
    heightCm: 800,
    warnings: [],
    footprint: box(0, 0, 600, 800),
    rooms: [
      { name: 'Гостиная и коридор', polygon: box(0, 0, 400, 300), sourceNumbers: [1, 5] },
      { name: 'Санузел', polygon: box(0, 550, 200, 200), sourceNumber: 2 },
      { name: 'Балкон', polygon: box(0, 320, 400, 150), sourceNumber: 3, spaceKind: 'balcony' },
    ],
    walls: [
      {
        id: 'inside-face',
        kind: 'outer',
        start: { xCm: 0, yCm: 300 },
        end: { xCm: 400, yCm: 300 },
        heightCm: 270,
      },
      {
        id: 'bath-face',
        kind: 'outer',
        start: { xCm: 0, yCm: 550 },
        end: { xCm: 200, yCm: 550 },
        heightCm: 250,
      },
      {
        id: 'outside-face',
        kind: 'outer',
        start: { xCm: 0, yCm: 320 },
        end: { xCm: 400, yCm: 320 },
        heightCm: 270,
      },
    ],
    openings: [
      {
        id: 'inside',
        type: 'balcony',
        wallId: 'inside-face',
        offsetCm: 100,
        widthCm: 90,
        bottomCm: 2,
        heightCm: 210,
      },
      {
        id: 'outside',
        type: 'balcony',
        wallId: 'outside-face',
        offsetCm: 100,
        widthCm: 90,
        bottomCm: 17,
        heightCm: 210,
      },
    ],
    ...(voidKind
      ? { voids: [{ id: 'shaft', polygon: box(voidKind === 'inside' ? 50 : 0, 50, 30, 30) }] }
      : {}),
  }
  const binding = (index: number): PlanOpeningBinding => {
    const opening = required(geometry.openings[index])
    const wall = required(geometry.walls.find((wall) => wall.id === opening.wallId))
    return {
      opening: structuredClone(opening),
      wall: structuredClone(wall),
      cut: [
        { xCm: 100, yCm: wall.start.yCm },
        { xCm: 190, yCm: wall.start.yCm },
      ],
    }
  }
  const facePair = (from: number, to: number, operationIndex: number): PlanWallFacePair => ({
    faces: [0, 1].map((index) => {
      const wall = binding(index).wall
      return {
        wall,
        start: { xCm: from, yCm: wall.start.yCm },
        end: { xCm: to, yCm: wall.start.yCm },
        nativeSegment: { operationIndex, subpathIndex: 0, segmentIndex: index },
      }
    }) as PlanWallFacePair['faces'],
    openings: structuredClone(geometry.openings),
  })
  geometry.pdfCalibration = {
    sourceSha256: 'a'.repeat(64),
    pdfPage: 1,
    cmPerPoint: 1,
    origin: { x: 0, y: 0 },
    anchorRoomNumbers: [1],
    labelIndexes: [],
    derivedOpeningIds: [],
    exteriorBoundaryRole: 'floor',
    wallFaceRoomPolygons: structuredClone(geometry.rooms.map((room) => room.polygon)),
    sourceWallFacePairs: [facePair(0, 100, 10), facePair(190, 400, 11)],
    openingFacePairs: [
      {
        bindings: [binding(0), binding(1)],
        jambs: [
          { operationIndex: 12, subpathIndex: 0, segmentIndex: 0 },
          { operationIndex: 12, subpathIndex: 0, segmentIndex: 1 },
        ],
      },
    ],
  }
  const request = {
    version: 1,
    id: 'survey-zero',
    kind: 'finished-floor',
    zeroFloorId: 'floor-0',
    acknowledged: true,
    floors: geometry.rooms.map((room, index) => ({
      id: `floor-${index}`,
      surface: 'finished-floor',
      room: structuredClone(room),
      elevationCm: required([0, -2, -15][index]),
    })),
    wallBases: geometry.walls.map(({ id, kind, start, end }, index) => ({
      wall: structuredClone({ id, kind, start, end }),
      floorId: `floor-${index}`,
    })),
    thresholds: [
      {
        id: 'balcony-threshold',
        elevationCm: 3,
        bindings: geometry.openings.map(({ id, type, wallId, offsetCm, widthCm }, index) => ({
          opening: { id, type, wallId, offsetCm, widthCm },
          floorId: index === 0 ? 'floor-0' : 'floor-2',
        })),
      },
    ],
    source: { kind: 'site-measurement', reference: 'Synthetic survey for regression tests only' },
  }
  const result = applyPlanVerticalReference(
    geometry,
    request,
    'fixture-owner',
    '2026-10-11T09:00:00.000Z',
  )
  if (!result.ok) throw new Error(result.error)
  return result.geometry
}

function area(geometry: BufferGeometry): number {
  const indices = required(geometry.getIndex())
  const positions = geometry.getAttribute('position')
  let result = 0
  for (let index = 0; index < indices.count; index += 3) {
    const a = new Vector3().fromBufferAttribute(positions, indices.getX(index))
    const b = new Vector3().fromBufferAttribute(positions, indices.getX(index + 1))
    const c = new Vector3().fromBufferAttribute(positions, indices.getX(index + 2))
    result += b.sub(a).cross(c.sub(a)).length() / 2
  }
  return result
}

function resurvey(geometry: PlanGeometry): PlanGeometry {
  const reference = required(geometry.verticalReference)
  const result = applyPlanVerticalReference(
    geometry,
    {
      version: reference.version,
      id: reference.id,
      kind: reference.kind,
      zeroFloorId: reference.zeroFloorId,
      floors: reference.floors,
      wallBases: reference.wallBases,
      thresholds: reference.thresholds,
      ceilings: reference.ceilings,
      source: reference.source,
      acknowledged: true,
    },
    'fixture-owner',
    '2026-10-11T10:00:00.000Z',
  )
  if (!result.ok) throw new Error(result.error)
  return result.geometry
}

function dispose(scene: PlanScene) {
  for (const entry of [...scene.surfaces, ...scene.lines]) entry.geometry.dispose()
}

describe('accepted signed survey → volume → scene', () => {
  it('carries a human-reviewed pair into 3D without adding or changing measurements', () => {
    const geometry = fixture()
    const before = planVolume(geometry)
    expect(before).not.toBeNull()
    const reviewed = structuredClone(geometry)
    for (const pair of reviewed.pdfCalibration?.sourceWallFacePairs ?? []) {
      pair.verification = { kind: 'human-source-review', reviewedAt: '2026-10-24T00:00:00.000Z' }
    }
    const volume = required(planVolume(reviewed))
    expect(volume).toEqual(before)
    expect(reviewed.verticalReference).toEqual(geometry.verticalReference)
    expect(reviewed.walls).toEqual(geometry.walls)
    const scene = buildPlanScene(volume)
    expect(scene.surfaces.length).toBeGreaterThan(0)
    dispose(scene)
  })
  it('omits a threshold surface that intersects an independently proven wall strip', () => {
    const geometry = fixture()
    const calibration = required(geometry.pdfCalibration)
    const collision = structuredClone(required(calibration.sourceWallFacePairs?.[0]))
    for (const face of collision.faces) {
      face.start.xCm = 120
      face.end.xCm = 150
      face.nativeSegment.operationIndex = 20
    }
    required(calibration.sourceWallFacePairs).push(collision)
    const model = required(planVolume(resurvey(geometry)))
    expect(model.thresholds).toEqual([])
    expect(model.issues).toContainEqual(
      expect.objectContaining({ id: 'volume-threshold-balcony-threshold', severity: 'warning' }),
    )
    const scene = buildPlanScene(model)
    expect(scene.surfaces.some((surface) => surface.kind === 'threshold')).toBe(false)
    dispose(scene)
  })

  it('reports a kitchen item above its confirmed ceiling without shrinking its height', () => {
    const geometry = fixture()
    required(geometry.verticalReference).ceilings = [
      { id: 'balcony-ceiling', floorId: 'floor-2', elevationCm: 60 },
    ]
    geometry.kitchenItems = [
      { id: 'tall', kind: 'cabinet', xCm: 220, yCm: 350, widthCm: 60, depthCm: 60, heightCm: 85 },
    ]
    const model = required(planVolume(resurvey(geometry)))
    expect(model.furniture?.[0]?.heightCm).toBe(85)
    expect(model.furniture?.[0]?.baseCm).toBe(-15)
    expect(model.issues).toContainEqual(
      expect.objectContaining({ id: 'volume-ceiling-kitchen:tall', severity: 'error' }),
    )
    const scene = buildPlanScene(model)
    const heights = scene.surfaces
      .filter((surface) => surface.furnitureId === 'kitchen:tall')
      .flatMap((surface) => {
        const positions = surface.geometry.getAttribute('position')
        return Array.from({ length: positions.count }, (_, index) => positions.getY(index))
      })
    expect(Math.max(...heights)).toBeCloseTo(0.7)
    dispose(scene)
  })

  it('adds decimal floor and wall measurements exactly rather than rounding a binary residual', () => {
    const geometry = fixture()
    required(required(geometry.verticalReference).floors[2]).elevationCm = -15.2
    required(geometry.openings[1]).bottomCm = 17.2
    required(geometry.walls[2]).heightCm = 270.1
    const model = required(planVolume(resurvey(geometry)))
    expect(model.openings.map((opening) => opening.bottomCm)).toEqual([2, 2])
    const wall = required(model.walls.find((wall) => wall.wallId === 'outside-face'))
    expect(wall.bottomCm).toBe(-15.2)
    expect(wall.topCm).toBe(254.9)
  })

  it('does not treat an existing floor elevation as a finished-floor aperture measurement', () => {
    const geometry = fixture()
    required(required(geometry.verticalReference).floors[2]).surface = 'existing-floor'
    expect(planVolume(resurvey(geometry))).toBeNull()
    // With one local lower edge still unknown, the existing-floor side may be
    // displayed only as an unknown outline, not a finished-floor aperture cut.
    delete required(geometry.openings[0]).bottomCm
    const model = required(planVolume(resurvey(geometry)))
    const outside = required(model.openings.find((opening) => opening.id.startsWith('outside')))
    expect(outside.baseCm).toBe(-15)
    expect(outside.bottomCm).toBeUndefined()
    expect(outside.cut).toBe(false)
    expect(model.issues).toContainEqual(
      expect.objectContaining({ id: 'volume-opening-floor-outside', severity: 'warning' }),
    )
    const scene = buildPlanScene(model)
    const line = required(scene.lines.find((line) => line.id === outside.id))
    expect(line.unknown).toBe(true)
    expect(line.geometry.getAttribute('position').getY(0)).toBeCloseTo(-0.15)
    dispose(scene)
  })

  it('keeps three physical floors and paired local 2/17 cm aperture bottoms at global +2', () => {
    const geometry = fixture()
    const before = structuredClone(geometry)
    const model = required(planVolume(geometry))
    expect(model.floorSurfaces?.map((floor) => floor.elevationCm)).toEqual([0, -2, -15])
    expect(model.openings.map((opening) => opening.bottomCm)).toEqual([2, 2])
    expect(model.openings.map((opening) => opening.baseCm)).toEqual([0, -15])
    expect(model.walls.some((wall) => wall.bottomCm === -15 && wall.topCm === 255)).toBe(true)
    expect(model.thresholds).toHaveLength(1)
    expect(model.thresholds?.[0]?.elevationCm).toBe(3)
    const scene = buildPlanScene(model)
    const floors = scene.surfaces.filter((surface) => surface.kind === 'floor')
    expect(floors).toHaveLength(3)
    for (const [index, floor] of floors.entries()) {
      expect(floor.geometry.getAttribute('position').getY(0)).toBeCloseTo(
        required([0, -0.02, -0.15][index]),
      )
    }
    expect(
      scene.surfaces.some((surface) => surface.id === 'floor' || surface.kind === 'room'),
    ).toBe(false)
    expect(floors.reduce((sum, surface) => sum + area(surface.geometry), 0)).toBeCloseTo(22)
    const threshold = required(scene.surfaces.find((surface) => surface.kind === 'threshold'))
    expect(area(threshold.geometry)).toBeCloseTo(0.18)
    expect(threshold.geometry.getAttribute('position').getY(0)).toBeCloseTo(0.03)
    for (const opening of scene.lines.filter((line) => line.kind === 'opening'))
      expect(opening.geometry.getAttribute('position').getY(0)).toBeCloseTo(0.02)
    expect(geometry.openings.map((opening) => opening.bottomCm)).toEqual([2, 17])
    expect(geometry).toEqual(before)
    dispose(scene)
  })

  it.each(['inside', 'touching'] as const)(
    'preserves a %s void without restoring raw room fill',
    (voidKind) => {
      const geometry = fixture(voidKind)
      const scene = buildPlanScene(required(planVolume(geometry)))
      const floors = scene.surfaces.filter((surface) => surface.kind === 'floor')
      expect(floors.reduce((sum, surface) => sum + area(surface.geometry), 0)).toBeCloseTo(21.91)
      expect(scene.surfaces.some((surface) => surface.kind === 'room')).toBe(false)
      dispose(scene)
    },
  )

  it('puts supported kitchen furniture on its signed floor and omits unsupported furniture', () => {
    const geometry = fixture()
    geometry.kitchenItems = [
      { id: 'known', kind: 'cabinet', xCm: 220, yCm: 350, widthCm: 60, depthCm: 60, heightCm: 85 },
      {
        id: 'unknown',
        kind: 'cabinet',
        xCm: 500,
        yCm: 100,
        widthCm: 60,
        depthCm: 60,
        heightCm: 85,
      },
    ]
    const model = required(planVolume(geometry))
    expect(model.furniture?.map((item) => [item.id, item.baseCm])).toEqual([['kitchen:known', -15]])
    expect(model.issues.some((issue) => issue.id === 'volume-floor-owner-kitchen:unknown')).toBe(
      true,
    )
    const scene = buildPlanScene(model)
    const vertices = scene.surfaces
      .filter((surface) => surface.furnitureId === 'kitchen:known')
      .flatMap((surface) => {
        const positions = surface.geometry.getAttribute('position')
        return Array.from({ length: positions.count }, (_, index) => positions.getY(index))
      })
    expect(Math.min(...vertices)).toBeCloseTo(-0.15)
    expect(Math.max(...vertices)).toBeCloseTo(0.7)
    dispose(scene)
  })

  it.each(['draft', 'room', 'void', 'datum'] as const)(
    'holds stale or unconfirmed input: %s',
    (edit) => {
      const geometry = fixture()
      if (edit === 'draft') geometry.status = 'draft'
      if (edit === 'room') required(required(geometry.rooms[0]).polygon[0]).xCm += 1
      if (edit === 'void') geometry.voids = [{ id: 'new-shaft', polygon: box(0, 50, 30, 30) }]
      if (edit === 'datum') required(geometry.verticalReference).zeroFloorId = 'floor-2'
      expect(planVolume(geometry)).toBeNull()
    },
  )
})
