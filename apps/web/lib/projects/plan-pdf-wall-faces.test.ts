import type { PlanPageContours, PlanPageOpening } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import page from '../../../../docs/qa/fixtures/apartment-74-77-complete-page.json'
import type { PdfLinework, PdfVectorPath } from './plan-pdf-linework'
import type { PdfPlanSource } from './plan-pdf-room-binding'
import { pairPlanPageWallFaces } from './plan-pdf-wall-faces'

const source = { sha256: 'a'.repeat(64), pdfPage: 1, state: 'existing' as const }

function rectangle(left: number, top: number, right: number, bottom: number) {
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ]
}

function syntheticSheet() {
  const contours: PlanPageContours = {
    source,
    coordinateSystem: 'page-0-1000',
    review: 'manual-source-review',
    pageWidth: 1000,
    pageHeight: 1000,
    rooms: [
      { roomSourceNumber: 1, polygon: rectangle(100, 100, 200, 300) },
      { roomSourceNumber: 2, polygon: rectangle(220, 100, 320, 190) },
      { roomSourceNumber: 3, polygon: rectangle(220, 210, 320, 300) },
    ],
  }
  const wall: PdfVectorPath = {
    operationIndex: 10,
    subpathIndex: 0,
    paint: 'stroke',
    closed: true,
    points: [
      { x: 200, y: 100 },
      { x: 220, y: 100 },
      { x: 220, y: 190 },
      { x: 220, y: 210 },
      { x: 220, y: 300 },
      { x: 200, y: 300 },
    ],
  }
  const vertices: PdfVectorPath = {
    operationIndex: 11,
    subpathIndex: 0,
    paint: 'stroke',
    closed: false,
    points: structuredClone(contours.rooms.flatMap((room) => room.polygon)),
  }
  const work: PdfLinework = {
    coordinateSystem: 'page-0-1000',
    pageWidth: 1000,
    pageHeight: 1000,
    paths: [wall, vertices],
    skippedCurves: 0,
    unsupportedPaths: 0,
    unsupportedContexts: 0,
    clippedPaths: 0,
    truncated: false,
  }
  return { contours, work, wall }
}

function completePageSheet() {
  const source = {
    sha256: page.source.sha256,
    pdfPage: page.source.pdfPage,
    state: 'existing' as const,
  }
  const contours: PlanPageContours = {
    source,
    coordinateSystem: 'page-0-1000',
    review: 'manual-source-review',
    pageWidth: page.pageWidth,
    pageHeight: page.pageHeight,
    exterior: { polygon: structuredClone(page.apartmentEnvelope.polygon) },
    rooms: page.rooms.map((room) => ({
      ...(room.roomSourceNumbers
        ? { roomSourceNumbers: [...room.roomSourceNumbers] }
        : { roomSourceNumber: room.roomSourceNumber as number }),
      polygon: structuredClone(room.polygon),
      openings: room.openings.map((opening) => ({
        id: opening.id,
        kind: opening.kind as PlanPageOpening['kind'],
        wallEdgeIndex: opening.wallEdgeIndex,
        start: { ...opening.start },
        end: { ...opening.end },
        ...('endpointProofs' in opening
          ? { endpointProofs: opening.endpointProofs as PlanPageOpening['endpointProofs'] }
          : {}),
      })),
    })),
  }
  const work: PdfLinework = {
    coordinateSystem: 'page-0-1000',
    pageWidth: page.pageWidth,
    pageHeight: page.pageHeight,
    paths: structuredClone(page.nativePaths) as PdfVectorPath[],
    ...page.nativeLayer,
  }
  return { source, contours, work }
}

describe('exact native PDF wall-face intervals', () => {
  it('keeps a long face paired to two shorter opposing faces only where both exist', () => {
    const input = syntheticSheet()
    const before = structuredClone(input)
    const pairs = pairPlanPageWallFaces(input.work, source, input.contours)

    expect(pairs).toHaveLength(2)
    expect(
      pairs.map(({ faces }) =>
        faces.map(({ contourKey, wallEdgeIndex, start, end, nativeSegment }) => ({
          contourKey,
          wallEdgeIndex,
          start,
          end,
          nativeSegment,
        })),
      ),
    ).toEqual([
      [
        {
          contourKey: '1',
          wallEdgeIndex: 1,
          start: { x: 200, y: 100 },
          end: { x: 200, y: 190 },
          nativeSegment: { operationIndex: 10, subpathIndex: 0, segmentIndex: 5 },
        },
        {
          contourKey: '2',
          wallEdgeIndex: 3,
          start: { x: 220, y: 100 },
          end: { x: 220, y: 190 },
          nativeSegment: { operationIndex: 10, subpathIndex: 0, segmentIndex: 1 },
        },
      ],
      [
        {
          contourKey: '1',
          wallEdgeIndex: 1,
          start: { x: 200, y: 210 },
          end: { x: 200, y: 300 },
          nativeSegment: { operationIndex: 10, subpathIndex: 0, segmentIndex: 5 },
        },
        {
          contourKey: '3',
          wallEdgeIndex: 3,
          start: { x: 220, y: 210 },
          end: { x: 220, y: 300 },
          nativeSegment: { operationIndex: 10, subpathIndex: 0, segmentIndex: 3 },
        },
      ],
    ])
    expect(input).toEqual(before)
    expect(pairs[0]).not.toHaveProperty('thicknessCm')
  })

  it('subtracts declared openings from both face intervals', () => {
    const input = syntheticSheet()
    input.contours.rooms = input.contours.rooms.slice(0, 2)
    const left = input.contours.rooms[0]
    const right = input.contours.rooms[1]
    if (!left || !right) throw new Error('Missing synthetic rooms')
    left.polygon = rectangle(100, 100, 200, 190)
    left.openings = [
      {
        id: 'left-door',
        kind: 'door',
        wallEdgeIndex: 1,
        start: { x: 200, y: 140 },
        end: { x: 200, y: 160 },
      },
    ]
    right.openings = [
      {
        id: 'right-door',
        kind: 'door',
        wallEdgeIndex: 3,
        start: { x: 220, y: 140 },
        end: { x: 220, y: 160 },
      },
    ]
    input.wall.points = [
      { x: 200, y: 100 },
      { x: 220, y: 100 },
      { x: 220, y: 140 },
      { x: 220, y: 160 },
      { x: 220, y: 190 },
      { x: 200, y: 190 },
      { x: 200, y: 160 },
      { x: 200, y: 140 },
    ]
    const vertices = input.work.paths[1]
    if (!vertices) throw new Error('Missing synthetic contour vertices')
    vertices.points = input.contours.rooms.flatMap((room) => room.polygon)
    const spans = pairPlanPageWallFaces(input.work, source, input.contours).map((pair) => [
      pair.faces[0].start.y,
      pair.faces[0].end.y,
    ])
    expect(spans).toEqual([
      [100, 140],
      [160, 190],
    ])
  })

  it.each(['open', 'fill', 'separate'] as const)(
    'requires one stroked closed outline for both faces (%s)',
    (mutation) => {
      const input = syntheticSheet()
      if (mutation === 'open') input.wall.closed = false
      if (mutation === 'fill') input.wall.paint = 'fill'
      if (mutation === 'separate') {
        input.work.paths = [
          {
            ...input.wall,
            points: rectangle(200, 100, 205, 300),
          },
          {
            ...input.wall,
            operationIndex: 12,
            points: rectangle(215, 100, 220, 300),
          },
          input.work.paths[1] as PdfVectorPath,
        ]
      }
      expect(pairPlanPageWallFaces(input.work, source, input.contours)).toEqual([])
    },
  )

  it('rejects a wide native bridge through another room while retaining the narrow wall', () => {
    const input = syntheticSheet()
    input.contours.rooms = [
      { roomSourceNumber: 1, polygon: rectangle(100, 100, 200, 200) },
      { roomSourceNumber: 2, polygon: rectangle(210, 100, 215, 200) },
      { roomSourceNumber: 3, polygon: rectangle(220, 100, 320, 200) },
    ]
    input.work.paths = [
      { ...input.wall, points: rectangle(200, 100, 210, 200) },
      { ...input.wall, operationIndex: 12, points: rectangle(200, 100, 220, 200) },
      {
        operationIndex: 11,
        subpathIndex: 0,
        paint: 'stroke',
        closed: false,
        points: input.contours.rooms.flatMap((room) => room.polygon),
      },
    ]

    const pairs = pairPlanPageWallFaces(input.work, source, input.contours)
    expect(pairs).toHaveLength(1)
    expect(
      pairs[0]?.faces.map(({ contourKey, start, end }) => ({ contourKey, start, end })),
    ).toEqual([
      {
        contourKey: '1',
        start: { x: 200, y: 100 },
        end: { x: 200, y: 200 },
      },
      {
        contourKey: '2',
        start: { x: 210, y: 100 },
        end: { x: 210, y: 200 },
      },
    ])

    input.work.paths = input.work.paths.filter((path) => path.operationIndex !== 10)
    expect(pairPlanPageWallFaces(input.work, source, input.contours)).toEqual([])
  })

  it('keeps only the solid portion of a concave native wall outline', () => {
    const input = syntheticSheet()
    input.contours.rooms = [
      { roomSourceNumber: 1, polygon: rectangle(100, 100, 200, 200) },
      { roomSourceNumber: 2, polygon: rectangle(220, 100, 320, 200) },
    ]
    input.wall.points = [
      { x: 200, y: 100 },
      { x: 205, y: 100 },
      { x: 205, y: 150 },
      { x: 215, y: 150 },
      { x: 215, y: 100 },
      { x: 220, y: 100 },
      { x: 220, y: 200 },
      { x: 200, y: 200 },
    ]
    const vertices = input.work.paths[1]
    if (!vertices) throw new Error('Missing synthetic contour vertices')
    vertices.points = input.contours.rooms.flatMap((room) => room.polygon)

    const pairs = pairPlanPageWallFaces(input.work, source, input.contours)
    expect(pairs).toHaveLength(1)
    expect(pairs[0]?.faces.map(({ start, end }) => [start.y, end.y])).toEqual([
      [150, 200],
      [150, 200],
    ])
  })

  it('does not treat a compound operation with an inner closed loop as solid wall proof', () => {
    const input = syntheticSheet()
    input.work.paths.push({
      operationIndex: input.wall.operationIndex,
      subpathIndex: 1,
      paint: 'stroke',
      closed: true,
      points: rectangle(205, 120, 215, 180),
    })

    expect(pairPlanPageWallFaces(input.work, source, input.contours)).toEqual([])
  })

  it('does not multiply relations when another operation redraws the same outline', () => {
    const input = syntheticSheet()
    const before = pairPlanPageWallFaces(input.work, source, input.contours)
    input.work.paths.push({ ...structuredClone(input.wall), operationIndex: 12 })

    expect(pairPlanPageWallFaces(input.work, source, input.contours)).toEqual(before)
  })

  it.each([
    'nonnative-vertex',
    'different-hash',
    'proposed',
    'truncated',
    'unsupported',
    'clipped',
  ] as const)('refuses %s evidence', (mutation) => {
    const input = syntheticSheet()
    let inputSource: PdfPlanSource = source
    if (mutation === 'nonnative-vertex') {
      const vertex = input.contours.rooms[0]?.polygon[0]
      if (!vertex) throw new Error('Missing synthetic room vertex')
      vertex.x -= 1
    }
    if (mutation === 'different-hash') inputSource = { ...source, sha256: 'b'.repeat(64) }
    if (mutation === 'proposed') {
      inputSource = { ...source, state: 'proposed' }
      input.contours.source = inputSource
    }
    if (mutation === 'truncated') input.work.truncated = true
    if (mutation === 'unsupported') input.work.unsupportedPaths = 1
    if (mutation === 'clipped') input.work.clippedPaths = 1

    expect(pairPlanPageWallFaces(input.work, inputSource, input.contours)).toEqual([])
  })

  it('returns only source-backed partial relations from the complete apartment page', () => {
    const input = completePageSheet()
    const before = structuredClone(input)
    const pairs = pairPlanPageWallFaces(input.work, input.source, input.contours)

    expect(pairs).toHaveLength(51)
    for (const pair of pairs) {
      expect(pair.faces).toHaveLength(2)
      expect(pair.faces[0].contourKey).not.toBe(pair.faces[1].contourKey)
      expect(pair.faces[0].nativeSegment.operationIndex).toBe(
        pair.faces[1].nativeSegment.operationIndex,
      )
      expect(pair.faces[0].nativeSegment.subpathIndex).toBe(
        pair.faces[1].nativeSegment.subpathIndex,
      )
      for (const face of pair.faces) {
        const path = input.work.paths.find(
          (candidate) =>
            candidate.operationIndex === face.nativeSegment.operationIndex &&
            candidate.subpathIndex === face.nativeSegment.subpathIndex,
        )
        const start = path?.points[face.nativeSegment.segmentIndex]
        const end = path?.points[(face.nativeSegment.segmentIndex + 1) % path.points.length]
        expect(path?.closed).toBe(true)
        expect(path?.paint).not.toBe('fill')
        expect(start).toBeDefined()
        expect(end).toBeDefined()
        if (!start || !end) continue
        const along = start.x === end.x ? 'y' : 'x'
        const across = along === 'x' ? 'y' : 'x'
        expect(face.start[across]).toBe(start[across])
        expect(face.end[across]).toBe(end[across])
        expect(Math.min(start[along], end[along])).toBeLessThanOrEqual(face.start[along])
        expect(Math.max(start[along], end[along])).toBeGreaterThanOrEqual(face.end[along])
      }
      expect(pair).not.toHaveProperty('thicknessCm')
    }
    expect(input).toEqual(before)
  })
})
