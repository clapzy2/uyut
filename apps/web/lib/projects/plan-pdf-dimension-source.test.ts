import { describe, expect, it } from 'vitest'
import { pdfNativeDimensionSourceIssue } from './plan-pdf-dimension-source'
import type { PdfLinework } from './plan-pdf-linework'

const source = { sha256: 'a'.repeat(64), pdfPage: 1, state: 'existing' as const }
function fixture(): PdfLinework {
  return {
    coordinateSystem: 'page-0-1000',
    pageWidth: 700,
    pageHeight: 1100,
    paths: [],
    skippedCurves: 0,
    unsupportedPaths: 0,
    unsupportedContexts: 0,
    clippedPaths: 1,
    clippedPathBounds: [
      {
        operationIndex: 30,
        paint: 'fill',
        bounds: { left: -20, right: -10, top: 700, bottom: 710 },
      },
    ],
    truncated: false,
  }
}
function firstOmission(work: PdfLinework) {
  const item = work.clippedPathBounds?.[0]
  if (!item) throw new Error('Missing synthetic clipped path')
  return item
}
describe('explicit bounded-clipped source inspection, not physical transfer', () => {
  it('keeps the default physical and legacy source guard strict', () => {
    const work = fixture()
    expect(pdfNativeDimensionSourceIssue(source, work)).toBe('incomplete-native-dimension-layer')
    expect(pdfNativeDimensionSourceIssue(source, work, 'bounded-clipped-ink')).toBeUndefined()
  })
  it.each([
    (work: PdfLinework) => {
      work.clippedPaths = 0
    },
    (work: PdfLinework) => {
      work.clippedPaths = -1
    },
    (work: PdfLinework) => {
      work.clippedPaths = 1.5
    },
    (work: PdfLinework) => {
      work.clippedPathBounds = []
    },
    (work: PdfLinework) => {
      work.clippedPathBoundsTruncated = true
    },
    (work: PdfLinework) => {
      firstOmission(work).operationIndex = -1
    },
    (work: PdfLinework) => {
      firstOmission(work).bounds.left = Number.NaN
    },
    (work: PdfLinework) => {
      firstOmission(work).bounds.top = 800
    },
    (work: PdfLinework) => {
      firstOmission(work).paint = 'unknown' as 'fill'
    },
    (work: PdfLinework) => {
      work.unsupportedContexts = 1
    },
    (work: PdfLinework) => {
      work.skippedCurves = 1
    },
  ])('rejects incomplete or malformed inventories atomically (%#)', (change) => {
    const work = fixture()
    change(work)
    expect(pdfNativeDimensionSourceIssue(source, work, 'bounded-clipped-ink')).toBe(
      'incomplete-native-dimension-layer',
    )
  })
  it('retains separate omitted subpaths sharing a paint operation', () => {
    const work = fixture()
    work.clippedPaths = 2
    const omission = firstOmission(work)
    work.clippedPathBounds = [omission, structuredClone(omission)]
    expect(pdfNativeDimensionSourceIssue(source, work, 'bounded-clipped-ink')).toBeUndefined()
  })
})
