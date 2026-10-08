import { describe, expect, it } from 'vitest'
import { nativeAnnotationFixture } from '../../scripts/qa-native-annotation-fixture'
import { nativeReviewPacket } from './plan-native-review-packet'

function fixture() {
  const input = nativeAnnotationFixture()
  return { ...input, source: input.reviewed.source, image: input.native.source }
}
describe('whole-page native inspection, separate from saved geometry', () => {
  it('aggregates only same-source candidates without creating a confirmed plan', () => {
    const input = fixture(),
      before = structuredClone(input)
    const result = nativeReviewPacket(input)
    expect(result.version).toBe(1)
    expect(result.readiness).toEqual({ readyFor2D: false, readyFor3D: false, readOnly: true })
    expect(result.counts.printedDimensions).toBe(1)
    expect(result.issues.map((issue) => issue.code)).toContain('floor-boundaries-unreviewed')
    expect(result).not.toHaveProperty('footprint')
    expect(result).not.toHaveProperty('pageReview')
    expect(JSON.stringify(result)).not.toContain('manual-native-annotation-review')
    expect(input).toEqual(before)
  })
  it('explains unavailable native layers rather than treating zero candidates as complete', () => {
    const input = fixture()
    const result = nativeReviewPacket({ source: input.source, image: input.image })
    expect(result.status).toBe('unresolved')
    expect(result.faces).toEqual([])
    expect(result.issues[0]?.code).toBe('native-layers-unavailable')
  })
  it('preserves localized omitted curves as an incompleteness blocker', () => {
    const input = fixture()
    input.work.skippedCurves = 1
    input.work.skippedCurveBounds = [
      { operationIndex: 1000, bounds: { left: 900, right: 950, top: 900, bottom: 950 } },
    ]
    const result = nativeReviewPacket(input)
    expect(result.status).toBe('unresolved')
    expect(result.extraction.geometryComplete).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('native-geometry-incomplete')
  })
  it.each(['pdf', 'raster', 'page', 'state'])(
    'rejects mismatched %s evidence instead of composing different sources',
    (kind) => {
      const input = fixture()
      if (kind === 'pdf') input.source = { ...input.source, sha256: 'c'.repeat(64) }
      if (kind === 'raster') input.image = { ...input.image, sha256: 'c'.repeat(64) }
      if (kind === 'page') input.source = { ...input.source, pdfPage: 2 }
      if (kind === 'state') input.source = { ...input.source, state: 'proposed' as 'existing' }
      expect(() => nativeReviewPacket(input)).toThrow()
    },
  )
})
