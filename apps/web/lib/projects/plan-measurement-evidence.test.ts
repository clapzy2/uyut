import { createFalPlanReader, mergeReadings, parseFloorPlan } from '@uyut/ai'
import { describe, expect, it, vi } from 'vitest'
import { planRows } from './plan-rows'

const mocks = vi.hoisted(() => ({ queue: vi.fn() }))
vi.mock('../../../../packages/ai/src/fal-queue', async (original) => ({
  ...(await original<typeof import('../../../../packages/ai/src/fal-queue')>()),
  falQueue: mocks.queue,
}))

// Selected public labels of sheet 03, not the full PDF text layer or its address block.
const labels = [
  { text: '525', rotation: 0 },
  { text: '563', rotation: 0 },
  { text: '926', rotation: 0 },
  { text: '950', rotation: 0 },
  { text: '3718', rotation: 90 },
  { text: '487', rotation: 90 },
  { text: 'натяжной-2663мм', rotation: 0 },
  { text: 'h пр.-2079мм', rotation: 0 },
  { text: 'h2-1663мм', rotation: 0 },
  { text: 'h-2467мм', rotation: 0 },
  { text: 'Общая высота потолка квартиры 2663мм', rotation: 0 },
  { text: 'Потолок квартиры от 2649мм до 2684мм', rotation: 0 },
]
const widthEvidence = {
  kind: 'horizontal-chain',
  scope: 'room',
  sourceNumber: 2,
  roomName: 'Кухня',
  complete: true,
  segmentsMm: [525, 563, 926, 950],
  textItemIndexes: [0, 1, 2, 3],
}
const kitchen = {
  name: 'Кухня',
  sourceNumber: 2,
  widthMm: 2964,
  depthMm: 4205,
  areaM2: 12.35,
  measurementEvidence: {
    width: widthEvidence,
    depth: {
      ...widthEvidence,
      kind: 'vertical-chain',
      segmentsMm: [3718, 487],
      textItemIndexes: [4, 5],
    },
  },
}
const strict = { requireMeasurementEvidence: true, planText: JSON.stringify(labels) }
const read = (room: unknown, options = strict) =>
  parseFloorPlan(JSON.stringify({ rooms: [room] }), options)

describe('measurement evidence ownership and arithmetic, not vision accuracy', () => {
  it('rejects a mathematically correct chain assembled from different drawing rows', () => {
    const planText = JSON.stringify(
      labels.map((label, index) => ({
        ...label,
        x: 200 + index * 30,
        y: index === 3 ? 350 : 95,
      })),
    )
    const room = read(kitchen, { ...strict, planText }).rooms[0]
    expect(room?.widthCm).toBeUndefined()
    expect(room?.areaM2).toBe(12.35)
  })

  it('does not accept the same ceiling label for two different numbered rooms', () => {
    const evidence = {
      kind: 'ceiling',
      scope: 'room',
      sourceNumber: 4,
      complete: true,
      segmentsMm: [2663],
      textItemIndexes: [6],
    }
    const reading = parseFloorPlan(
      JSON.stringify({
        rooms: [
          {
            name: 'Спальня',
            sourceNumber: 4,
            areaM2: 15.39,
            ceilingMm: 2663,
            measurementEvidence: { ceiling: evidence },
          },
          {
            name: 'Гостиная',
            sourceNumber: 3,
            areaM2: 17.05,
            ceilingMm: 2663,
            measurementEvidence: { ceiling: { ...evidence, sourceNumber: 3 } },
          },
        ],
      }),
      strict,
    )
    expect(reading.rooms.map((room) => room.ceilingCm)).toEqual([undefined, undefined])
    expect(
      reading.rooms.every((room) =>
        room.measurementWarnings?.some((warning) => warning.includes('нескольким помещениям')),
      ),
    ).toBe(true)
  })

  it('cross-checks the declared room number/name against the native room schedule', () => {
    const schedule = [
      { text: 'ЭКСПЛИКАЦИЯ ПОМЕЩЕНИЙ', x: 120, y: 430, rotation: 0 },
      { text: '2', x: 100, y: 470, rotation: 0 },
      { text: 'Кухня', x: 140, y: 470, rotation: 0 },
      { text: '12,35', x: 270, y: 470, rotation: 0 },
      { text: '3', x: 100, y: 485, rotation: 0 },
      { text: 'Гостиная', x: 140, y: 485, rotation: 0 },
      { text: '17,05', x: 270, y: 485, rotation: 0 },
    ]
    const planText = JSON.stringify([...labels, ...schedule])
    const wrongOwner = {
      ...kitchen,
      sourceNumber: 3,
      measurementEvidence: {
        width: { ...widthEvidence, sourceNumber: 3 },
        depth: { ...kitchen.measurementEvidence.depth, sourceNumber: 3 },
      },
    }
    const room = read(wrongOwner, { ...strict, planText }).rooms[0]
    expect(room?.widthCm).toBeUndefined()
    expect(room?.depthCm).toBeUndefined()
    expect(room?.areaM2).toBeUndefined()
    expect(room?.measurementWarnings?.join(' ')).toContain('экспликац')
    expect(read(kitchen, { ...strict, planText }).rooms[0]?.widthCm).toBe(296.4)
  })

  it('keeps the complete kitchen chains and their source labels', () => {
    const reading = read(kitchen)
    expect(reading.rooms[0]).toMatchObject({ widthCm: 296.4, depthCm: 420.5 })
    expect(reading.rooms[0]?.measurementEvidence?.width?.segmentsMm).toEqual([525, 563, 926, 950])
    expect(reading.rooms[0]?.measurementWarnings).toBeUndefined()
  })

  it.each([
    ['neighbour room', { ...widthEvidence, sourceNumber: 3 }],
    ['wrong axis', { ...widthEvidence, kind: 'vertical-chain' }],
    ['partial chain', { ...widthEvidence, complete: false }],
    ['wrong declared sum', { ...widthEvidence, segmentsMm: [525, 563, 926, 900] }],
    ['missing segment', { ...widthEvidence, segmentsMm: [525, null, 926, 950] }],
    ['invented index', { ...widthEvidence, textItemIndexes: [0, 1, 2, 999] }],
    ['repeated index', { ...widthEvidence, textItemIndexes: [0, 1, 2, 2] }],
    ['other labels', { ...widthEvidence, textItemIndexes: [0, 1, 4, 5] }],
  ])('does not accept a %s as the kitchen width', (_, evidence) => {
    const room = read({
      ...kitchen,
      measurementEvidence: { ...kitchen.measurementEvidence, width: evidence },
    }).rooms[0]
    expect(room?.widthCm).toBeUndefined()
    expect(room?.depthCm).toBe(420.5)
    expect(room?.areaM2).toBe(12.35)
    expect(room?.measurementWarnings?.[0]).toContain('Ширина')
  })

  it('checks the actual text rotation even when the response says horizontal', () => {
    const planText = JSON.stringify(
      labels.map((label, index) => (index === 0 ? { ...label, rotation: 90 } : label)),
    )
    expect(read(kitchen, { ...strict, planText }).rooms[0]?.widthCm).toBeUndefined()
  })

  it('supports an unnumbered room only with a unique matching name', () => {
    const room = {
      ...kitchen,
      sourceNumber: null,
      measurementEvidence: { width: { ...widthEvidence, sourceNumber: null } },
    }
    expect(read(room).rooms[0]?.widthCm).toBe(296.4)
    expect(
      parseFloorPlan(JSON.stringify({ rooms: [room, room] }), strict).rooms.every(
        (room) => room.widthCm === undefined,
      ),
    ).toBe(true)
  })

  it('leaves missing evidence empty in new reads but retains legacy parsing', () => {
    const room = { ...kitchen, measurementEvidence: undefined }
    expect(read(room).rooms[0]?.widthCm).toBeUndefined()
    expect(parseFloorPlan(JSON.stringify({ rooms: [room] })).rooms[0]?.widthCm).toBe(296.4)
    const rows = planRows({ ...read(room), readAt: '2026-09-27T00:00:00.000Z' })
    expect(rows[0]?.measurementWarnings).toHaveLength(2)
    expect(rows[0]?.width).toBe('')
  })

  const ceilingEvidence = {
    kind: 'ceiling',
    scope: 'room',
    sourceNumber: 4,
    complete: true,
    segmentsMm: [2663],
    textItemIndexes: [6],
  }
  const bedroom = {
    name: 'Спальня',
    sourceNumber: 4,
    areaM2: 15.39,
    ceilingMm: 2663,
    measurementEvidence: { ceiling: ceilingEvidence },
  }

  it('keeps a ceiling in its numbered bedroom, not the neighbouring living room', () => {
    expect(read(bedroom).rooms[0]?.ceilingCm).toBe(266.3)
    expect(
      read({ ...bedroom, sourceNumber: 3, name: 'Гостиная' }).rooms[0]?.ceilingCm,
    ).toBeUndefined()
  })

  it.each([
    [2079, 7],
    [1663, 8],
    [2467, 9],
  ])('does not accept opening/window/beam label %i as a ceiling', (ceilingMm, labelIndex) => {
    const room = read({
      ...bedroom,
      ceilingMm,
      measurementEvidence: {
        ceiling: { ...ceilingEvidence, segmentsMm: [ceilingMm], textItemIndexes: [labelIndex] },
      },
    }).rooms[0]
    expect(room?.ceilingCm).toBeUndefined()
  })

  it('does not turn a room ceiling or a range into an apartment ceiling', () => {
    const reading = parseFloorPlan(
      JSON.stringify({ ceilingMm: 2663, ceilingEvidence, rooms: [bedroom] }),
      strict,
    )
    expect(reading.ceilingCm).toBeUndefined()
    expect(reading.rooms[0]?.ceilingCm).toBe(266.3)
    const range = parseFloorPlan(
      JSON.stringify({
        ceilingMm: 5333,
        ceilingEvidence: {
          ...ceilingEvidence,
          scope: 'apartment',
          sourceNumber: null,
          segmentsMm: [2649, 2684],
        },
        rooms: [],
      }),
      strict,
    )
    expect(range.ceilingCm).toBeUndefined()
  })

  it('does not merge conflicting global or local ceiling heights across pages', () => {
    expect(
      mergeReadings([
        { rooms: [], ceilingCm: 270 },
        { rooms: [], ceilingCm: 265 },
      ]).ceilingCm,
    ).toBeUndefined()
    expect(
      mergeReadings([
        { rooms: [], ceilingCm: 270 },
        { rooms: [{ name: 'Спальня', kind: 'bedroom', ceilingCm: 266.3 }] },
      ]).ceilingCm,
    ).toBeUndefined()
  })

  it('retains evidence when merging an unchanged explicit uniform ceiling', () => {
    const evidence = {
      ...ceilingEvidence,
      kind: 'ceiling' as const,
      scope: 'apartment' as const,
      sourceNumber: undefined,
      complete: true as const,
      textItemIndexes: [10],
    }
    const reading = parseFloorPlan(
      JSON.stringify({ ceilingMm: 2663, ceilingEvidence: evidence, rooms: [bedroom] }),
      strict,
    )
    expect(reading.ceilingCm).toBe(266.3)
    expect(mergeReadings([reading]).ceilingEvidence).toEqual(reading.ceilingEvidence)
  })

  it('does not relabel a local ceiling or range as an explicit uniform ceiling', () => {
    for (const [ceilingMm, labelIndex] of [
      [2663, 6],
      [2684, 11],
    ]) {
      const evidence = {
        ...ceilingEvidence,
        scope: 'apartment',
        sourceNumber: null,
        segmentsMm: [ceilingMm],
        textItemIndexes: [labelIndex],
      }
      expect(
        parseFloorPlan(JSON.stringify({ ceilingMm, ceilingEvidence: evidence, rooms: [] }), strict)
          .ceilingCm,
      ).toBeUndefined()
    }
  })

  it('cannot fall back to legacy acceptance when an evidence field is malformed', () => {
    expect(
      parseFloorPlan(JSON.stringify({ rooms: [{ ...kitchen, measurementEvidence: 'broken' }] }))
        .rooms[0]?.widthCm,
    ).toBeUndefined()
  })

  it('enforces the evidence gate in the real reader without making a network call', async () => {
    mocks.queue.mockResolvedValue({
      output: JSON.stringify({ rooms: [{ ...kitchen, measurementEvidence: undefined }] }),
    })
    const reading = await createFalPlanReader('test-key')({
      body: Buffer.from('test'),
      contentType: 'image/jpeg',
    })
    expect(reading.rooms[0]?.widthCm).toBeUndefined()
    expect(mocks.queue).toHaveBeenCalledOnce()
  })
})
