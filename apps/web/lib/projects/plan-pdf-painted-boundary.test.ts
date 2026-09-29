import type { PlanPageContours } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import type { PdfLinework } from './plan-pdf-linework'
import { findPlanPagePaintedBoundarySpans } from './plan-pdf-painted-boundary'
import type { PdfWallCoverageSpan } from './plan-pdf-wall-coverage'

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
    exterior: { polygon: rect(100, 100, 220, 300) },
  }
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
        points: rect(100, 100, 220, 300),
      },
      {
        operationIndex: 3,
        subpathIndex: 0,
        paint: 'fill-stroke',
        fillColor: '#989898',
        closed: true,
        points: [
          { x: 200, y: 100 },
          { x: 220, y: 100 },
          { x: 200, y: 200 },
        ],
      },
      {
        operationIndex: 4,
        subpathIndex: 0,
        paint: 'fill-stroke',
        fillColor: '#989898',
        closed: true,
        points: [
          { x: 200, y: 200 },
          { x: 220, y: 300 },
          { x: 200, y: 300 },
        ],
      },
    ],
  }
  const interior: PdfWallCoverageSpan = {
    contourKey: '1',
    wallEdgeIndex: 1,
    start: { x: 200, y: 100 },
    end: { x: 200, y: 300 },
    status: 'unmatched',
  }
  return { contours, work, interior }
}

describe('exact reviewed-color paint support, not a wall certificate', () => {
  it('covers a room boundary only with source edges on the wall side', () => {
    const { contours, work, interior } = fixture()
    const before = structuredClone({ contours, work, interior })
    const result = findPlanPagePaintedBoundarySpans(work, source, contours, [interior], '#989898')
    expect(result).toEqual([
      {
        contourKey: '1',
        wallEdgeIndex: 1,
        start: interior.start,
        end: interior.end,
        sourceSegments: [
          { operationIndex: 3, subpathIndex: 0, segmentIndex: 2 },
          { operationIndex: 4, subpathIndex: 0, segmentIndex: 2 },
        ],
      },
    ])
    expect({ contours, work, interior }).toEqual(before)
  })

  it('rejects missing paint, a gap, room-floor paint and a wrong source', () => {
    const { contours, work, interior } = fixture()
    expect(findPlanPagePaintedBoundarySpans(work, source, contours, [interior], '#545454')).toEqual(
      [],
    )
    for (const path of work.paths.slice(2)) path.paint = 'fill'
    expect(findPlanPagePaintedBoundarySpans(work, source, contours, [interior], '#989898')).toEqual(
      [],
    )
    for (const path of work.paths.slice(2)) path.paint = 'fill-stroke'
    work.paths.pop()
    expect(findPlanPagePaintedBoundarySpans(work, source, contours, [interior], '#989898')).toEqual(
      [],
    )
    const fragment = work.paths.at(-1)
    if (!fragment) throw new Error('Missing triangle')
    fragment.points[1] = { x: 180, y: 100 }
    expect(findPlanPagePaintedBoundarySpans(work, source, contours, [interior], '#989898')).toEqual(
      [],
    )
    expect(
      findPlanPagePaintedBoundarySpans(
        work,
        { ...source, pdfPage: 2 },
        contours,
        [interior],
        '#989898',
      ),
    ).toEqual([])
  })

  it('does not promote unrelated exterior or slanted spans from nearby paint', () => {
    const { contours, work, interior } = fixture()
    const exterior: PdfWallCoverageSpan = {
      contourKey: 'exterior',
      wallEdgeIndex: 1,
      start: { x: 220, y: 100 },
      end: { x: 220, y: 300 },
      status: 'unpaired-exterior',
    }
    expect(findPlanPagePaintedBoundarySpans(work, source, contours, [exterior], '#989898')).toEqual(
      [],
    )
    work.paths.push({
      operationIndex: 5,
      subpathIndex: 0,
      paint: 'fill-stroke',
      fillColor: '#989898',
      closed: true,
      points: [
        { x: 220, y: 100 },
        { x: 220, y: 300 },
        { x: 210, y: 200 },
      ],
    })
    expect(findPlanPagePaintedBoundarySpans(work, source, contours, [exterior], '#989898')).toEqual(
      [
        expect.objectContaining({
          contourKey: 'exterior',
          sourceSegments: [{ operationIndex: 5, subpathIndex: 0, segmentIndex: 0 }],
        }),
      ],
    )
    expect(
      findPlanPagePaintedBoundarySpans(
        work,
        source,
        contours,
        [{ ...interior, start: { x: 199.999, y: 100 } }],
        '#989898',
      ),
    ).toEqual([])
  })

  it('retains exact support when the reviewed boundary is slanted or reversed', () => {
    const { contours, work, interior } = fixture()
    const shear = (point: { x: number; y: number }) => ({ x: point.x + point.y, y: point.y })
    for (const room of contours.rooms) room.polygon = room.polygon.map(shear)
    if (!contours.exterior) throw new Error('Missing exterior')
    contours.exterior.polygon = contours.exterior.polygon.map(shear)
    for (const path of work.paths) path.points = path.points.map(shear)
    interior.start = shear(interior.start)
    interior.end = shear(interior.end)
    interior.status = 'unsupported-angle'
    expect(
      findPlanPagePaintedBoundarySpans(work, source, contours, [interior], '#989898'),
    ).toHaveLength(1)
    const room = contours.rooms[0]
    if (!room) throw new Error('Missing room')
    room.polygon.reverse()
    expect(
      findPlanPagePaintedBoundarySpans(work, source, contours, [interior], '#989898'),
    ).toHaveLength(1)
  })
})
