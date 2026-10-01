import { describe, expect, it } from 'vitest'
import type { PdfLinework } from '../lib/projects/plan-pdf-linework'
import {
  type InteriorSpan,
  type MeasuredOpening,
  type PerimeterProbe,
  verifyPdfBlockedInteriorSpan,
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

  it('checks a vertical window gap between reviewed wall bodies', () => {
    const verticalWork: PdfLinework = {
      ...work,
      paths: [
        {
          ...wall(1, 0, 10),
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 40 },
            { x: 0, y: 40 },
          ],
        },
        {
          ...wall(2, 0, 10),
          points: [
            { x: 0, y: 60 },
            { x: 10, y: 60 },
            { x: 10, y: 100 },
            { x: 0, y: 100 },
          ],
        },
      ],
    }
    expect(
      verifyPdfPerimeterProbes(
        'sample.pdf',
        verticalWork,
        [{ ...probe, axis: 'depth', side: 'right', at: 5, wallFillOperations: [1, 2] }],
        [
          {
            labelIndex: 7,
            axis: 'depth',
            ends: [
              { x: 5, y: 40 },
              { x: 5, y: 60 },
            ],
          },
        ],
      ),
    ).toEqual({ right: [{ from: 40, to: 60 }] })
  })
})

describe('source-reviewed interior clearance', () => {
  const interiorWork: PdfLinework = {
    ...work,
    paths: [
      {
        ...wall(1, 0, 100),
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 40 },
          { x: 0, y: 40 },
        ],
      },
      {
        ...wall(2, 0, 100),
        points: [
          { x: 0, y: 60 },
          { x: 100, y: 60 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ],
      },
      {
        ...wall(3, 50, 60),
        points: [
          { x: 50, y: 40 },
          { x: 60, y: 40 },
          { x: 60, y: 60 },
          { x: 50, y: 60 },
        ],
      },
    ],
  }
  const span: InteriorSpan = {
    axis: 'depth',
    ends: [
      { x: 25, y: 40 },
      { x: 25, y: 60 },
    ],
    freeProbeAcross: 25,
    blockedProbeAcross: 55,
    blockerWallFillOperation: 3,
  }

  it('does not turn a clear printed width into a through-route past a wall', () => {
    expect(() => verifyPdfBlockedInteriorSpan('sample.pdf', interiorWork, span)).not.toThrow()
    expect(() =>
      verifyPdfBlockedInteriorSpan('sample.pdf', interiorWork, {
        ...span,
        blockedProbeAcross: 75,
      }),
    ).toThrow('not clear beside a continuous wall')
  })

  it('rejects a hidden obstruction on the free side', () => {
    const obstructed: PdfLinework = {
      ...interiorWork,
      paths: [
        ...interiorWork.paths,
        {
          ...wall(4, 20, 30),
          points: [
            { x: 20, y: 45 },
            { x: 30, y: 45 },
            { x: 30, y: 55 },
            { x: 20, y: 55 },
          ],
        },
      ],
    }
    expect(() => verifyPdfBlockedInteriorSpan('sample.pdf', obstructed, span)).toThrow(
      'not clear beside a continuous wall',
    )
  })

  it('finds a narrow obstruction between former sample positions', () => {
    const obstructed: PdfLinework = {
      ...interiorWork,
      paths: [
        ...interiorWork.paths,
        {
          ...wall(4, 20, 30),
          points: [
            { x: 20, y: 43 },
            { x: 30, y: 43 },
            { x: 30, y: 44 },
            { x: 20, y: 44 },
          ],
        },
      ],
    }
    expect(() => verifyPdfBlockedInteriorSpan('sample.pdf', obstructed, span)).toThrow(
      'not clear beside a continuous wall',
    )
  })

  it('does not call a notched wall continuous between sample positions', () => {
    const notched: PdfLinework = {
      ...interiorWork,
      paths: interiorWork.paths.map((path) =>
        path.operationIndex === 3
          ? {
              ...path,
              points: [
                { x: 50, y: 40 },
                { x: 60, y: 40 },
                { x: 60, y: 60 },
                { x: 50, y: 60 },
                { x: 50, y: 44 },
                { x: 57, y: 44 },
                { x: 57, y: 43 },
                { x: 50, y: 43 },
              ],
            }
          : path,
      ),
    }
    expect(() => verifyPdfBlockedInteriorSpan('sample.pdf', notched, span)).toThrow(
      'not clear beside a continuous wall',
    )
  })
})
