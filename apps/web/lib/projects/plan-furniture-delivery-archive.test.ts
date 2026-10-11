import type { PlanGeometry } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import {
  buildFurnitureDeliveryDraft,
  type FurnitureDeliveryDraftFields,
  furnitureDeliveryDraftFieldsSchema,
  furnitureDeliveryDraftSchema,
  MAX_FURNITURE_DELIVERY_DRAFT_BYTES,
  parseFurnitureDeliveryDraft,
  serializeFurnitureDeliveryDraft,
} from './plan-furniture-delivery-archive'

const geometry: PlanGeometry = {
  version: 1,
  status: 'confirmed',
  widthCm: 500,
  heightCm: 400,
  rooms: [],
  walls: [],
  openings: [],
  warnings: [],
}
const profile = {
  widthCm: '040,500',
  depthCm: '60.25',
  heightCm: '170',
  clearanceCm: '1',
  orientation: '0' as const,
}
function fields(): FurnitureDeliveryDraftFields {
  return {
    lowerFloorId: '',
    upperFloorId: '',
    direction: 'y',
    travelDirection: 'up',
    startCm: '-0,1250',
    crossStartCm: '',
    widthCm: '',
    lowerLandingLengthCm: '',
    upperLandingLengthCm: '',
    carryClearanceCm: '',
    sourceReference: 'Обмер площадки — ещё не окончен',
    tilt: 'none',
    angleDeg: '90',
    steps: [{ id: 'step-1', runCm: '28,0010', elevationCm: '', ceilingElevationCm: '' }],
  }
}
const draftText = (changes: Record<string, unknown> = {}) =>
  JSON.stringify({ ...buildFurnitureDeliveryDraft(geometry, profile, fields()), ...changes })

describe('portable furniture delivery drafts', () => {
  it('keeps a draft current after JSONB changes only object property order', () => {
    const reordered = JSON.parse(
      JSON.stringify(geometry, (_key, value) =>
        value && typeof value === 'object' && !Array.isArray(value)
          ? Object.fromEntries(Object.entries(value).reverse())
          : value,
      ),
    ) as PlanGeometry
    expect(parseFurnitureDeliveryDraft(draftText(), reordered, profile).fields).toEqual(fields())
    reordered.widthCm += 0.000001
    expect(parseFurnitureDeliveryDraft(draftText(), reordered, profile).fields).toBeUndefined()
  })
  it('rejects mutually exclusive stair modes instead of silently prioritising one', () => {
    expect(
      furnitureDeliveryDraftFieldsSchema.safeParse({
        ...fields(),
        turning: true,
        polygonMode: true,
      }).success,
    ).toBe(false)
  })
  it('round-trips unfinished measurements without trimming or rounding decimals', () => {
    const data = fields()
    data.angleDeg = ' 37,5000 '
    const text = serializeFurnitureDeliveryDraft(geometry, profile, data)
    expect(parseFurnitureDeliveryDraft(text, geometry, profile)).toEqual({ fields: data })
    expect(JSON.parse(text).profileFields).toEqual(profile)
    expect(JSON.parse(text).referenceKey).toBe('')
  })

  it('preserves rectangle, polygon, exterior and leaf draft text as untrusted form inputs', () => {
    const data: FurnitureDeliveryDraftFields = {
      ...fields(),
      turning: true,
      layout: [
        {
          id: 'landing-1',
          kind: 'landing',
          leftCm: '-1.250',
          topCm: '',
          rightCm: '',
          bottomCm: '',
          elevationCm: '',
          ceilingElevationCm: '',
        },
      ],
      polygonMode: false,
      polygonLayoutJson: '[{"polygon": [',
      exteriorEnabled: true,
      exteriorJson: '{"outside": {',
      doorLeavesEnabled: true,
      doorLeavesJson: '[{"openingId":"door-1"}]',
      targetRoomId: 'room-2',
      allowQuarterTurns: true,
    }
    expect(
      parseFurnitureDeliveryDraft(
        serializeFurnitureDeliveryDraft(geometry, profile, data),
        geometry,
        profile,
      ),
    ).toEqual({ fields: data })
  })

  it('rejects a different geometry rather than rebinding it', () => {
    const response = parseFurnitureDeliveryDraft(
      draftText(),
      { ...geometry, widthCm: 501 },
      profile,
    )
    expect(response.error).toContain('геометрии')
    expect(response.fields).toBeUndefined()
  })

  it('rejects a stale vertical reference even with the current geometry key', () => {
    const response = parseFurnitureDeliveryDraft(
      draftText({ referenceKey: 'old-zero' }),
      geometry,
      profile,
    )
    expect(response.error).toContain('Уровень отсчёта')
    expect(response.fields).toBeUndefined()
  })

  it.each(['widthCm', 'depthCm', 'heightCm', 'clearanceCm', 'orientation'] as const)(
    'rejects changed furniture %s',
    (field) => {
      const changed = { ...profile, [field]: field === 'orientation' ? ('90' as const) : '2' }
      const response = parseFurnitureDeliveryDraft(draftText(), geometry, changed)
      expect(response.error).toContain('мебели')
      expect(response.fields).toBeUndefined()
    },
  )

  it('matches a profile independent of object property insertion order', () => {
    const reordered = {
      orientation: profile.orientation,
      clearanceCm: profile.clearanceCm,
      heightCm: profile.heightCm,
      depthCm: profile.depthCm,
      widthCm: profile.widthCm,
    }
    expect(parseFurnitureDeliveryDraft(draftText(), geometry, reordered).fields).toEqual(fields())
  })

  it.each(['acknowledged', 'result', 'delivery', 'checked', 'acknowledgedKey'])(
    'rejects injected trusted root field %s',
    (key) => {
      expect(
        parseFurnitureDeliveryDraft(draftText({ [key]: true }), geometry, profile).fields,
      ).toBeUndefined()
    },
  )

  it.each(['acknowledged', 'result', '__proto__'])('rejects unknown nested form key %s', (key) => {
    const text = draftText({ fields: { ...fields(), [key]: true } })
    expect(parseFurnitureDeliveryDraft(text, geometry, profile).fields).toBeUndefined()
  })

  it.each([null, [], 'draft', { kind: 'domitsa-furniture-delivery', version: 2 }])(
    'rejects malformed/unsupported archives %j',
    (input) => {
      expect(
        parseFurnitureDeliveryDraft(JSON.stringify(input), geometry, profile).error,
      ).toBeTruthy()
    },
  )

  it('rejects invalid JSON with an actionable error', () => {
    expect(parseFurnitureDeliveryDraft('{', geometry, profile).error).toContain('JSON')
  })

  it('rejects numeric measurements instead of converting them to strings', () => {
    expect(furnitureDeliveryDraftFieldsSchema.safeParse({ ...fields(), startCm: 1 }).success).toBe(
      false,
    )
  })

  it('allows 64 steps but rejects 65 and duplicate step IDs', () => {
    const step = fields().steps[0]
    if (!step) throw new Error('Missing test step')
    const steps = Array.from({ length: 64 }, (_, index) => ({ ...step, id: `step-${index}` }))
    expect(furnitureDeliveryDraftFieldsSchema.safeParse({ ...fields(), steps }).success).toBe(true)
    expect(
      furnitureDeliveryDraftFieldsSchema.safeParse({
        ...fields(),
        steps: [...steps, { ...step, id: 'extra' }],
      }).success,
    ).toBe(false)
    expect(
      furnitureDeliveryDraftFieldsSchema.safeParse({ ...fields(), steps: [step, step] }).success,
    ).toBe(false)
  })

  it('allows 128 layout sections but rejects 129 and duplicate IDs', () => {
    const section = {
      id: 'first',
      kind: 'landing' as const,
      leftCm: '',
      topCm: '',
      rightCm: '',
      bottomCm: '',
      elevationCm: '',
      ceilingElevationCm: '',
    }
    const layout = Array.from({ length: 128 }, (_, index) => ({
      ...section,
      id: `layout-${index}`,
    }))
    expect(furnitureDeliveryDraftFieldsSchema.safeParse({ ...fields(), layout }).success).toBe(true)
    expect(
      furnitureDeliveryDraftFieldsSchema.safeParse({
        ...fields(),
        layout: [...layout, { ...section, id: 'extra' }],
      }).success,
    ).toBe(false)
    expect(
      furnitureDeliveryDraftFieldsSchema.safeParse({ ...fields(), layout: [section, section] })
        .success,
    ).toBe(false)
  })

  it.each([
    ['startCm', 200],
    ['sourceReference', 1000],
    ['polygonLayoutJson', 200000],
    ['exteriorJson', 200000],
    ['doorLeavesJson', 200000],
  ] as const)('enforces string length for %s', (field, limit) => {
    expect(
      furnitureDeliveryDraftFieldsSchema.safeParse({ ...fields(), [field]: 'x'.repeat(limit) })
        .success,
    ).toBe(true)
    expect(
      furnitureDeliveryDraftFieldsSchema.safeParse({ ...fields(), [field]: 'x'.repeat(limit + 1) })
        .success,
    ).toBe(false)
  })

  it('bounds file bytes, not only character count', () => {
    const text = '測'.repeat(Math.floor(MAX_FURNITURE_DELIVERY_DRAFT_BYTES / 3) + 1)
    expect(text.length).toBeLessThan(MAX_FURNITURE_DELIVERY_DRAFT_BYTES)
    expect(parseFurnitureDeliveryDraft(text, geometry, profile).error).toContain('2 МиБ')
  })

  it('rejects oversized serialization even when each string limit is respected', () => {
    const largeGeometry = { ...geometry, warnings: ['測'.repeat(500000)] }
    const data = {
      ...fields(),
      polygonLayoutJson: 'x'.repeat(200000),
      exteriorJson: 'x'.repeat(200000),
      doorLeavesJson: 'x'.repeat(200000),
    }
    expect(() => serializeFurnitureDeliveryDraft(largeGeometry, profile, data)).toThrow('2 МиБ')
  })

  it('builds a detached copy of the form and profile', () => {
    const data = fields()
    const draft = buildFurnitureDeliveryDraft(geometry, profile, data)
    data.startCm = 'changed'
    expect(draft.fields.startCm).toBe('-0,1250')
    expect(furnitureDeliveryDraftSchema.safeParse(draft).success).toBe(true)
    expect(draft.profileFields).not.toBe(profile)
  })
})
