import type { PlanPageContours } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import type { PdfLinework, PdfVectorPath } from './plan-pdf-linework'
import {
  inspectPlanPagePaintedWallSolids,
  supportsOnPaintedBodyBoundary,
} from './plan-pdf-painted-solids'

const source = { sha256: 'a'.repeat(64), pdfPage: 1, state: 'existing' as const }
const rect = (left: number, top: number, right: number, bottom: number) => [
  { x: left, y: top },
  { x: right, y: top },
  { x: right, y: bottom },
  { x: left, y: bottom },
]

function fixture() {
  const contours: PlanPageContours = {
    source,
    coordinateSystem: 'page-0-1000',
    review: 'manual-source-review',
    pageWidth: 1000,
    pageHeight: 1000,
    rooms: [{ roomSourceNumber: 1, polygon: rect(100, 100, 200, 300) }],
    exterior: { polygon: rect(100, 100, 300, 300) },
  }
  const triangle = (operationIndex: number, points: PdfVectorPath['points']): PdfVectorPath => ({
    operationIndex,
    subpathIndex: 0,
    paint: 'fill-stroke',
    fillColor: '#989898',
    closed: true,
    points,
  })
  const work: PdfLinework = {
    coordinateSystem: 'page-0-1000',
    pageWidth: 1000,
    pageHeight: 1000,
    skippedCurves: 0,
    unsupportedPaths: 0,
    unsupportedContexts: 0,
    clippedPaths: 0,
    truncated: false,
    paths: [
      {
        operationIndex: 1,
        subpathIndex: 0,
        paint: 'stroke',
        closed: true,
        points: rect(100, 100, 200, 300),
      },
      {
        operationIndex: 2,
        subpathIndex: 0,
        paint: 'stroke',
        closed: true,
        points: rect(100, 100, 300, 300),
      },
      triangle(3, [
        { x: 200, y: 100 },
        { x: 220, y: 100 },
        { x: 200, y: 200 },
      ]),
      triangle(4, [
        { x: 220, y: 100 },
        { x: 220, y: 200 },
        { x: 200, y: 200 },
      ]),
    ],
  }
  return { contours, work, triangle }
}

describe('reviewed PDF paint body audit', () => {
  it('unites only source triangles and preserves their references', () => {
    const { contours, work } = fixture()
    const before = structuredClone({ contours, work })
    const result = inspectPlanPagePaintedWallSolids(work, source, contours, '#989898')
    expect(result?.acceptedSources).toEqual([
      { operationIndex: 3, subpathIndex: 0 },
      { operationIndex: 4, subpathIndex: 0 },
    ])
    expect(result?.body).toHaveLength(1)
    expect(result?.roomFloorConflicts).toEqual([])
    expect(
      supportsOnPaintedBodyBoundary(result?.body ?? [], [
        {
          contourKey: '1',
          wallEdgeIndex: 1,
          start: { x: 200, y: 100 },
          end: { x: 200, y: 200 },
          sourceSegments: [],
        },
        {
          contourKey: '1',
          wallEdgeIndex: 1,
          start: { x: 220, y: 100 },
          end: { x: 200, y: 200 },
          sourceSegments: [],
        },
      ]),
    ).toEqual([expect.objectContaining({ start: { x: 200, y: 100 }, end: { x: 200, y: 200 } })])
    expect({ contours, work }).toEqual(before)
  })

  it('does not connect gaps or accept the wrong source or color', () => {
    const { contours, work, triangle } = fixture()
    work.paths[3] = triangle(4, [
      { x: 250, y: 100 },
      { x: 270, y: 100 },
      { x: 250, y: 200 },
    ])
    expect(inspectPlanPagePaintedWallSolids(work, source, contours, '#989898')?.body).toHaveLength(
      2,
    )
    expect(inspectPlanPagePaintedWallSolids(work, source, contours, '#222222')?.body).toEqual([])
    expect(
      inspectPlanPagePaintedWallSolids(work, { ...source, pdfPage: 2 }, contours, '#989898'),
    ).toBeUndefined()
  })

  it('reports degenerate, outside, crossing and room-floor paint separately', () => {
    const { contours, work, triangle } = fixture()
    work.paths.push(
      triangle(5, [
        { x: 200, y: 100 },
        { x: 210, y: 100 },
        { x: 220, y: 100 },
      ]),
      triangle(6, [
        { x: 400, y: 100 },
        { x: 420, y: 100 },
        { x: 400, y: 200 },
      ]),
      triangle(7, [
        { x: 290, y: 100 },
        { x: 310, y: 100 },
        { x: 290, y: 200 },
      ]),
      triangle(8, [
        { x: 190, y: 100 },
        { x: 200, y: 100 },
        { x: 190, y: 200 },
      ]),
    )
    const result = inspectPlanPagePaintedWallSolids(work, source, contours, '#989898')
    expect(result?.degenerateSources).toEqual([{ operationIndex: 5, subpathIndex: 0 }])
    expect(result?.outsideSources).toEqual([{ operationIndex: 6, subpathIndex: 0 }])
    expect(result?.crossingSources).toEqual([{ operationIndex: 7, subpathIndex: 0 }])
    expect(result?.roomFloorConflicts).toEqual([
      expect.objectContaining({ contourKey: '1', areaPageSquared: 500 }),
    ])
    expect(result?.acceptedSources).toHaveLength(3)
  })
})
