import { type PlanReading, parseFloorPlan } from '@uyut/ai'
import { describe, expect, it } from 'vitest'
import native from '../../../../docs/qa/fixtures/apartment-74-77-native-labels.json'
import leaders from '../../../../docs/qa/fixtures/apartment-74-77-native-leaders.json'
import annotated from '../../../../docs/qa/fixtures/apartment-74-77-page-contours.json'
import type { PdfVectorPath } from './plan-pdf-linework'
import { type PlanReadingGeometryContext, verifyPlanReadingGeometry } from './plan-reading-geometry'
import { planRows } from './plan-rows'

const textItems = Array.from({ length: native.originalTextItemCount }, () => ({
  text: '',
  x: 0,
  y: 0,
  rotation: 0,
}))
for (const { index, ...item } of native.items) textItems[index] = item
const planText = JSON.stringify(textItems)
const context: PlanReadingGeometryContext = {
  source: annotated.source as PlanReadingGeometryContext['source'],
  contours: {
    ...annotated,
    rooms: annotated.rooms.map(({ roomSourceNumber, polygon }) => ({ roomSourceNumber, polygon })),
  } as PlanReadingGeometryContext['contours'],
  planText,
  linework: {
    coordinateSystem: 'page-0-1000',
    pageWidth: 842,
    pageHeight: 1191,
    paths: [...annotated.dimensionPaths, ...leaders.paths] as PdfVectorPath[],
    skippedCurves: 45,
    unsupportedPaths: 0,
    unsupportedContexts: 0,
    clippedPaths: 0,
    truncated: false,
  },
}
const data = (number: number) => {
  const room = annotated.rooms.find((item) => item.roomSourceNumber === number)
  if (!room) throw new Error('Missing annotated room')
  const segments = (indexes: number[]) => indexes.map((index) => Number(textItems[index]?.text))
  return {
    name: number === 2 ? 'Кухня' : number === 3 ? 'Гостиная' : 'Спальня',
    sourceNumber: number,
    widthMm: room.widthMm,
    depthMm: room.depthMm,
    measurementEvidence: {
      width: {
        kind: 'horizontal-chain',
        scope: 'room',
        sourceNumber: number,
        complete: true,
        segmentsMm: segments(room.widthLabels),
        textItemIndexes: room.widthLabels,
      },
      depth: {
        kind: 'vertical-chain',
        scope: 'room',
        sourceNumber: number,
        complete: true,
        segmentsMm: segments(room.depthLabels),
        textItemIndexes: room.depthLabels,
      },
    },
  }
}
const read = (rooms: unknown[] = [data(4), data(6), data(2), data(3)]) =>
  parseFloorPlan(JSON.stringify({ planState: 'existing', rooms }), {
    requireMeasurementEvidence: true,
    planText,
  })
const gate = (reading: PlanReading, change: Partial<PlanReadingGeometryContext> = {}) =>
  verifyPlanReadingGeometry(reading, { ...context, ...change })
const unverifiedMesh: NonNullable<PlanReading['geometry']> = {
  version: 1,
  status: 'draft',
  widthCm: 1000,
  heightCm: 1000,
  walls: [
    { id: 'w1', kind: 'outer', start: { xCm: 0, yCm: 0 }, end: { xCm: 1000, yCm: 0 } },
    { id: 'w2', kind: 'outer', start: { xCm: 1000, yCm: 0 }, end: { xCm: 1000, yCm: 1000 } },
    { id: 'w3', kind: 'outer', start: { xCm: 1000, yCm: 1000 }, end: { xCm: 0, yCm: 1000 } },
    { id: 'w4', kind: 'outer', start: { xCm: 0, yCm: 1000 }, end: { xCm: 0, yCm: 0 } },
  ],
  openings: [],
  obstacles: [],
  rooms: [],
  warnings: [],
}

describe('reviewed-page geometry gate after the native-text parser', () => {
  it('retains the eight dimension candidates on the reviewed page without marking a site measurement', () => {
    const reading = read()
    expect(gate(reading)).toEqual(reading)
    expect(
      gate(reading).rooms.map((room) => [room.sourceNumber, room.widthCm, room.depthCm]),
    ).toEqual([
      [4, 298.5, 515.6],
      [6, 294.5, 415.4],
      [2, 296.4, 420.5],
      [3, 338.9, 515.8],
    ])
    expect(gate(reading)).not.toHaveProperty('confirmedAt')
  })
  it('rejects another bedroom chain even after the parser accepts its numbers and room declaration', () => {
    const living = data(3)
    const bedroom = data(4)
    const reading = read([
      {
        ...living,
        widthMm: bedroom.widthMm,
        measurementEvidence: {
          ...living.measurementEvidence,
          width: { ...bedroom.measurementEvidence.width, sourceNumber: 3 },
        },
      },
    ])
    expect(reading.rooms[0]?.widthCm).toBe(298.5)
    const checked = gate(reading)
    expect(checked.rooms[0]?.widthCm).toBeUndefined()
    expect(checked.rooms[0]?.depthCm).toBe(515.8)
    expect(checked.rooms[0]?.measurementEvidence?.width).toBeUndefined()
    expect(planRows({ ...checked, readAt: '2026-09-27T15:00:00.000Z' })[0]).toMatchObject({
      width: '',
      depth: '515.8',
    })
    expect(checked.rooms[0]?.measurementWarnings?.join()).toContain('Ширина')
  })
  it('rejects a partial chain with correct native text and arithmetic', () => {
    const bedroom = data(4)
    const reading = read([
      {
        ...bedroom,
        widthMm: 1641,
        measurementEvidence: {
          ...bedroom.measurementEvidence,
          width: {
            ...bedroom.measurementEvidence.width,
            segmentsMm: [939, 702],
            textItemIndexes: [55, 57],
          },
        },
      },
    ])
    expect(reading.rooms[0]?.widthCm).toBe(164.1)
    expect(gate(reading).rooms[0]?.widthCm).toBeUndefined()
  })
  it.each([2310, 2314, 2497, 2501])(
    'rejects only the dimension that lost vector %i',
    (operation) => {
      const checked = gate(read([data(4)]), {
        linework: {
          ...context.linework,
          paths: context.linework.paths.filter((path) => path.operationIndex !== operation),
        },
      })
      expect(checked.rooms[0]?.[operation < 2497 ? 'widthCm' : 'depthCm']).toBeUndefined()
      expect(checked.rooms[0]?.[operation < 2497 ? 'depthCm' : 'widthCm']).toBeDefined()
    },
  )
  it.each([
    { source: { ...context.source, sha256: 'a'.repeat(64) } },
    { source: { ...context.source, pdfPage: 12 } },
    { source: { ...context.source, state: 'proposed' as const } },
    { linework: { ...context.linework, truncated: true } },
    { linework: { ...context.linework, unsupportedContexts: 1 } },
    { linework: { ...context.linework, pageWidth: 841 } },
    { planText: undefined },
    { planText: '{broken' },
  ])('does not retain dimensions on mismatched or missing context %j', (change) => {
    const reading = gate(read([data(2)]), change)
    expect(reading.rooms[0]?.widthCm).toBeUndefined()
    expect(reading.rooms[0]?.depthCm).toBeUndefined()
    expect(reading.rooms[0]?.measurementEvidence).toBeUndefined()
  })
  it.each(['unknown', 'proposed', undefined] as const)(
    'rejects reading state %s for existing contours',
    (planState) => {
      expect(gate({ ...read([data(2)]), planState }).rooms[0]?.widthCm).toBeUndefined()
    },
  )
  it('rejects another reported source page', () => {
    expect(gate({ ...read([data(2)]), sourcePage: 12 }).rooms[0]?.depthCm).toBeUndefined()
  })
  it('does not restore unknown sides from the annotation or area', () => {
    const reading: PlanReading = {
      planState: 'existing',
      rooms: [
        {
          name: 'Кухня',
          kind: 'kitchen',
          sourceNumber: 2,
          areaM2: 12.35,
          layoutNotes: 'Выступ слева',
        },
      ],
    }
    expect(gate(reading)).toEqual(reading)
    expect(gate(reading)).not.toHaveProperty('geometry')
  })
  it('does not fall back to a nearby same-name room without a printed number', () => {
    const reading = read([data(4)])
    delete reading.rooms[0]?.sourceNumber
    expect(gate(reading).rooms[0]?.widthCm).toBeUndefined()
  })
  it('rejects duplicated room owners without picking the first room', () => {
    const reading = read([data(4)])
    const room = reading.rooms[0]
    if (!room) throw new Error('Missing parsed bedroom')
    reading.rooms.push({ ...room, name: 'Спальня другая' })
    for (const checked of gate(reading).rooms) expect(checked.widthCm).toBeUndefined()
  })
  it('traces room ceilings through the leader tip, including a label outside the bedroom', () => {
    const reading = parseFloorPlan(
      JSON.stringify({
        planState: 'existing',
        rooms: [
          {
            ...data(4),
            ceilingMm: 2663,
            measurementEvidence: {
              ...data(4).measurementEvidence,
              ceiling: {
                kind: 'ceiling',
                scope: 'room',
                sourceNumber: 4,
                complete: true,
                segmentsMm: [2663],
                textItemIndexes: [186],
              },
            },
          },
          {
            ...data(6),
            ceilingMm: 2672,
            measurementEvidence: {
              ...data(6).measurementEvidence,
              ceiling: {
                kind: 'ceiling',
                scope: 'room',
                sourceNumber: 6,
                complete: true,
                segmentsMm: [2672],
                textItemIndexes: [188],
              },
            },
          },
        ],
      }),
      { requireMeasurementEvidence: true, planText },
    )
    expect(gate(reading).rooms.map((room) => room.ceilingCm)).toEqual([266.3, 267.2])
  })
  it('rejects another bedroom ceiling, not the nearest text label', () => {
    const reading = parseFloorPlan(
      JSON.stringify({
        planState: 'existing',
        rooms: [
          {
            ...data(4),
            ceilingMm: 2672,
            measurementEvidence: {
              ...data(4).measurementEvidence,
              ceiling: {
                kind: 'ceiling',
                scope: 'room',
                sourceNumber: 4,
                complete: true,
                segmentsMm: [2672],
                textItemIndexes: [188],
              },
            },
          },
        ],
      }),
      { requireMeasurementEvidence: true, planText },
    )
    expect(reading.rooms[0]?.ceilingCm).toBe(267.2)
    expect(gate(reading).rooms[0]?.ceilingCm).toBeUndefined()
    expect(gate(reading).rooms[0]?.widthCm).toBe(298.5)
  })
  it('rejects missing leader geometry and does not use the room rectangle as ceiling evidence', () => {
    const reading = read([data(4)])
    const room = reading.rooms[0]
    if (!room) throw new Error('Missing bedroom')
    room.ceilingCm = 266.3
    room.measurementEvidence = {
      ...room.measurementEvidence,
      ceiling: {
        kind: 'ceiling',
        scope: 'room',
        sourceNumber: 4,
        complete: true,
        segmentsMm: [2663],
        textItemIndexes: [186],
      },
    }
    expect(
      gate(reading, {
        linework: { ...context.linework, paths: annotated.dimensionPaths as PdfVectorPath[] },
      }).rooms[0]?.ceilingCm,
    ).toBeUndefined()
  })
  it.each([true, false])(
    'does not retain an unverified global mesh even when dimensions are present: %s',
    (withDimensions) => {
      const reading = withDimensions
        ? read([data(4)])
        : read([{ name: 'Кухня', sourceNumber: 2, areaM2: 12.35 }])
      reading.geometry = { ...unverifiedMesh }
      const checked = gate(reading)
      expect(checked.geometry).toBeUndefined()
      expect(checked.rooms[0]?.measurementWarnings?.join()).toContain('взаимное положение')
      if (withDimensions) expect(checked.rooms[0]?.widthCm).toBe(298.5)
    },
  )
  it('does not leave an unchecked global geometry after rejecting planar sizes', () => {
    const reading = read([data(4)])
    reading.geometry = { ...unverifiedMesh }
    const checked = gate(reading, { planText: undefined })
    expect(checked.geometry).toBeUndefined()
    expect(reading.geometry).toBeDefined()
  })
  it('clears old estimated/rechecked flags together with a rejected side, preserving area and notes', () => {
    const reading = read([data(4)])
    const room = reading.rooms[0]
    if (!room) throw new Error('Missing bedroom')
    room.areaM2 = 15.39
    room.layoutNotes = 'Окно сверху'
    room.estimated = ['width']
    room.rechecked = ['width', 'depth']
    const checked = gate(reading, {
      linework: {
        ...context.linework,
        paths: context.linework.paths.filter((path) => path.operationIndex !== 2310),
      },
    }).rooms[0]
    expect(checked).toMatchObject({
      areaM2: 15.39,
      layoutNotes: 'Окно сверху',
      rechecked: ['depth'],
    })
    expect(checked?.estimated).toBeUndefined()
  })
  it('does not use a room review as evidence of one apartment-wide ceiling', () => {
    const reading = { ...read([data(4)]), ceilingCm: 266.3 }
    expect(gate(reading).ceilingCm).toBeUndefined()
    expect(gate(reading).rooms[0]?.measurementWarnings?.join()).toContain('Общая высота')
  })
  it('does not mutate an old reading or accumulate duplicate warnings on revalidation', () => {
    const reading = read([data(4)])
    const original = structuredClone(reading)
    const checked = gate(reading, { planText: undefined })
    expect(reading).toEqual(original)
    expect(gate(checked, { planText: undefined })).toEqual(checked)
  })
  it('does not retain stale evidence for an absent number', () => {
    const reading = read([data(4)])
    const room = reading.rooms[0]
    if (!room) throw new Error('Missing bedroom')
    delete room.widthCm
    expect(gate(reading).rooms[0]?.measurementEvidence?.width).toBeUndefined()
    expect(gate(reading).rooms[0]?.widthCm).toBeUndefined()
  })
  it('keeps state conflicts visible even if no numeric fields were read', () => {
    const reading: PlanReading = {
      planState: 'proposed',
      rooms: [{ name: 'Кухня', kind: 'kitchen' }],
    }
    const checked = gate(reading)
    expect(checked.planState).toBe('unknown')
    expect(checked.rooms[0]?.measurementWarnings?.join()).toContain('состояние плана')
  })
  it('rejects labels without page coordinates instead of silently using only their numbers', () => {
    const items = textItems.map(({ text, rotation }) => ({ text, rotation }))
    expect(
      gate(read([data(4)]), { planText: JSON.stringify(items) }).rooms[0]?.widthCm,
    ).toBeUndefined()
  })
})
