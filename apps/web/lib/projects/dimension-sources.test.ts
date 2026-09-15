import { describe, expect, it } from 'vitest'
import {
  dimensionSourceLabel,
  editedDimensionSources,
  planDimensionSources,
} from './dimension-sources'

const original = {
  name: 'Кухня',
  kind: 'kitchen' as const,
  widthCm: 200,
  depthCm: 300,
  estimated: ['width' as const],
}
const input = { name: 'Кухня', kind: 'kitchen', widthCm: 200, depthCm: 300 }

describe('dimension provenance', () => {
  it('does not upgrade legacy saved plans to recognized dimensions', () => {
    expect(
      planDimensionSources(input, [{ ...original, estimated: undefined }], true).widthCm?.source,
    ).toBe('unknown')
  })
  it('preserves estimates on unchanged manual save, but not on edits', () => {
    const before = { ...input, dimensionSources: planDimensionSources(input, [original]) }
    expect(editedDimensionSources(input, before).widthCm?.source).toBe('estimated')
    expect(editedDimensionSources({ ...input, widthCm: 220 }, before).widthCm?.source).toBe(
      'entered',
    )
    expect(editedDimensionSources({ widthCm: null, depthCm: null }, before)).toEqual({})
  })
  it('keeps estimates distinct from plan readings', () => {
    const sources = planDimensionSources(input, [original])
    expect(sources.widthCm?.source).toBe('estimated')
    expect(sources.depthCm?.source).toBe('plan')
  })
  it('does not turn repeated saving into verification', () => {
    const dimensionSources = planDimensionSources(input, [original])
    expect(
      planDimensionSources(input, [{ ...original, estimated: undefined, dimensionSources }]),
    ).toEqual(dimensionSources)
  })
  it('marks edits as unverified manual input and omits missing values', () => {
    const sources = planDimensionSources({ ...input, widthCm: 210, depthCm: null }, [original])
    expect(sources.widthCm?.source).toBe('entered')
    expect(sources.depthCm).toBeUndefined()
  })
  it('does not guess provenance for renamed or ambiguous rooms', () => {
    expect(planDimensionSources({ ...input, name: 'Другая' }, [original]).widthCm?.source).toBe(
      'unknown',
    )
    expect(planDimensionSources(input, [original, original]).widthCm?.source).toBe('unknown')
  })
  it('treats legacy data and stale provenance as unconfirmed', () => {
    expect(dimensionSourceLabel({ widthCm: 200 }, 'widthCm', 200)).toBe('Источник не подтверждён')
    const dimensionSources = planDimensionSources(input, [original])
    expect(dimensionSourceLabel({ dimensionSources }, 'widthCm', 210)).toBe(
      'Источник не подтверждён',
    )
    expect(dimensionSourceLabel({ dimensionSources }, 'widthCm', 200)).toContain('Вычислено')
  })
})
