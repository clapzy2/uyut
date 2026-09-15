import type { RoomMeasurements } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import {
  hasCurrentVerification,
  measurementNotice,
  mergePlanMeasurements,
} from './measurement-assurance'

const measured = {
  widthCm: 300.5,
  depthCm: 400,
  finishStage: 'after',
  toleranceCm: 0.5,
  spots: [{ name: 'ниша', widthCm: 120 }],
  verification: {
    widthCm: 300.5,
    depthCm: 400,
    finishStage: 'after',
    toleranceCm: 0.5,
    confirmedAt: '2026-09-16T10:00:00.000Z',
  },
} satisfies RoomMeasurements

describe('measurement assurance', () => {
  it('accepts only the exact confirmed snapshot', () => {
    expect(hasCurrentVerification(measured)).toBe(true)
    for (const change of [
      { widthCm: 301 },
      { depthCm: 401 },
      { toleranceCm: 1 },
      { finishStage: 'before' as const },
    ]) {
      expect(hasCurrentVerification({ ...measured, ...change })).toBe(false)
    }
  })
  it('never infers verification from dimensions or missing metadata', () => {
    expect(hasCurrentVerification(null)).toBe(false)
    expect(hasCurrentVerification({ widthCm: 300, depthCm: 400 })).toBe(false)
    expect(hasCurrentVerification({ ...measured, verification: undefined })).toBe(false)
  })
  it('rejects invalid verification values and timestamps', () => {
    for (const toleranceCm of [0, -1, Number.NaN, Infinity, 500]) {
      expect(
        hasCurrentVerification({
          ...measured,
          toleranceCm,
          verification: { ...measured.verification, toleranceCm },
        }),
      ).toBe(false)
    }
    expect(
      hasCurrentVerification({
        ...measured,
        verification: { ...measured.verification, confirmedAt: 'not-a-date' },
      }),
    ).toBe(false)
  })
  it('distinguishes a user measurement before finishing from ready dimensions', () => {
    const before = {
      ...measured,
      finishStage: 'before' as const,
      verification: { ...measured.verification, finishStage: 'before' as const },
    }
    expect(hasCurrentVerification(before)).toBe(true)
    expect(measurementNotice(before)).toContain('повторный замер')
    expect(measurementNotice(measured)).toContain('не проверка')
  })
  it('invalidates verification on plan import and preserves unrelated spots', () => {
    const result = mergePlanMeasurements(measured, {
      widthCm: 300.5,
      dimensionSources: { widthCm: { valueCm: 300.5, source: 'estimated' } },
    })
    expect(result?.verification).toBeUndefined()
    expect(result?.toleranceCm).toBeUndefined()
    expect(result?.finishStage).toBe('unknown')
    expect(result?.dimensionSources?.widthCm?.source).toBe('estimated')
    expect(result?.depthCm).toBe(400)
    expect(result?.spots).toEqual(measured.spots)
    expect(measured.verification).toBeDefined()
  })
  it('does not preserve stale provenance or invent a source', () => {
    const result = mergePlanMeasurements(measured, {
      widthCm: 310,
      dimensionSources: { widthCm: { valueCm: 300, source: 'plan' } },
    })
    expect(result?.dimensionSources?.widthCm).toEqual({ valueCm: 310, source: 'unknown' })
  })
  it('keeps confirmation when no side is imported', () => {
    expect(
      hasCurrentVerification(mergePlanMeasurements(measured, { layoutNotes: 'Окно справа' })),
    ).toBe(true)
    expect(mergePlanMeasurements(null, null)).toBeNull()
  })
})
