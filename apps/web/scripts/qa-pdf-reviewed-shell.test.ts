import { describe, expect, it } from 'vitest'
import type { PdfLinework } from '../lib/projects/plan-pdf-linework'
import { verifyReviewedPdfShell } from './qa-pdf-reviewed-shell'

const wall = (operationIndex: number, points: { x: number; y: number }[]) => ({
  operationIndex,
  subpathIndex: 0,
  paint: 'fill' as const,
  closed: true,
  points,
})
const work: PdfLinework = {
  coordinateSystem: 'page-0-1000',
  pageWidth: 1000,
  pageHeight: 1000,
  paths: [
    wall(1, [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 5 },
      { x: 0, y: 5 },
    ]),
    wall(2, [
      { x: 60, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 5 },
      { x: 60, y: 5 },
    ]),
    wall(3, [
      { x: 100, y: 0 },
      { x: 105, y: 0 },
      { x: 105, y: 100 },
      { x: 100, y: 100 },
    ]),
    wall(4, [
      { x: 0, y: 100 },
      { x: 100, y: 100 },
      { x: 100, y: 105 },
      { x: 0, y: 105 },
    ]),
    wall(5, [
      { x: -5, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: -5, y: 100 },
    ]),
  ],
  skippedCurves: 0,
  unsupportedPaths: 0,
  unsupportedContexts: 0,
  clippedPaths: 0,
  truncated: false,
}
const shell = {
  polygon: [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 60, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ],
  edgeSources: [
    { wallFillOperation: 1 },
    { openingLabelIndex: 7 },
    { wallFillOperation: 2 },
    { wallFillOperation: 3 },
    { wallFillOperation: 4 },
    { wallFillOperation: 5 },
  ],
}
const openings = [
  {
    labelIndex: 7,
    axis: 'width' as const,
    ends: [
      { x: 40, y: -10 },
      { x: 60, y: -10 },
    ] as [{ x: number; y: number }, { x: number; y: number }],
  },
]

describe('source-reviewed open-shell draft', () => {
  it('checks every wall edge and closure while retaining draft status', () => {
    expect(
      verifyReviewedPdfShell(
        'sample.pdf',
        work,
        shell,
        openings,
        {
          widthCmPerPt: 1,
          depthCmPerPt: 1,
        },
        1,
      ),
    ).toMatchObject({
      vertices: 6,
      wallEdges: 5,
      measuredOpeningEdges: 1,
      areaStatus: 'within-rounding',
      contourStatus: 'review-draft',
    })
  })

  it('rejects an invented wall face or omitted opening', () => {
    const wrongWall = { ...shell, edgeSources: [...shell.edgeSources] }
    wrongWall.edgeSources[0] = { wallFillOperation: 2 }
    const scale = { widthCmPerPt: 1, depthCmPerPt: 1 }
    expect(() => verifyReviewedPdfShell('sample.pdf', work, wrongWall, openings, scale, 1)).toThrow(
      'edge leaves its native wall face',
    )
    expect(() => verifyReviewedPdfShell('sample.pdf', work, shell, [], scale, 1)).toThrow()
    expect(() =>
      verifyReviewedPdfShell(
        'sample.pdf',
        work,
        shell,
        [
          {
            labelIndex: 7,
            axis: 'width',
            ends: [
              { x: 41, y: -10 },
              { x: 60, y: -10 },
            ],
          },
        ],
        scale,
        1,
      ),
    ).toThrow('closure disagrees')
  })

  it('reports an area conflict without upgrading the draft', () => {
    expect(
      verifyReviewedPdfShell(
        'sample.pdf',
        work,
        shell,
        openings,
        {
          widthCmPerPt: 1,
          depthCmPerPt: 1,
        },
        0.5,
      ),
    ).toMatchObject({
      areaStatus: 'mismatch',
      contourStatus: 'review-draft',
    })
  })
})
