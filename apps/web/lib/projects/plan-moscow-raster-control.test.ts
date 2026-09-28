import type { PlanPageContours, PlanReading } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import fixture from '../../../../docs/qa/fixtures/moscow-page14-raster-native.json'
import { planPageMetricDraft } from './plan-page-metric-draft'
import { planPageReviewIssue } from './plan-page-review'
import type { PdfLinework } from './plan-pdf-linework'

const source = { ...fixture.source, state: 'existing' as const }
const linework = fixture.linework as PdfLinework
const [width, , , height, x, y] = fixture.raster.transform
if (width === undefined || height === undefined || x === undefined || y === undefined)
  throw new Error('Missing source raster transform')
const left = (x / linework.pageWidth) * 1000
const right = ((x + width) / linework.pageWidth) * 1000
const top = ((linework.pageHeight - y - height) / linework.pageHeight) * 1000
const bottom = ((linework.pageHeight - y) / linework.pageHeight) * 1000

// Deliberately invalid candidate: the source image bounding box, NOT a traced room.
// Room number/name are test-only placeholders, not claimed source identities.
const contours: PlanPageContours = {
  source,
  coordinateSystem: 'page-0-1000',
  review: 'manual-source-review',
  pageWidth: linework.pageWidth,
  pageHeight: linework.pageHeight,
  rooms: [
    {
      roomSourceNumber: 1,
      polygon: [
        { x: left, y: top },
        { x: right, y: top },
        { x: right, y: bottom },
        { x: left, y: bottom },
      ],
    },
  ],
}
const reading: PlanReading = {
  sourcePage: 14,
  planState: 'existing',
  readAt: '2026-09-28',
  rooms: [{ sourceNumber: 1, name: 'Invalid raster bounds', kind: 'living' }],
}

describe('independent Moscow raster-only plan control', () => {
  it('preserves source evidence that vectors and text exist outside the raster plan', () => {
    expect(linework.paths).toHaveLength(29)
    expect(fixture.text).toHaveLength(52)
    expect(linework.clippedPaths).toBe(2)
    expect(linework.paths.slice(2).every((path) => path.points.every((p) => p.x >= 826.968))).toBe(
      true,
    )
    expect(fixture.text.some((item) => item.text === '1:50 А3')).toBe(true)
    expect(fixture.text.some((item) => item.text === '6075')).toBe(false)
  })

  it('rejects the raster bounds as non-native even with a populated vector layer', () => {
    expect(planPageReviewIssue(contours, reading, source, linework)).toBe(
      'non-native-contour-vertex',
    )
  })

  it('does not fabricate metric geometry from the title scale and image placement', () => {
    const result = planPageMetricDraft(
      reading,
      {
        source,
        linework,
        contours,
        planText: JSON.stringify(fixture.text),
      },
      [1],
    )
    expect(result.ok).toBe(false)
    expect(result).not.toHaveProperty('geometry')
  })
})
