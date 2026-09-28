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
    paths: [
      wall,
      ...vertices.points.map((point, index) => ({
        ...vertices,
        operationIndex: 100 + index,
        points: [point],
      })),
    ],
    skippedCurves: 0,
    unsupportedPaths: 0,
    unsupportedContexts: 0,
    clippedPaths: 0,
    truncated: false,
  }
  return { contours, work, wall }
}

function slantedSheet() {
  const contours: PlanPageContours = {
    source,
    coordinateSystem: 'page-0-1000',
    review: 'manual-source-review',
    pageWidth: 1000,
    pageHeight: 1000,
    rooms: [
      {
        roomSourceNumber: 1,
        polygon: [
          { x: 100, y: 100 },
          { x: 200, y: 100 },
          { x: 220, y: 200 },
          { x: 100, y: 200 },
        ],
      },
      {
        roomSourceNumber: 2,
        polygon: [
          { x: 240, y: 100 },
          { x: 340, y: 100 },
          { x: 340, y: 200 },
          { x: 260, y: 200 },
        ],
      },
    ],
  }
  const wall: PdfVectorPath = {
    operationIndex: 10,
    subpathIndex: 0,
    paint: 'stroke',
    closed: true,
    points: [
      { x: 200, y: 100 },
      { x: 240, y: 100 },
      { x: 260, y: 200 },
      { x: 220, y: 200 },
    ],
  }
  const work: PdfLinework = {
    coordinateSystem: 'page-0-1000',
    pageWidth: 1000,
    pageHeight: 1000,
    paths: [
      wall,
      {
        operationIndex: 11,
        subpathIndex: 0,
        paint: 'stroke',
        closed: false,
        points: contours.rooms.flatMap((room) => room.polygon),
      },
    ],
    skippedCurves: 0,
    unsupportedPaths: 0,
    unsupportedContexts: 0,
    clippedPaths: 0,
    truncated: false,
  }
  return { contours, wall, work }
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
  it.each([0, 1, 2])('pairs slanted faces independently of room winding (%s)', (reversed) => {
    const input = slantedSheet()
    const reference = pairPlanPageWallFaces(input.work, source, input.contours)
    if (reversed === 2) {
      for (const room of input.contours.rooms) room.polygon.reverse()
    } else input.contours.rooms[reversed]?.polygon.reverse()
    const pairs = pairPlanPageWallFaces(input.work, source, input.contours)
    const evidence = (values: typeof pairs) =>
      values.map(({ faces }) => faces.map(({ wallEdgeIndex: _index, ...face }) => face))
    expect(pairs).toHaveLength(1)
    expect(evidence(pairs)).toEqual(evidence(reference))
  })

  it.each([false, true])('pairs a native slanted exterior face (reverse=%s)', (reverse) => {
    const input = slantedSheet()
    input.contours.rooms = input.contours.rooms.slice(0, 1)
    input.contours.exterior = {
      polygon: [
        { x: 80, y: 80 },
        { x: 236, y: 80 },
        { x: 264, y: 220 },
        { x: 80, y: 220 },
      ],
    }
    input.wall.points = [
      { x: 200, y: 100 },
      { x: 236, y: 80 },
      { x: 264, y: 220 },
      { x: 220, y: 200 },
    ]
    input.work.paths.push(
      ...input.contours.exterior.polygon.map((point, index) => ({
        operationIndex: 100 + index,
        subpathIndex: 0,
        paint: 'stroke' as const,
        closed: false,
        points: [point],
      })),
    )
    if (reverse) input.contours.exterior.polygon.reverse()
    const before = structuredClone(input)
    const pairs = pairPlanPageWallFaces(input.work, source, input.contours)
    expect(pairs).toHaveLength(1)
    expect(pairs[0]?.faces.map(({ contourKey }) => contourKey)).toEqual(['1', 'exterior'])
    expect(input).toEqual(before)
    input.wall.closed = false
    expect(pairPlanPageWallFaces(input.work, source, input.contours)).toEqual([])
  })

  it.each(['continuous', 'gap', 'shifted', 'reversed', 'duplicate', 'overlong'] as const)(
    'supports separately stroked portions without filling missing evidence: %s',
    (mode) => {
      const input = syntheticSheet()
      input.wall.paint = 'fill'
      const stroke = (id: number, x: number, start: number, end: number): PdfVectorPath => ({
        operationIndex: id,
        subpathIndex: 0,
        paint: 'stroke',
        closed: false,
        points: [
          { x, y: start },
          { x, y: end },
        ],
      })
      input.work.paths.push(
        stroke(501, 220, 100, 190),
        stroke(503, 220, 210, 300),
        stroke(505, 200, mode === 'overlong' ? 90 : 100, 150),
        stroke(506, mode === 'shifted' ? 200.001 : 200, mode === 'gap' ? 160 : 150, 300),
      )
      if (mode === 'reversed') {
        for (const path of input.work.paths.filter((path) => path.operationIndex >= 500))
          path.points.reverse()
        input.work.paths.reverse()
      }
      if (mode === 'duplicate') input.work.paths.push(stroke(507, 200, 150, 300))
      const before = structuredClone(input)
      const pairs = pairPlanPageWallFaces(input.work, source, input.contours)
      const intervals = pairs.flatMap(({ faces }) =>
        faces
          .filter((face) => face.contourKey === '1')
          .map((face) => [face.start.y, face.end.y, face.strokeSegment?.operationIndex]),
      )
      expect(intervals).toEqual(
        mode === 'shifted'
          ? [[100, 150, 505]]
          : [
              [100, 150, 505],
              [mode === 'gap' ? 160 : 150, 190, 506],
              [210, 300, 506],
            ],
      )
      // Adjacent portions retain different witnesses instead of becoming one unprovable span.
      expect(input).toEqual(before)
    },
  )

  it('pairs a filled wall only with exact independently stroked faces and preserves both references', () => {
    const input = syntheticSheet()
    input.wall.paint = 'fill'
    expect(pairPlanPageWallFaces(input.work, source, input.contours)).toEqual([])
    for (const index of [1, 3, 5]) {
      const start = input.wall.points[index]
      const end = input.wall.points[(index + 1) % input.wall.points.length]
      if (!start || !end) throw new Error('Missing source face')
      input.work.paths.push({
        operationIndex: 500 + index,
        subpathIndex: 0,
        paint: 'stroke',
        closed: false,
        points: [start, end],
      })
    }
    const before = structuredClone(input)
    const result = pairPlanPageWallFaces(input.work, source, input.contours)
    expect(result).toHaveLength(2)
    for (const pair of result)
      for (const face of pair.faces) {
        expect(face.nativeSegment.operationIndex).toBe(10)
        expect(face.strokeSegment?.operationIndex).toBe(500 + face.nativeSegment.segmentIndex)
      }
    expect(input).toEqual(before)
    const noStroke = structuredClone(input)
    noStroke.work.paths = noStroke.work.paths.filter((path) => path.operationIndex !== 505)
    expect(pairPlanPageWallFaces(noStroke.work, source, noStroke.contours)).toEqual([])
    const compound = structuredClone(input)
    compound.work.paths.push({
      ...structuredClone(compound.wall),
      subpathIndex: 1,
      points: rectangle(205, 120, 215, 130),
    })
    expect(pairPlanPageWallFaces(compound.work, source, compound.contours)).toEqual([])
    const stroke = input.work.paths.find((path) => path.operationIndex === 505)
    if (!stroke) throw new Error('Missing stroke')
    stroke.points = stroke.points.map((point) => ({ ...point, x: point.x + 0.001 }))
    expect(pairPlanPageWallFaces(input.work, source, input.contours)).toEqual([])
  })
  it('pairs opposite slanted faces only within the same closed native wall outline', () => {
    const input = slantedSheet()
    const before = structuredClone(input)
    const pairs = pairPlanPageWallFaces(input.work, source, input.contours)

    expect(pairs).toHaveLength(1)
    expect(pairs[0]?.faces).toMatchObject([
      {
        contourKey: '1',
        wallEdgeIndex: 1,
        nativeSegment: { operationIndex: 10, segmentIndex: 3 },
      },
      {
        contourKey: '2',
        wallEdgeIndex: 3,
        nativeSegment: { operationIndex: 10, segmentIndex: 1 },
      },
    ])
    expect(input).toEqual(before)
  })

  it.each(['open', 'fill', 'separate', 'compound', 'opening'] as const)(
    'rejects slanted pairs without an intact solid outline (%s)',
    (mutation) => {
      const input = slantedSheet()
      if (mutation === 'open') input.wall.closed = false
      if (mutation === 'fill') input.wall.paint = 'fill'
      if (mutation === 'separate') {
        input.work.paths = [
          { ...input.wall, points: input.wall.points.slice(0, 2), closed: false },
          { ...input.wall, operationIndex: 12, points: input.wall.points.slice(2), closed: false },
          input.work.paths[1] as PdfVectorPath,
        ]
      }
      if (mutation === 'compound') {
        input.work.paths.push({
          ...input.wall,
          subpathIndex: 1,
          points: rectangle(210, 130, 220, 160),
        })
      }
      if (mutation === 'opening') {
        const room = input.contours.rooms[0]
        if (!room) throw new Error('Missing synthetic room')
        room.openings = [
          {
            id: 'door',
            kind: 'door',
            wallEdgeIndex: 1,
            start: { x: 204, y: 120 },
            end: { x: 206, y: 130 },
          },
        ]
      }
      expect(pairPlanPageWallFaces(input.work, source, input.contours)).toEqual([])
    },
  )

  it('does not pair slanted faces across a third room inside the outlined strip', () => {
    const input = slantedSheet()
    input.contours.rooms.push({
      roomSourceNumber: 3,
      polygon: rectangle(218, 130, 222, 170),
    })
    const vertices = input.work.paths[1]
    if (!vertices) throw new Error('Missing synthetic contour vertices')
    vertices.points = input.contours.rooms.flatMap((room) => room.polygon)

    expect(pairPlanPageWallFaces(input.work, source, input.contours)).toEqual([])
  })

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

  it('never treats a reviewed conditional divider as a native wall face', () => {
    const input = syntheticSheet()
    const left = input.contours.rooms[0]
    if (!left) throw new Error('Missing synthetic room')
    left.conditionalEdges = [{ wallEdgeIndex: 1 }]
    expect(pairPlanPageWallFaces(input.work, source, input.contours)).toEqual([])
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

    expect(pairs).toHaveLength(52)
    expect(
      pairs
        .find(({ faces }) =>
          faces.some(
            (face) =>
              face.nativeSegment.operationIndex === 737 && face.nativeSegment.segmentIndex === 13,
          ),
        )
        ?.faces.map(({ contourKey, wallEdgeIndex }) => ({ contourKey, wallEdgeIndex })),
    ).toEqual([
      { contourKey: '1+5', wallEdgeIndex: 1 },
      { contourKey: '3', wallEdgeIndex: 3 },
    ])
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
        const direction = { x: end.x - start.x, y: end.y - start.y }
        const length = Math.hypot(direction.x, direction.y)
        for (const point of [face.start, face.end]) {
          const relative = { x: point.x - start.x, y: point.y - start.y }
          const cross = direction.x * relative.y - direction.y * relative.x
          const projection = direction.x * relative.x + direction.y * relative.y
          expect(Math.abs(cross) / length).toBeLessThan(0.01)
          expect(projection / length).toBeGreaterThanOrEqual(-0.01)
          expect(projection / length).toBeLessThanOrEqual(length + 0.01)
        }
      }
      expect(pair).not.toHaveProperty('thicknessCm')
    }
    expect(input).toEqual(before)
  })
})
