import {
  projectedFloorPreview,
  projectFloorPreviewPoint,
} from '@uyut/catalog/plan-projected-floor-preview'
import type { PlanGeometry, PlanProjectedVerticalEvidence } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import { planVolume } from './plan-volume'

const sha256 = 'a'.repeat(64)
const reviewedAt = '2026-10-25T00:00:00.000Z'

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing test fixture')
  return value
}

function fixture(): PlanGeometry {
  const geometry: PlanGeometry = {
    version: 1,
    status: 'draft',
    widthCm: 600,
    heightCm: 400,
    walls: [],
    openings: [],
    rooms: [
      {
        name: 'Общая зона',
        sourceNumbers: [1, 2, 3],
        polygon: [
          { xCm: 0, yCm: 0 },
          { xCm: 300, yCm: 0 },
          { xCm: 300, yCm: 200 },
          { xCm: 0, yCm: 200 },
        ],
      },
      {
        name: 'Ванная',
        sourceNumber: 7,
        polygon: [
          { xCm: 300, yCm: 0 },
          { xCm: 600, yCm: 0 },
          { xCm: 600, yCm: 200 },
          { xCm: 300, yCm: 200 },
        ],
      },
      {
        name: 'Санузел с душем',
        sourceNumber: 8,
        polygon: [
          { xCm: 0, yCm: 200 },
          { xCm: 200, yCm: 200 },
          { xCm: 200, yCm: 400 },
          { xCm: 0, yCm: 400 },
        ],
      },
    ],
    warnings: [],
    pdfCalibration: {
      sourceSha256: sha256,
      pdfPage: 2,
      sourceState: 'proposed',
      cmPerPoint: 1,
      origin: { x: 0, y: 0 },
      anchorRoomNumbers: [],
      labelIndexes: [],
      derivedOpeningIds: [],
      floorScope: { kind: 'partial', note: 'Балконное соединение не подтверждено' },
    },
  }
  const statement = (
    id: string,
    roomIndex: number,
    printedValue: string,
    valueCm: number,
    wholeRoom: boolean,
  ): PlanProjectedVerticalEvidence => ({
    id,
    quantity: 'floor-level',
    printedValue,
    unit: 'm',
    valueCm,
    target: { kind: 'room', room: structuredClone(required(geometry.rooms[roomIndex])) },
    geometrySource: { sha256, pdfPage: 2, state: 'proposed' },
    source: { sha256, pdfPage: 3, captionIndexes: [roomIndex + 20], captionTexts: [printedValue] },
    reviewedAt,
    reviewedBy: 'owner',
    ...(wholeRoom
      ? {
          floorContourReview: {
            zeroCaptionIndex: 239,
            zeroCaptionText: '±0.000',
            reviewedAt,
            reviewedBy: 'owner',
          },
        }
      : {}),
  })
  geometry.projectedVerticalEvidence = [
    statement('dry', 0, '0.000', 0, true),
    statement('bath', 1, '-0.050', -5, true),
    statement('wc', 2, '-0.050', -5, true),
    statement('shower', 2, '+0.150', 15, false),
  ]
  return geometry
}

function entry(geometry: PlanGeometry, index: number): PlanProjectedVerticalEvidence {
  return required(geometry.projectedVerticalEvidence?.[index])
}

describe('source-scoped projected floor preview', () => {
  it('keeps the original conflicting captions as documentary levels without inventing points or slopes', () => {
    const geometry = fixture()
    entry(geometry, 2).scopeLabel = 'Основной пол'
    entry(geometry, 3).scopeLabel = 'Душевая с уклоном к трапу'
    const model = required(projectedFloorPreview(geometry))
    const held = required(model.heldRooms[0])
    expect(held.levels).toEqual([
      {
        evidenceId: 'wc',
        printedValue: '-0.050',
        unit: 'm',
        scopeLabel: 'Основной пол',
        pdfPage: 3,
        captionIndexes: [22],
        captionTexts: ['-0.050'],
      },
      {
        evidenceId: 'shower',
        printedValue: '+0.150',
        unit: 'm',
        scopeLabel: 'Душевая с уклоном к трапу',
        pdfPage: 3,
        captionIndexes: [22],
        captionTexts: ['+0.150'],
      },
    ])
    expect(held.reason).toContain('перехода или уклона')
    expect(model.floors.map((floor) => floor.elevationCm)).toEqual([0, -5])
    held.levels[0]?.captionIndexes.push(999)
    expect(entry(geometry, 2).source.captionIndexes).toEqual([22])
  })

  it('does not carry stale or unrelated captions into the held-room explanation', () => {
    const geometry = fixture()
    delete entry(geometry, 2).floorContourReview
    entry(geometry, 3).source.sha256 = 'b'.repeat(64)
    const model = required(projectedFloorPreview(geometry))
    expect(required(model.heldRooms[0]).levels.map((level) => level.evidenceId)).toEqual(['wc'])
    expect(required(model.heldRooms[0]).levels.some((level) => level.evidenceId === 'bath')).toBe(
      false,
    )
  })

  it('builds only explicitly reviewed uniform floors and holds an unresolved shower contour', () => {
    const geometry = fixture()
    const before = structuredClone(geometry)
    const model = required(projectedFloorPreview(geometry))
    expect(model.kind).toBe('projected-floor-preview')
    expect(model.sourcePage).toBe(2)
    expect(model.datum).toEqual({
      sha256,
      pdfPage: 3,
      captionIndex: 239,
      captionText: '±0.000',
    })
    expect(model.floors.map(({ name, elevationCm }) => ({ name, elevationCm }))).toEqual([
      { name: 'Общая зона', elevationCm: 0 },
      { name: 'Ванная', elevationCm: -5 },
    ])
    expect(model.floors[0]?.sourceNumbers).toEqual([1, 2, 3])
    expect(model.heldRooms).toHaveLength(1)
    expect(model.heldRooms[0]).toMatchObject({ name: 'Санузел с душем' })
    expect(model.heldRooms[0]?.reason).toContain('разные отметки')
    expect(model.heldRooms[0]).not.toHaveProperty('elevationCm')
    expect(model.floorScopeNote).toBe('Балконное соединение не подтверждено')
    expect(model.warnings.join(' ')).toContain('не подтверждённый обмер')
    expect(model.warnings.join(' ')).toContain('не как пол на нулевой отметке')
    expect(geometry).toEqual(before)
    expect(geometry.verticalReference).toBeUndefined()
    expect(planVolume({ ...geometry, status: 'confirmed' })).toBeNull()
    required(model.floors[0]?.polygon[0]).xCm = 12
    expect(geometry).toEqual(before)
  })

  it('never interprets a scope label as whole-room review', () => {
    const geometry = fixture()
    for (const record of geometry.projectedVerticalEvidence ?? []) {
      delete record.floorContourReview
      record.scopeLabel = 'Весь контур комнаты; общий проектный ноль'
    }
    expect(projectedFloorPreview(geometry)).toBeUndefined()
  })

  it('requires a reviewed zero-valued surface, not just a zero caption in metadata', () => {
    const geometry = fixture()
    delete entry(geometry, 0).floorContourReview
    expect(projectedFloorPreview(geometry)).toBeUndefined()
  })

  it('holds an unreviewed room without giving its contextual outline a level', () => {
    const geometry = fixture()
    delete entry(geometry, 1).floorContourReview
    const model = required(projectedFloorPreview(geometry))
    expect(model.floors).toHaveLength(1)
    expect(model.heldRooms.map(({ name }) => name)).toEqual(['Ванная', 'Санузел с душем'])
    expect(model.heldRooms[0]).not.toHaveProperty('elevationCm')
  })

  it.each(['index', 'text', 'page'] as const)('rejects a different common zero %s', (change) => {
    const geometry = fixture()
    const bath = entry(geometry, 1)
    const review = required(bath.floorContourReview)
    if (change === 'index') review.zeroCaptionIndex = 240
    if (change === 'text') review.zeroCaptionText = '+0.000'
    if (change === 'page') bath.source.pdfPage = 4
    expect(projectedFloorPreview(geometry)).toBeUndefined()
  })

  it.each(['unsigned', 'nonzero', 'missing-reviewer'] as const)(
    'does not accept invalid datum metadata: %s',
    (change) => {
      const geometry = fixture()
      const review = required(entry(geometry, 0).floorContourReview)
      if (change === 'unsigned') review.zeroCaptionText = '0'
      if (change === 'nonzero') review.zeroCaptionText = '±0.001'
      if (change === 'missing-reviewer') review.reviewedBy = ''
      expect(projectedFloorPreview(geometry)).toBeUndefined()
    },
  )

  it.each(['source', 'reimport', 'existing'] as const)('holds changed %s', (change) => {
    const geometry = fixture()
    const calibration = required(geometry.pdfCalibration)
    if (change === 'source') calibration.sourceSha256 = 'b'.repeat(64)
    if (change === 'reimport') geometry.requiresSourceReviewReimport = true
    if (change === 'existing') calibration.sourceState = 'existing'
    expect(projectedFloorPreview(geometry)).toBeUndefined()
  })

  it('drops a changed room snapshot while retaining independent current rooms', () => {
    const geometry = fixture()
    required(geometry.rooms[1]).name = 'Ванная после изменения'
    const model = required(projectedFloorPreview(geometry))
    expect(model.floors.map(({ evidenceId }) => evidenceId)).toEqual(['dry'])
    expect(model.heldRooms.find(({ roomIndex }) => roomIndex === 1)?.name).toBe(
      'Ванная после изменения',
    )
  })

  it('accepts a reviewed concave room without replacing it by a rectangle', () => {
    const geometry = fixture()
    const room = required(geometry.rooms[0])
    room.polygon = [
      { xCm: 0, yCm: 0 },
      { xCm: 300, yCm: 0 },
      { xCm: 300, yCm: 100 },
      { xCm: 200, yCm: 100 },
      { xCm: 200, yCm: 200 },
      { xCm: 0, yCm: 200 },
    ]
    entry(geometry, 0).target = { kind: 'room', room: structuredClone(room) }
    expect(projectedFloorPreview(geometry)?.floors[0]?.polygon).toEqual(room.polygon)
  })

  it.each(['rooms', 'polygon', 'point'] as const)(
    'holds malformed stored %s without throwing',
    (part) => {
      const geometry = fixture()
      if (part === 'rooms') Object.assign(geometry, { rooms: null })
      if (part === 'polygon') Object.assign(required(geometry.rooms[1]), { polygon: null })
      if (part === 'point') required(geometry.rooms[1]).polygon.splice(0, 1, null as never)
      expect(projectedFloorPreview(geometry)).toBeUndefined()
    },
  )

  it.each([
    'nan-size',
    'zero-size',
    'outside',
    'nonfinite',
    'duplicate',
    'crossing',
    'line',
  ] as const)('refuses invalid render geometry %s', (change) => {
    const geometry = fixture()
    const room = required(geometry.rooms[1])
    if (change === 'nan-size') geometry.widthCm = Number.NaN
    if (change === 'zero-size') geometry.heightCm = 0
    if (change === 'outside') required(room.polygon[0]).xCm = -1
    if (change === 'nonfinite') required(room.polygon[0]).yCm = Number.POSITIVE_INFINITY
    if (change === 'duplicate') room.polygon.push(structuredClone(required(room.polygon[0])))
    if (change === 'crossing')
      room.polygon = [
        { xCm: 300, yCm: 0 },
        { xCm: 600, yCm: 200 },
        { xCm: 600, yCm: 0 },
        { xCm: 300, yCm: 200 },
      ]
    if (change === 'line')
      room.polygon = [
        { xCm: 300, yCm: 0 },
        { xCm: 400, yCm: 0 },
        { xCm: 500, yCm: 0 },
      ]
    expect(projectedFloorPreview(geometry)).toBeUndefined()
  })
})

describe('orthographic projected floor display', () => {
  const view = { azimuthDeg: 30, elevationDeg: 45, verticalScale: 1 as const }
  const point = { xCm: 100, yCm: 200 }

  it('uses the printed level in centimetres and scales only its visual displacement', () => {
    const origin = projectFloorPreviewPoint(point, 0, view)
    const normal = projectFloorPreviewPoint(point, -5, view)
    const enlarged = projectFloorPreviewPoint(point, -5, { ...view, verticalScale: 10 })
    expect(normal.x).toBe(origin.x)
    expect(normal.y - origin.y).toBeCloseTo(5 * Math.SQRT1_2)
    expect(normal.depth - origin.depth).toBeCloseTo(-5 * Math.SQRT1_2)
    expect(enlarged.y - origin.y).toBeCloseTo((normal.y - origin.y) * 10)
    expect(point).toEqual({ xCm: 100, yCm: 200 })
  })

  it('returns a true top view without a visible height displacement', () => {
    const zero = projectFloorPreviewPoint(point, 0, { ...view, elevationDeg: 90 })
    const raised = projectFloorPreviewPoint(point, 15, { ...view, elevationDeg: 90 })
    expect(raised.x).toBeCloseTo(zero.x)
    expect(raised.y).toBeCloseTo(zero.y)
  })

  it('wraps azimuth without changing geometry', () => {
    expect(projectFloorPreviewPoint(point, -5, { ...view, azimuthDeg: 390 })).toEqual(
      projectFloorPreviewPoint(point, -5, view),
    )
  })

  it.each([
    { point: { xCm: Number.NaN, yCm: 0 }, z: 0, view },
    { point, z: Number.POSITIVE_INFINITY, view },
    { point, z: 10001, view },
    { point, z: 0, view: { ...view, elevationDeg: -1 } },
    { point, z: 0, view: { ...view, elevationDeg: 91 } },
    { point, z: 0, view: { ...view, azimuthDeg: Number.NaN } },
    { point, z: 0, view: { ...view, verticalScale: 2 as 1 } },
  ])('refuses an invalid camera or coordinate %#', ({ point: input, z, view: camera }) => {
    expect(() => projectFloorPreviewPoint(input, z, camera)).toThrow()
  })
})
