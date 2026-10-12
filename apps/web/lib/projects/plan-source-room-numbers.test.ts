import type { PlanReading } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import { floorHeightFixture } from './plan-native-reviewed-floor-heights.fixture'
import {
  planSourceRoomNumberOptions,
  recoverPlanSourceRoomNumbers,
} from './plan-source-room-numbers'

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing fixture value')
  return value
}

function fixture() {
  const source = floorHeightFixture()
  const reading: PlanReading = {
    sourcePage: 3,
    planState: 'existing',
    readAt: 'old',
    rooms: [{ name: 'Спальня', kind: 'bedroom', areaM2: 12 }],
    geometry: {
      version: 1,
      status: 'confirmed',
      confirmedAt: 'old',
      widthCm: 500,
      heightCm: 400,
      walls: [],
      openings: [],
      rooms: [],
      warnings: [],
      footprint: [
        { xCm: 0, yCm: 0 },
        { xCm: 500, yCm: 0 },
        { xCm: 500, yCm: 400 },
        { xCm: 0, yCm: 400 },
      ],
    },
    ceilingCm: 270,
    paintedFloorReview: {
      version: 1,
      savedAt: 'old',
      draftJson: JSON.stringify(source.reviewedFloors),
    },
    heightBindingReview: { version: 1, savedAt: 'old', draftJson: 'height-unchanged' },
    deliveryMeasurements: { version: 1, savedAt: 'old', draftJson: 'delivery-unchanged' },
  }
  const input = { ...source, reviewed: source.reviewedFloors, reading }
  const review = {
    acknowledgement: true,
    selections: [{ floorId: 'native-fill-10:0:piece-0', roomIndex: 0 }],
  }
  return { input, review }
}

describe('missing printed room number recovery', () => {
  it('proposes decimal identity and changes exactly one field after explicit acknowledgement', () => {
    const { input, review } = fixture()
    const before = structuredClone(input)
    const options = planSourceRoomNumberOptions(input)
    expect(options.options).toEqual([
      {
        floorId: 'native-fill-10:0:piece-0',
        roomIndex: 0,
        sourceNumber: 3.1,
        sourceRoomKey: '3.1',
        name: 'Спальня',
      },
    ])
    expect(options.readyFor2D).toBe(false)
    expect(options.readyFor3D).toBe(false)
    expect(options.physicalBoundariesAccepted).toBe(false)
    expect(options.measurementsConfirmed).toBe(false)
    expect(options.commonZeroConfirmed).toBe(false)
    const recovered = recoverPlanSourceRoomNumbers(input, review)
    expect(recovered.reading).toEqual({
      ...before.reading,
      rooms: [{ ...before.reading.rooms[0], sourceNumber: 3.1 }],
    })
    expect(input).toEqual(before)
  })
  it('matches trimmed exact names, not fuzzy, normalized or numbered aliases', () => {
    const { input } = fixture()
    required(input.reading.rooms[0]).name = '  Спальня  '
    expect(planSourceRoomNumberOptions(input).options).toHaveLength(1)
    for (const name of ['спальня', 'Спальня 1', 'Спальн', 'Жилая комната']) {
      required(input.reading.rooms[0]).name = name
      expect(planSourceRoomNumberOptions(input).options).toEqual([])
    }
  })
  it('does not resolve duplicate names even when one has a known number', () => {
    const { input } = fixture()
    input.reading.rooms.push({ name: 'Спальня', kind: 'bedroom', sourceNumber: 4 })
    expect(planSourceRoomNumberOptions(input).options).toEqual([])
  })
  it.each([3, 3.1, 4])('never overwrites existing source number %s', (sourceNumber) => {
    const { input, review } = fixture()
    required(input.reading.rooms[0]).sourceNumber = sourceNumber
    expect(planSourceRoomNumberOptions(input).options).toEqual([])
    expect(recoverPlanSourceRoomNumbers(input, review).reading).toBeNull()
  })
  it('rejects collisions against differently named rooms', () => {
    const { input, review } = fixture()
    input.reading.rooms.push({ name: 'Кладовая', kind: 'bedroom', sourceNumber: 3.1 })
    expect(planSourceRoomNumberOptions(input).options).toEqual([])
    expect(recoverPlanSourceRoomNumbers(input, review).reading).toBeNull()
  })
  it('holds duplicate existing identifiers rather than repairing them incidentally', () => {
    const { input, review } = fixture()
    input.reading.rooms.push(
      { name: 'Детская', kind: 'kid', sourceNumber: 4 },
      { name: 'Гостиная', kind: 'living', sourceNumber: 4 },
    )
    expect(planSourceRoomNumberOptions(input).refusalReason).toBe('duplicate-reading-source-number')
    expect(recoverPlanSourceRoomNumbers(input, review).reading).toBeNull()
  })
  it.each([
    'missing-ack',
    'false-ack',
    'wrong-floor',
    'wrong-room',
    'duplicate',
    'forged-number',
    'empty',
  ])('rejects %s selection', (failure) => {
    const { input, review } = fixture()
    const value: Record<string, unknown> = structuredClone(review)
    if (failure === 'missing-ack') delete value.acknowledgement
    if (failure === 'false-ack') value.acknowledgement = false
    if (failure === 'wrong-floor') value.selections = [{ floorId: 'other', roomIndex: 0 }]
    if (failure === 'wrong-room')
      value.selections = [{ floorId: required(review.selections[0]).floorId, roomIndex: 1 }]
    if (failure === 'duplicate') value.selections = [...review.selections, ...review.selections]
    if (failure === 'forged-number')
      value.selections = [{ ...review.selections[0], sourceNumber: 3.1 }]
    if (failure === 'empty') value.selections = []
    expect(recoverPlanSourceRoomNumbers(input, value).reading).toBeNull()
  })
  it.each(['incomplete', 'stale-polygon', 'wrong-frame', 'noncanonical'])(
    'rejects %s source evidence',
    (failure) => {
      const { input, review } = fixture()
      if (failure === 'incomplete') input.native.complete = false
      if (failure === 'stale-polygon')
        required(required(input.reviewed.floors[0]).polygon[0]).x += 1
      if (failure === 'wrong-frame')
        input.reviewed.rasterSource = { ...input.reviewed.rasterSource, width: 999 }
      if (failure === 'noncanonical')
        required(input.reviewed.floors[0]).owner.sourceRoomKey = '3.10'
      expect(planSourceRoomNumberOptions(input).refusalReason).not.toBeNull()
      expect(recoverPlanSourceRoomNumbers(input, review).reading).toBeNull()
    },
  )
})
