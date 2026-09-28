import { describe, expect, it } from 'vitest'
import type { PdfLinework } from '../lib/projects/plan-pdf-linework'
import {
  type MeasuredOpening,
  type PerimeterProbe,
  verifyPdfPerimeterProbes,
} from './qa-pdf-perimeter'

const wall = (operationIndex: number, left: number, right: number) => ({
  operationIndex,
  subpathIndex: 0,
  paint: 'fill' as const,
  closed: true,
  points: [
    { x: left, y: 0 },
    { x: right, y: 0 },
    { x: right, y: 10 },
    { x: left, y: 10 },
  ],
})

const work: PdfLinework = {
  coordinateSystem: 'page-0-1000',
  pageWidth: 1000,
  pageHeight: 1000,
  paths: [wall(1, 0, 40), wall(2, 60, 100)],
  skippedCurves: 0,
  unsupportedPaths: 0,
  unsupportedContexts: 0,
  clippedPaths: 0,
  truncated: false,
}
const probe: PerimeterProbe = {
  side: 'top',
  axis: 'width',
  at: 5,
  from: 0,
  to: 100,
  wallFillOperations: [1, 2],
  openingLabelIndexes: [7],
  gapBoundaryTolerance: 0.02,
}
const opening: MeasuredOpening[] = [
  {
    labelIndex: 7,
    axis: 'width',
    ends: [
      { x: 40, y: 5 },
      { x: 60, y: 5 },
    ],
  },
]

describe('source-reviewed perimeter probes', () => {
  it('keeps only the opening between two filled wall bodies', () => {
    expect(verifyPdfPerimeterProbes('sample.pdf', work, [probe], opening)).toEqual({
      top: [{ from: 40, to: 60 }],
    })
  })

  it('rejects a missing wall body and an extra solid within the opening', () => {
    expect(() =>
      verifyPdfPerimeterProbes(
        'sample.pdf',
        work,
        [{ ...probe, wallFillOperations: [1] }],
        opening,
      ),
    ).toThrow('wall coverage disagrees with openings')
    expect(() =>
      verifyPdfPerimeterProbes(
        'sample.pdf',
        { ...work, paths: [...work.paths, wall(3, 48, 52)] },
        [{ ...probe, wallFillOperations: [1, 2, 3] }],
        opening,
      ),
    ).toThrow('wall coverage disagrees with openings')
  })

  it('rejects a gap without a source-reviewed dimension', () => {
    expect(() => verifyPdfPerimeterProbes('sample.pdf', work, [probe], [])).toThrow(
      'opening lacks a reviewed dimension',
    )
  })
})
