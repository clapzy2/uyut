import type { PlanPageContours } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import type { PdfLinework } from './plan-pdf-linework'
import { findPlanPageWallBodySupports } from './plan-pdf-wall-body-support'

const rect = (left: number, top: number, right: number, bottom: number) => [
  { x: left, y: top },
  { x: right, y: top },
  { x: right, y: bottom },
  { x: left, y: bottom },
]
function fixture() {
  const contours: PlanPageContours = {
    source: { sha256: 'a'.repeat(64), pdfPage: 1, state: 'existing' },
    coordinateSystem: 'page-0-1000',
    review: 'manual-source-review',
    pageWidth: 1000,
    pageHeight: 1000,
    rooms: [{ roomSourceNumber: 1, polygon: rect(100, 100, 200, 300) }],
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
    paintBounds: {
      complete: true,
      refusalReason: null,
      events: [
        {
          operationIndex: 1,
          kind: 'vector',
          bounds: { left: 200, top: 150, right: 220, bottom: 250 },
          reason: null,
        },
        {
          operationIndex: 2,
          kind: 'vector',
          bounds: { left: 200, top: 140, right: 200, bottom: 260 },
          reason: null,
        },
      ],
    },
    paths: [
      {
        operationIndex: 1,
        subpathIndex: 0,
        paint: 'fill',
        closed: true,
        points: rect(200, 150, 220, 250),
      },
      {
        operationIndex: 2,
        subpathIndex: 0,
        paint: 'stroke',
        closed: false,
        points: [
          { x: 200, y: 140 },
          { x: 200, y: 260 },
        ],
      },
    ],
  }
  const body = work.paths[0]
  const stroke = work.paths[1]
  const room = contours.rooms[0]
  if (!body || !stroke || !room) throw new Error('Incomplete fixture')
  return { work, contours, body, stroke, room }
}

describe('one-sided native wall-body support', () => {
  it('does not claim visible source support without a complete paint inventory', () => {
    const { work, contours } = fixture()
    work.paintBounds = undefined
    expect(findPlanPageWallBodySupports(work, contours)).toEqual([])
  })
  it('excludes a distant recorded clip but holds touching, unknown and incomplete omissions', () => {
    const { work, contours } = fixture()
    const bounds = { left: 800, top: 800, right: 900, bottom: 900 }
    work.clippedPaths = 1
    work.clippedPathBounds = [{ operationIndex: 10, bounds, paint: 'stroke' }]
    work.paintBounds = {
      complete: true,
      refusalReason: null,
      events: [{ operationIndex: 10, kind: 'vector', bounds, reason: null }],
    }
    expect(findPlanPageWallBodySupports(work, contours)).toHaveLength(1)
    bounds.left = 220
    bounds.top = 200
    expect(findPlanPageWallBodySupports(work, contours)).toEqual([])
    bounds.left = 800
    bounds.top = 800
    const event = work.paintBounds?.events[0]
    if (!event) throw new Error('Missing omission event')
    event.bounds = null
    expect(findPlanPageWallBodySupports(work, contours)).toEqual([])
    event.bounds = bounds
    work.clippedPathBoundsTruncated = true
    expect(findPlanPageWallBodySupports(work, contours)).toEqual([])
    work.clippedPathBoundsTruncated = false
    work.clippedPathBounds = []
    expect(findPlanPageWallBodySupports(work, contours)).toEqual([])
  })
  it('retains exact one-sided fill and independent stroke provenance without mutation', () => {
    const input = fixture()
    const before = structuredClone(input)
    const result = findPlanPageWallBodySupports(input.work, input.contours)
    expect(result).toEqual([
      {
        source: { operationIndex: 1, subpathIndex: 0 },
        nativeSegment: { operationIndex: 1, subpathIndex: 0, segmentIndex: 3 },
        contourKey: '1',
        wallEdgeIndex: 1,
        start: { x: 200, y: 150 },
        end: { x: 200, y: 250 },
        strokeSegment: { operationIndex: 2, subpathIndex: 0, segmentIndex: 0 },
      },
    ])
    expect(input).toEqual(before)
    input.work.paths.reverse()
    expect(findPlanPageWallBodySupports(input.work, input.contours)).toEqual(result)
  })

  it('shows a separately stroked opposite fill face without accepting a second room', () => {
    const { work, contours } = fixture()
    work.paths.push({
      operationIndex: 3,
      subpathIndex: 0,
      paint: 'stroke',
      closed: false,
      points: [
        { x: 220, y: 140 },
        { x: 220, y: 260 },
      ],
    })
    expect(findPlanPageWallBodySupports(work, contours)[0]?.oppositeFace).toEqual({
      start: { x: 220, y: 150 },
      end: { x: 220, y: 250 },
      nativeSegment: { operationIndex: 1, subpathIndex: 0, segmentIndex: 1 },
      strokeSegment: { operationIndex: 3, subpathIndex: 0, segmentIndex: 0 },
    })
    const outerStroke = work.paths.at(-1)
    if (!outerStroke) throw new Error('Missing opposite stroke')
    outerStroke.points[1] = { x: 220, y: 200 }
    expect(findPlanPageWallBodySupports(work, contours)[0]?.oppositeFace).toBeUndefined()
    outerStroke.points[1] = { x: 220.001, y: 260 }
    expect(findPlanPageWallBodySupports(work, contours)[0]?.oppositeFace).toBeUndefined()
    outerStroke.points[1] = { x: 220, y: 260 }
    outerStroke.operationIndex = 0
    expect(findPlanPageWallBodySupports(work, contours)[0]?.oppositeFace).toBeUndefined()
  })

  it('does not show a face whose independent stroke is covered by later paint', () => {
    const { work, contours } = fixture()
    work.paintBounds = {
      complete: true,
      refusalReason: null,
      events: [
        {
          operationIndex: 1,
          kind: 'vector',
          bounds: { left: 200, top: 150, right: 220, bottom: 250 },
          reason: null,
        },
        {
          operationIndex: 2,
          kind: 'vector',
          bounds: { left: 200, top: 140, right: 200, bottom: 260 },
          reason: null,
        },
        {
          operationIndex: 3,
          kind: 'image',
          bounds: { left: 198, top: 145, right: 222, bottom: 255 },
          reason: null,
        },
      ],
    }
    expect(findPlanPageWallBodySupports(work, contours)).toEqual([])
    const cover = work.paintBounds.events[2]
    if (!cover) throw new Error('Missing later paint')
    cover.bounds = { left: 800, top: 800, right: 900, bottom: 900 }
    expect(findPlanPageWallBodySupports(work, contours)).toHaveLength(1)
    cover.bounds = null
    expect(findPlanPageWallBodySupports(work, contours)).toEqual([])
  })

  it('can use a later independent repaint without reviving the covered stroke', () => {
    const { work, contours } = fixture()
    work.paths.push({
      operationIndex: 4,
      subpathIndex: 0,
      paint: 'stroke',
      closed: false,
      points: [
        { x: 200, y: 140 },
        { x: 200, y: 260 },
      ],
    })
    work.paintBounds = {
      complete: true,
      refusalReason: null,
      events: [
        {
          operationIndex: 1,
          kind: 'vector',
          bounds: { left: 200, top: 150, right: 220, bottom: 250 },
          reason: null,
        },
        {
          operationIndex: 2,
          kind: 'vector',
          bounds: { left: 200, top: 140, right: 200, bottom: 260 },
          reason: null,
        },
        {
          operationIndex: 3,
          kind: 'image',
          bounds: { left: 198, top: 145, right: 222, bottom: 255 },
          reason: null,
        },
        {
          operationIndex: 4,
          kind: 'vector',
          bounds: { left: 200, top: 140, right: 200, bottom: 260 },
          reason: null,
        },
      ],
    }
    expect(findPlanPageWallBodySupports(work, contours)).toMatchObject([
      { strokeSegment: { operationIndex: 4 } },
    ])
  })

  it('holds only the opposite face when later paint covers its stroke', () => {
    const { work, contours } = fixture()
    work.paths.push({
      operationIndex: 3,
      subpathIndex: 0,
      paint: 'stroke',
      closed: false,
      points: [
        { x: 220, y: 140 },
        { x: 220, y: 260 },
      ],
    })
    work.paintBounds = {
      complete: true,
      refusalReason: null,
      events: [
        {
          operationIndex: 1,
          kind: 'vector',
          bounds: { left: 200, top: 150, right: 220, bottom: 250 },
          reason: null,
        },
        {
          operationIndex: 2,
          kind: 'vector',
          bounds: { left: 200, top: 140, right: 200, bottom: 260 },
          reason: null,
        },
        {
          operationIndex: 3,
          kind: 'vector',
          bounds: { left: 220, top: 140, right: 220, bottom: 260 },
          reason: null,
        },
        {
          operationIndex: 4,
          kind: 'image',
          bounds: { left: 219, top: 145, right: 221, bottom: 255 },
          reason: null,
        },
      ],
    }
    const support = findPlanPageWallBodySupports(work, contours)
    expect(support).toHaveLength(1)
    expect(support[0]?.oppositeFace).toBeUndefined()
  })

  it('does not infer an opposite face from a non-parallelogram fill', () => {
    const { work, contours, body } = fixture()
    body.points[2] = { x: 221, y: 250 }
    work.paths.push({
      operationIndex: 3,
      subpathIndex: 0,
      paint: 'stroke',
      closed: false,
      points: [
        { x: 220, y: 140 },
        { x: 221, y: 260 },
      ],
    })
    expect(findPlanPageWallBodySupports(work, contours)[0]?.oppositeFace).toBeUndefined()
  })

  it.each(['missing', 'shifted', 'gapped', 'painted-before-fill'] as const)(
    'does not bridge %s stroke evidence',
    (kind) => {
      const { work, contours, stroke } = fixture()
      if (kind === 'missing') work.paths.pop()
      if (kind === 'shifted') stroke.points = stroke.points.map((p) => ({ ...p, x: p.x + 0.001 }))
      if (kind === 'painted-before-fill') stroke.operationIndex = 0
      if (kind === 'gapped') {
        stroke.points = [
          { x: 200, y: 140 },
          { x: 200, y: 199 },
        ]
        work.paths.push({
          ...stroke,
          operationIndex: 3,
          points: [
            { x: 200, y: 201 },
            { x: 200, y: 260 },
          ],
        })
      }
      const result = findPlanPageWallBodySupports(work, contours)
      if (kind === 'gapped') {
        expect(
          result.map(({ start, end, strokeSegment }) => [
            start.y,
            end.y,
            strokeSegment.operationIndex,
          ]),
        ).toEqual([
          [150, 199, 2],
          [201, 250, 3],
        ])
      } else {
        expect(result).toEqual([])
      }
    },
  )

  it('rejects point-only contact', () => {
    const { work, contours, body } = fixture()
    body.points = rect(200, 300, 220, 350)
    expect(findPlanPageWallBodySupports(work, contours)).toEqual([])
  })

  it('rejects same-side material invading room floor', () => {
    const { work, contours, body } = fixture()
    body.points = rect(180, 150, 200, 250)
    expect(findPlanPageWallBodySupports(work, contours)).toEqual([])
  })

  it('rejects compound fill operations rather than guessing hole winding', () => {
    const { work, contours, body } = fixture()
    work.paths.push({ ...body, subpathIndex: 1, points: rect(205, 180, 215, 220) })
    expect(findPlanPageWallBodySupports(work, contours)).toEqual([])
  })

  it('does not treat a conditional room divider as a wall', () => {
    const { work, contours, room } = fixture()
    room.conditionalEdges = [{ wallEdgeIndex: 1 }]
    expect(findPlanPageWallBodySupports(work, contours)).toEqual([])
  })

  it('subtracts annotated opening intervals without bridging them', () => {
    const { work, contours, room } = fixture()
    room.openings = [
      {
        id: 'door',
        kind: 'door',
        wallEdgeIndex: 1,
        start: { x: 200, y: 180 },
        end: { x: 200, y: 220 },
      },
    ]
    expect(
      findPlanPageWallBodySupports(work, contours).map(({ start, end }) => [start.y, end.y]),
    ).toEqual([
      [150, 180],
      [220, 250],
    ])
    const opening = room.openings[0]
    if (!opening) throw new Error('Missing opening')
    opening.start.y = 150
    opening.end.y = 250
    expect(findPlanPageWallBodySupports(work, contours)).toEqual([])
  })

  it('keeps the same side decision when both polygon windings reverse', () => {
    const { work, contours, body, room } = fixture()
    body.points.reverse()
    room.polygon.reverse()
    expect(findPlanPageWallBodySupports(work, contours)).toHaveLength(1)
  })

  it('accepts exactly stroked slanted contact without axis-aligned approximation', () => {
    const { work, contours, room } = fixture()
    const shear = (point: { x: number; y: number }) => ({ x: point.x + point.y, y: point.y })
    room.polygon = room.polygon.map(shear)
    for (const path of work.paths) path.points = path.points.map(shear)
    const result = findPlanPageWallBodySupports(work, contours)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ start: { x: 350, y: 150 }, end: { x: 450, y: 250 } })
  })

  it('does not bridge a small room-to-fill gap', () => {
    const { work, contours, body, stroke } = fixture()
    body.points = body.points.map((point) => ({ ...point, x: point.x + 0.001 }))
    stroke.points = stroke.points.map((point) => ({ ...point, x: point.x + 0.001 }))
    expect(findPlanPageWallBodySupports(work, contours)).toEqual([])
  })

  it('rejects a self-crossing fill even with a stroked edge', () => {
    const { work, contours, body } = fixture()
    body.points = [
      { x: 200, y: 150 },
      { x: 220, y: 250 },
      { x: 220, y: 150 },
      { x: 200, y: 250 },
    ]
    expect(findPlanPageWallBodySupports(work, contours)).toEqual([])
  })

  it('requires a separate paint operation as the independent stroke witness', () => {
    const { work, contours, body, stroke } = fixture()
    stroke.operationIndex = body.operationIndex
    stroke.subpathIndex = 1
    expect(findPlanPageWallBodySupports(work, contours)).toEqual([])
  })

  it('rejects unbounded or truncated input', () => {
    const { work, contours, body } = fixture()
    work.truncated = true
    expect(findPlanPageWallBodySupports(work, contours)).toEqual([])
    work.truncated = false
    work.paths = Array.from({ length: 5001 }, () => body)
    expect(findPlanPageWallBodySupports(work, contours)).toEqual([])
  })
})
