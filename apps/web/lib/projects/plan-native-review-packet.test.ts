import { describe, expect, it } from 'vitest'
import { nativeAnnotationFixture } from '../../scripts/qa-native-annotation-fixture'
import { nativeReviewPacket } from './plan-native-review-packet'

function fixture() {
  const input = nativeAnnotationFixture()
  return { ...input, source: input.reviewed.source, image: input.native.source }
}
describe('whole-page native inspection, separate from saved geometry', () => {
  function savedReading(): PlanReading {
    const input = fixture()
    const polygon = input.work.paths[0]?.points
    if (!polygon) throw new Error('Missing native polygon')
    return {
      readAt: '2026-10-09',
      sourcePage: input.source.pdfPage,
      planState: 'existing',
      rooms: [{ sourceNumber: 1, name: 'Гостиная', kind: 'living' }],
      pageReview: {
        version: 1,
        savedAt: '2026-10-09',
        contours: {
          source: { ...input.source },
          coordinateSystem: 'page-0-1000',
          review: 'manual-source-review',
          pageWidth: input.work.pageWidth,
          pageHeight: input.work.pageHeight,
          rooms: [{ roomSourceNumber: 1, polygon: structuredClone(polygon) }],
        },
      },
    }
  }
  it('checks only saved manual contours and leaves both reading and source unchanged', () => {
    const input = { ...fixture(), savedReading: savedReading() }
    const before = structuredClone(input)
    const packet = nativeReviewPacket(input)
    expect(packet.savedReview).toMatchObject({
      status: 'checked',
      coverage: {
        status: 'partial',
        floorBoundary: 'missing',
        readiness: { readOnly: true, readyFor2D: false, readyFor3D: false },
      },
    })
    expect(input).toEqual(before)
    expect(packet.savedReview).not.toHaveProperty('contours')
    if (packet.savedReview.status !== 'checked') throw new Error('Missing coverage')
    expect(packet.savedReview.coverage).not.toHaveProperty('reviewSpans')
    expect(nativeReviewPacket(fixture()).savedReview).toEqual({ status: 'not-saved' })
  })
  it('distinguishes saved review with missing native layer from no saved review', () => {
    const input = fixture()
    const packet = nativeReviewPacket({
      source: input.source,
      image: input.image,
      savedReading: savedReading(),
    })
    expect(packet.savedReview).toEqual({
      status: 'unavailable',
      reason: 'native-layer-unavailable',
    })
  })
  it('shows refusal for stale saved contours instead of combining different PDFs', () => {
    const input = { ...fixture(), savedReading: savedReading() }
    if (!input.savedReading.pageReview) throw new Error('Missing review')
    input.savedReading.pageReview.contours.source.sha256 = 'c'.repeat(64)
    expect(nativeReviewPacket(input).savedReview).toMatchObject({
      status: 'checked',
      coverage: { status: 'refused', refusalReason: 'different-plan-source' },
    })
  })
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

import type { PlanReading } from '@uyut/db'
