import { validatePlanGeometryEdit } from '@uyut/ai'
import type { PlanGeometry } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import {
  applyPlanVerticalDimensions,
  inspectPlanVerticalDimensions,
  openingFloorLevel,
  planVerticalMeasurementReport,
} from './plan-vertical-dimensions'

const geometry: PlanGeometry = {
  version: 1,
  status: 'draft',
  widthCm: 400,
  heightCm: 300,
  walls: [{ id: 'wall', start: { xCm: 0, yCm: 0 }, end: { xCm: 400, yCm: 0 }, kind: 'outer' }],
  openings: [
    { id: 'window', type: 'window', wallId: 'wall', offsetCm: 100, widthCm: 100, sillHeightCm: 80 },
  ],
  rooms: [],
  warnings: [],
}

function pairedGeometry(relation: 'faces' | 'width' = 'faces'): PlanGeometry {
  const input = structuredClone(geometry)
  const wall = input.walls[0]
  const opening = input.openings[0]
  if (!wall || !opening) throw new Error('Missing paired fixture')
  wall.heightCm = 270
  opening.type = 'balcony'
  opening.bottomCm = 5
  opening.heightCm = 210
  const oppositeWall = { ...structuredClone(wall), id: 'opposite-wall' }
  oppositeWall.start.yCm = 10
  oppositeWall.end.yCm = 10
  const opposite = { ...opening, id: 'opposite', wallId: oppositeWall.id }
  input.walls.push(oppositeWall)
  input.openings.push(opposite)
  input.rooms = [
    {
      name: 'Room',
      polygon: [
        { xCm: 0, yCm: 0 },
        { xCm: 400, yCm: 0 },
        { xCm: 400, yCm: 300 },
        { xCm: 0, yCm: 300 },
      ],
    },
  ]
  const bindings = structuredClone([
    { wall, opening },
    { wall: oppositeWall, opening: opposite },
  ])
  const first = bindings[0]
  const second = bindings[1]
  if (!first || !second) throw new Error('Missing paired bindings')
  input.pdfCalibration = {
    sourceSha256: 'a'.repeat(64),
    pdfPage: 1,
    cmPerPoint: 1,
    origin: { x: 0, y: 0 },
    anchorRoomNumbers: [1],
    labelIndexes: [1],
    derivedOpeningIds: [],
    wallFaceRoomPolygons: structuredClone(input.rooms.map(({ polygon }) => polygon)),
    ...(relation === 'faces'
      ? {
          openingFacePairs: [
            {
              bindings: [first, second],
              jambs: [
                { operationIndex: 1, subpathIndex: 0, segmentIndex: 0 },
                { operationIndex: 1, subpathIndex: 0, segmentIndex: 1 },
              ],
            },
          ],
        }
      : {
          openingWidthProofs: [
            {
              ...first,
              labelIndex: 1,
              sameOpeningAs: { roomSourceNumber: 1, openingId: second.opening.id },
              oppositeBinding: second,
            },
          ],
        }),
  }
  return input
}

describe('мерки по высоте', () => {
  it.each(['faces', 'width'] as const)(
    'удерживает разные высоты двух исходно связанных сторон: %s',
    (relation) => {
      const input = pairedGeometry(relation)
      const opposite = input.openings[1]
      if (!opposite) throw new Error('Missing opposite opening')
      opposite.heightCm = 210.000000001
      const before = structuredClone(input)
      expect(inspectPlanVerticalDimensions(input)).toEqual([
        expect.objectContaining({
          id: 'opening-paired-height-opposite-window',
          openingIds: ['opposite', 'window'],
        }),
      ])
      expect(planVerticalMeasurementReport(input).surfaceStatus).toBe('invalid')
      expect(applyPlanVerticalDimensions(input, input).ok).toBe(false)
      expect(input).toEqual(before)
    },
  )

  it.each(['faces', 'width'] as const)(
    'не подменяет разные отсчёты нижней грани ровным общим полом: %s',
    (relation) => {
      const input = pairedGeometry(relation)
      const opposite = input.openings[1]
      if (!opposite) throw new Error('Missing opposite opening')
      opposite.bottomCm = 5.000000001
      expect(inspectPlanVerticalDimensions(input)[0]?.message).toContain('уровни пола')
      expect(applyPlanVerticalDimensions(input, input).ok).toBe(false)
    },
  )

  it.each(['faces', 'width'] as const)(
    'не копирует отсутствующие мерки на другую сторону: %s',
    (relation) => {
      const input = pairedGeometry(relation)
      const opposite = input.openings[1]
      if (!opposite) throw new Error('Missing opposite opening')
      delete opposite.heightCm
      delete opposite.bottomCm
      const before = structuredClone(input)
      expect(inspectPlanVerticalDimensions(input)).toEqual([])
      expect(planVerticalMeasurementReport(input)).toMatchObject({
        surfaceStatus: 'partial',
        missingOpeningHeightIds: ['opposite'],
        unknownThresholdIds: ['opposite'],
      })
      const result = applyPlanVerticalDimensions(input, input)
      if (!result.ok) throw new Error(result.error)
      expect(result.geometry.openings[1]).not.toHaveProperty('bottomCm')
      expect(result.geometry.openings[1]).not.toHaveProperty('heightCm')
      expect(input).toEqual(before)
    },
  )

  it.each(['faces', 'width'] as const)(
    'сохраняет одинаковые мерки без вывода о ровном полу: %s',
    (relation) => {
      const input = pairedGeometry(relation)
      expect(inspectPlanVerticalDimensions(input)).toEqual([])
      expect(planVerticalMeasurementReport(input)).toMatchObject({
        surfaceStatus: 'complete',
        raisedThresholdIds: ['window', 'opposite'],
      })
    },
  )

  it.each(['room', 'host', 'cut', 'type'])(
    'не сравнивает вертикальные мерки по устаревшей исходной связи: %s',
    (changed) => {
      for (const relation of ['faces', 'width'] as const) {
        const input = pairedGeometry(relation)
        const opposite = input.openings[1]
        const wall = input.walls[1]
        const corner = input.rooms[0]?.polygon[0]
        if (!opposite || !wall || !corner) throw new Error('Missing fixture')
        opposite.heightCm = 211
        if (changed === 'room') corner.xCm += 1
        if (changed === 'host') wall.start.yCm += 1
        if (changed === 'cut') opposite.offsetCm += 1
        if (changed === 'type') opposite.type = 'door'
        expect(inspectPlanVerticalDimensions(input)).toEqual([])
      }
    },
  )

  it('не выводит связь из соседства и неподтверждённого sameOpeningAs', () => {
    const input = pairedGeometry('width')
    const opposite = input.openings[1]
    const proof = input.pdfCalibration?.openingWidthProofs?.[0]
    if (!opposite || !proof) throw new Error('Missing proof')
    opposite.heightCm = 211
    delete proof.sameOpeningAs
    expect(inspectPlanVerticalDimensions(input)).toEqual([])
    proof.sameOpeningAs = { roomSourceNumber: 1, openingId: 'different' }
    expect(inspectPlanVerticalDimensions(input)).toEqual([])
    delete input.pdfCalibration
    expect(inspectPlanVerticalDimensions(input)).toEqual([])
  })

  it('не повторяет конфликт при дублированном свидетельстве той же пары', () => {
    const input = pairedGeometry()
    const pair = input.pdfCalibration?.openingFacePairs?.[0]
    const opposite = input.openings[1]
    if (!pair || !opposite || !input.pdfCalibration) throw new Error('Missing pair')
    opposite.heightCm = 211
    input.pdfCalibration.openingFacePairs?.push(structuredClone(pair))
    input.pdfCalibration.openingWidthProofs = [
      {
        ...pair.bindings[0],
        labelIndex: 1,
        sameOpeningAs: { roomSourceNumber: 1, openingId: pair.bindings[1].opening.id },
        oppositeBinding: pair.bindings[1],
      },
    ]
    expect(inspectPlanVerticalDimensions(input)).toHaveLength(1)
  })

  it('не принимает некорректную толщину и не переносит распознанную в мерку', () => {
    const source = {
      ...geometry,
      walls: geometry.walls.map((wall) => ({ ...wall, thicknessCm: 20 })),
    }
    const result = applyPlanVerticalDimensions(source, source)
    if (!result.ok) throw new Error(result.error)
    expect(result.geometry.walls[0]?.thicknessCm).toBe(20)
    expect(result.geometry.walls[0]).not.toHaveProperty('measuredThicknessCm')
    for (const measuredThicknessCm of [0, -1, 101, Number.NaN, Infinity]) {
      const invalid = {
        ...source,
        walls: source.walls.map((wall) => ({ ...wall, measuredThicknessCm })),
      }
      expect(applyPlanVerticalDimensions(source, invalid).ok).toBe(false)
      expect(inspectPlanVerticalDimensions(invalid)[0]?.wallIds).toEqual(['wall'])
    }
  })
  it('добавляет отдельно заданные мерки после проверки горизонтальной геометрии', () => {
    const input = {
      ...geometry,
      walls: geometry.walls.map((wall) => ({
        ...wall,
        heightCm: 270.5,
        measuredThicknessCm: 12.5,
      })),
      openings: geometry.openings.map((opening) => ({
        ...opening,
        bottomCm: 50.5,
        heightCm: 140.2,
      })),
    }
    const horizontal = validatePlanGeometryEdit(input, 'draft')
    expect(horizontal?.walls[0]).not.toHaveProperty('heightCm')
    expect(horizontal?.walls[0]).not.toHaveProperty('measuredThicknessCm')
    expect(horizontal?.openings[0]).not.toHaveProperty('bottomCm')
    if (!horizontal) throw new Error('Missing horizontal geometry')
    const result = applyPlanVerticalDimensions(horizontal, input)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.geometry.walls[0]?.heightCm).toBe(270.5)
    expect(result.geometry.walls[0]?.measuredThicknessCm).toBe(12.5)
    expect(result.geometry.openings[0]).toMatchObject({ bottomCm: 50.5, heightCm: 140.2 })
  })

  it('не подставляет высоту подоконника или нулевой низ при пустых полях', () => {
    const result = applyPlanVerticalDimensions(geometry, geometry)
    if (!result.ok) throw new Error(result.error)
    expect(result.geometry.openings[0]?.sillHeightCm).toBe(80)
    expect(result.geometry.openings[0]).not.toHaveProperty('bottomCm')
    expect(result.geometry.openings[0]).not.toHaveProperty('heightCm')
    expect(result.geometry.walls[0]).not.toHaveProperty('heightCm')
  })

  it('очищает прежние мерки при удалении значений в редакторе', () => {
    const before = {
      ...geometry,
      walls: geometry.walls.map((wall) => ({ ...wall, heightCm: 270, measuredThicknessCm: 12 })),
      openings: geometry.openings.map((opening) => ({ ...opening, bottomCm: 50, heightCm: 140 })),
    }
    const result = applyPlanVerticalDimensions(before, geometry)
    if (!result.ok) throw new Error(result.error)
    expect(result.geometry.walls[0]).not.toHaveProperty('heightCm')
    expect(result.geometry.walls[0]).not.toHaveProperty('measuredThicknessCm')
    expect(result.geometry.openings[0]).not.toHaveProperty('bottomCm')
  })

  it('показывает противоречие по конкретному проёму и отклоняет сохранение', () => {
    const invalid = {
      ...geometry,
      walls: geometry.walls.map((wall) => ({ ...wall, heightCm: 270 })),
      openings: geometry.openings.map((opening) => ({ ...opening, bottomCm: 150, heightCm: 140 })),
    }
    expect(inspectPlanVerticalDimensions(invalid)[0]?.openingIds).toEqual(['window'])
    expect(applyPlanVerticalDimensions(geometry, invalid).ok).toBe(false)
    expect(
      applyPlanVerticalDimensions(geometry, {
        ...invalid,
        walls: [{ id: 'wall', heightCm: Number.NaN }],
      }).ok,
    ).toBe(false)
  })

  it.each([
    'duplicate-wall',
    'duplicate-opening',
    'unknown-wall',
    'unknown-opening',
    'missing-wall',
    'missing-opening',
    'trimmed-id',
  ])('не принимает изменившийся или неоднозначный список мерок: %s', (kind) => {
    const input = structuredClone(geometry)
    if (kind === 'duplicate-wall')
      input.walls.push(structuredClone(input.walls[0] as PlanGeometry['walls'][number]))
    if (kind === 'duplicate-opening')
      input.openings.push(structuredClone(input.openings[0] as PlanGeometry['openings'][number]))
    if (kind === 'unknown-wall' && input.walls[0]) input.walls[0].id = 'another-wall'
    if (kind === 'unknown-opening' && input.openings[0]) input.openings[0].id = 'another-opening'
    if (kind === 'missing-wall') input.walls = []
    if (kind === 'missing-opening') input.openings = []
    if (kind === 'trimmed-id' && input.walls[0]) input.walls[0].id = ' wall '
    const before = structuredClone(geometry)
    expect(applyPlanVerticalDimensions(geometry, input).ok).toBe(false)
    expect(geometry).toEqual(before)
  })

  it('отклоняет невозможный верх проёма даже при неизвестной высоте стены', () => {
    const input = structuredClone(geometry)
    const opening = input.openings[0]
    if (!opening) throw new Error('Missing opening')
    opening.bottomCm = 500
    opening.heightCm = 101
    expect(inspectPlanVerticalDimensions(input)[0]?.openingIds).toEqual(['window'])
    expect(applyPlanVerticalDimensions(geometry, input).ok).toBe(false)
    opening.heightCm = 100
    expect(inspectPlanVerticalDimensions(input)).toEqual([])
  })
  it('не округляет выступающий верх проёма до допустимой высоты стены', () => {
    const input = structuredClone(geometry)
    const wall = input.walls[0]
    const opening = input.openings[0]
    if (!wall || !opening) throw new Error('Missing aperture fixture')
    wall.heightCm = 270
    opening.bottomCm = 60.000000001
    opening.heightCm = 210
    const before = structuredClone(input)
    expect(inspectPlanVerticalDimensions(input)[0]?.id).toBe('opening-height-window')
    expect(applyPlanVerticalDimensions(geometry, input).ok).toBe(false)
    expect(input).toEqual(before)
  })
  it('не теряет превышение десятичной суммы при переводе общего верха обратно в Number', () => {
    const input = structuredClone(geometry)
    const wall = input.walls[0]
    const opening = input.openings[0]
    if (!wall || !opening) throw new Error('Missing aperture fixture')
    wall.heightCm = 600
    opening.bottomCm = 1e-20
    opening.heightCm = 600
    expect(opening.bottomCm + opening.heightCm).toBe(600)
    expect(inspectPlanVerticalDimensions(input)[0]?.id).toBe('opening-height-window')
    expect(applyPlanVerticalDimensions(geometry, input).ok).toBe(false)
  })
  it.each([
    [0.1, 0.2, 0.3],
    [0.14, 599.86, 600],
  ])(
    'сравнивает введённый десятичный верх %s + %s с высотой %s без плавающей ошибки',
    (bottomCm, heightCm, wallHeightCm) => {
      const input = structuredClone(geometry)
      const wall = input.walls[0]
      const opening = input.openings[0]
      if (!wall || !opening) throw new Error('Missing aperture fixture')
      wall.heightCm = wallHeightCm
      opening.bottomCm = bottomCm
      opening.heightCm = heightCm
      expect(inspectPlanVerticalDimensions(input)).toEqual([])
      expect(applyPlanVerticalDimensions(geometry, input).ok).toBe(true)
    },
  )
  it('удерживает огромные высоты без аварии вычисления отметки', () => {
    const input = structuredClone(geometry)
    const opening = input.openings[0]
    if (!opening) throw new Error('Missing aperture fixture')
    opening.bottomCm = Number.MAX_VALUE
    opening.heightCm = Number.MAX_VALUE
    expect(inspectPlanVerticalDimensions(input)[0]?.id).toBe('opening-height-window')
  })

  it('удерживает высоты без стены-хозяина и повторяющиеся идентификаторы', () => {
    const input = structuredClone(geometry)
    if (input.openings[0]) input.openings[0].wallId = 'removed'
    expect(inspectPlanVerticalDimensions(input)[0]?.openingIds).toEqual(['window'])
    expect(planVerticalMeasurementReport(input).surfaceStatus).toBe('invalid')
    input.walls.push(structuredClone(input.walls[0] as PlanGeometry['walls'][number]))
    expect(inspectPlanVerticalDimensions(input)[0]?.id).toBe('vertical-element-identity')
  })

  it.each(['', ' ', ' wall ', 'a'.repeat(101)])(
    'не объявляет полными мерки с недопустимым существующим ID: %s',
    (id) => {
      const input = structuredClone(geometry)
      const wall = input.walls[0]
      const opening = input.openings[0]
      if (!wall || !opening) throw new Error('Missing geometry')
      wall.id = id
      wall.heightCm = 270
      wall.measuredThicknessCm = 10
      opening.wallId = id
      opening.bottomCm = 0
      opening.heightCm = 210
      expect(inspectPlanVerticalDimensions(input)[0]?.id).toBe('vertical-element-identity')
      expect(planVerticalMeasurementReport(input).surfaceStatus).toBe('invalid')
      expect(applyPlanVerticalDimensions(input, input).ok).toBe(false)
    },
  )

  it('отделяет полноту высот от неизвестной толщины и не подставляет нулевой порог', () => {
    const source = structuredClone(geometry)
    const opening = source.openings[0]
    const wall = source.walls[0]
    if (!opening || !wall) throw new Error('Missing fixture')
    opening.type = 'balcony'
    expect(planVerticalMeasurementReport(source)).toMatchObject({
      surfaceStatus: 'partial',
      unknownThresholdIds: ['window'],
      raisedThresholdIds: [],
    })
    opening.bottomCm = 0
    opening.heightCm = 210
    wall.heightCm = 270
    expect(planVerticalMeasurementReport(source)).toMatchObject({
      surfaceStatus: 'complete',
      missingWallThicknessIds: ['wall'],
      unknownThresholdIds: [],
      raisedThresholdIds: [],
    })
    opening.bottomCm = 0.000000001
    expect(planVerticalMeasurementReport(source).raisedThresholdIds).toEqual(['window'])
    expect(openingFloorLevel(opening)).toBe('raised')
    delete opening.bottomCm
    expect(openingFloorLevel(opening)).toBe('unknown')
  })
})
