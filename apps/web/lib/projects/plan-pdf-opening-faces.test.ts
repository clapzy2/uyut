import type { PlanPageContours, PlanPageVertexProof, PlanReading } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import page from '../../../../docs/qa/fixtures/apartment-74-77-complete-page.json'
import { planPageContoursSchema } from './plan-page-review'
import { inspectReviewedPageCoverage } from './plan-page-reviewed-coverage'
import type { PdfLinework, PdfVectorPath } from './plan-pdf-linework'
import { pairPlanPageOpeningFaces, verifyPlanPageOpeningFaces } from './plan-pdf-opening-faces'

function fixture() {
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
      openings: room.openings.map(({ id, kind, wallEdgeIndex, start, end }) => ({
        id,
        kind: kind as 'door' | 'window' | 'balcony',
        wallEdgeIndex,
        start: { ...start },
        end: { ...end },
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

function pairs(input = fixture()) {
  return pairPlanPageOpeningFaces(input.work, input.source, input.contours)
}

function separatelyPaintedFixture() {
  const input = fixture()
  const strokes: PdfVectorPath[] = []
  input.contours.exterior = undefined
  input.contours.rooms = [100, 200].map((top, index) => ({
    roomSourceNumber: index + 1,
    polygon: [
      { x: 25, y: top },
      { x: 125, y: top },
      { x: 125, y: top + 50 },
      { x: 25, y: top + 50 },
    ],
    openings: [
      {
        id: `door-${index}`,
        kind: 'door',
        wallEdgeIndex: index === 0 ? 2 : 0,
        start: { x: 50, y: index === 0 ? 150 : 200 },
        end: { x: 100, y: index === 0 ? 150 : 200 },
      },
    ],
  }))
  input.work.paths = [25, 100].map((left, index) => ({
    operationIndex: index + 1,
    subpathIndex: 0,
    paint: 'stroke',
    closed: true,
    points: [
      { x: left, y: 150 },
      { x: left + 25, y: 150 },
      { x: left + 25, y: 200 },
      { x: left, y: 200 },
    ],
  }))
  input.work.paths.push(
    ...input.contours.rooms
      .flatMap((room) => room.polygon)
      .map((point, index) => ({
        operationIndex: 100 + index,
        subpathIndex: 0,
        paint: 'stroke' as const,
        closed: false,
        points: [point],
      })),
  )
  for (const path of input.work.paths) {
    if (!path.closed || path.paint === 'fill') continue
    path.paint = 'fill'
    for (const [index, start] of path.points.entries()) {
      const end = path.points[(index + 1) % path.points.length]
      if (!end) continue
      strokes.push({
        operationIndex: 10000 + strokes.length,
        subpathIndex: 0,
        closed: false,
        paint: 'stroke',
        points: [{ ...start }, { ...end }],
      })
    }
  }
  input.work.paths.push(...strokes)
  return input
}

function mixedRevealFixture() {
  const input = separatelyPaintedFixture()
  input.work.paths = input.work.paths.filter((path) => path.points.length === 1)
  input.work.paths.push(
    {
      operationIndex: 1,
      subpathIndex: 0,
      paint: 'fill',
      closed: true,
      points: [
        { x: 50, y: 150 },
        { x: 50.15, y: 150 },
        { x: 50.15, y: 200 },
        { x: 50, y: 200 },
      ],
    },
    {
      operationIndex: 2,
      subpathIndex: 0,
      paint: 'fill',
      closed: true,
      points: [
        { x: 100, y: 125 },
        { x: 125, y: 125 },
        { x: 125, y: 225 },
        { x: 100, y: 225 },
      ],
    },
    {
      operationIndex: 10,
      subpathIndex: 0,
      paint: 'stroke',
      closed: false,
      points: [
        { x: 50.15, y: 150 },
        { x: 50.15, y: 200 },
      ],
    },
    {
      operationIndex: 11,
      subpathIndex: 0,
      paint: 'stroke',
      closed: false,
      points: [
        { x: 100, y: 150 },
        { x: 100, y: 200 },
      ],
    },
  )
  return input
}

function exteriorCrossingFixture(kind: PlanPageVertexProof['kind']) {
  const input = mixedRevealFixture()
  const segments: PlanPageVertexProof['segments'] = [
    {
      operationIndex: 20_000,
      subpathIndex: 0,
      segmentIndex: 0,
      start: kind === 'bounded-native-crossing' ? { x: 5, y: 10 } : { x: 5, y: 5 },
      end: kind === 'bounded-native-crossing' ? { x: 15, y: 10 } : { x: 15, y: 15 },
    },
    {
      operationIndex: 20_001,
      subpathIndex: 0,
      segmentIndex: 0,
      start: kind === 'bounded-native-crossing' ? { x: 10, y: 5 } : { x: 5, y: 15 },
      end: kind === 'bounded-native-crossing' ? { x: 10, y: 15 } : { x: 15, y: 5 },
    },
  ]
  const polygon = [
    { x: 10, y: 10 },
    { x: 140, y: 10 },
    { x: 140, y: 260 },
    { x: 10, y: 260 },
  ]
  const proof: PlanPageVertexProof =
    kind === 'bounded-native-crossing'
      ? { kind, vertexIndex: 0, segments: structuredClone(segments) }
      : {
          kind,
          vertexIndex: 0,
          segments: structuredClone(segments),
          exactPointKey: '10/1:10/1',
        }
  input.contours.exterior = { polygon, vertexProofs: [proof] }
  input.work.paths.push(
    ...segments.map((segment) => ({
      operationIndex: segment.operationIndex,
      subpathIndex: segment.subpathIndex,
      paint: 'stroke' as const,
      closed: false,
      points: [segment.start, segment.end],
    })),
    ...polygon.slice(1).map((point, index) => ({
      operationIndex: 20_002 + index,
      subpathIndex: 0,
      paint: 'stroke' as const,
      closed: false,
      points: [point],
    })),
  )
  return input
}

function addThirdRoom(input: ReturnType<typeof fixture>, polygon: PdfVectorPath['points']) {
  input.contours.rooms.push({ roomSourceNumber: 3, polygon })
  input.work.paths.push({
    operationIndex: 99999,
    subpathIndex: 0,
    paint: 'stroke',
    closed: true,
    points: polygon,
  })
}

function swapAxes(input: ReturnType<typeof fixture>) {
  const swap = (point: { x: number; y: number }) => ({ x: point.y, y: point.x })
  for (const room of input.contours.rooms) {
    room.polygon = room.polygon.map(swap)
    for (const opening of room.openings ?? []) {
      opening.start = swap(opening.start)
      opening.end = swap(opening.end)
    }
  }
  for (const path of input.work.paths) path.points = path.points.map(swap)
  const width = input.work.pageWidth
  input.work.pageWidth = input.work.pageHeight
  input.work.pageHeight = width
  input.contours.pageWidth = input.work.pageWidth
  input.contours.pageHeight = input.work.pageHeight
}

describe('physical door face candidates from two native reveals', () => {
  it('holds a jamb hidden by later paint without rejecting a distant fill or its own outline', () => {
    const input = mixedRevealFixture()
    const sourcePaint = [
      { operationIndex: 1, left: 50, right: 50.15 },
      { operationIndex: 2, left: 100, right: 125 },
      { operationIndex: 10, left: 50.15, right: 50.15 },
      { operationIndex: 11, left: 100, right: 100 },
    ]
    input.work.paintBounds = {
      complete: true,
      refusalReason: null,
      events: sourcePaint.map(({ operationIndex, left, right }) => ({
        operationIndex,
        kind: 'vector' as const,
        bounds: { left, top: 125, right, bottom: 225 },
        reason: null,
      })),
    }
    expect(pairs(input)).toHaveLength(1)

    const laterFill: PdfVectorPath = {
      operationIndex: 200,
      subpathIndex: 0,
      paint: 'fill',
      closed: true,
      points: [
        { x: 49, y: 140 },
        { x: 51, y: 140 },
        { x: 51, y: 210 },
        { x: 49, y: 210 },
      ],
    }
    input.work.paths.push(laterFill)
    input.work.paintBounds.events.push({
      operationIndex: 200,
      kind: 'vector',
      bounds: { left: 49, top: 140, right: 51, bottom: 210 },
      reason: null,
    })
    expect(pairs(input)).toEqual([])
    expect(verifyPlanPageOpeningFaces(input.work, input.source, input.contours)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'unresolved', reason: 'painted-over-native-jamb' }),
      ]),
    )

    laterFill.points = [
      { x: 500, y: 500 },
      { x: 510, y: 500 },
      { x: 510, y: 510 },
      { x: 500, y: 510 },
    ]
    const laterEvent = input.work.paintBounds.events[4]
    if (!laterEvent) throw new Error('Missing later paint event')
    laterEvent.bounds = {
      left: 500,
      top: 500,
      right: 510,
      bottom: 510,
    }
    expect(pairs(input)).toHaveLength(1)
  })

  it.each(['bounded-native-crossing', 'bounded-native-rational-crossing'] as const)(
    'retains native jamb pairs inside an exterior with a fresh %s proof',
    (kind) => {
      const input = exteriorCrossingFixture(kind)
      const before = structuredClone(input)
      expect(pairs(input)).toHaveLength(1)
      expect(input).toEqual(before)
    },
  )

  it.each([
    'missing-proof',
    'stale-source',
    'stale-snapshot',
    'missing-segment',
    'wrong-exact-key',
    'noncanonical-exact-key',
    'duplicate-source-reference',
  ] as const)('holds jamb candidates when exterior crossing evidence has %s', (mutation) => {
    const input = exteriorCrossingFixture('bounded-native-rational-crossing')
    const exterior = input.contours.exterior
    const proof = exterior?.vertexProofs?.[0]
    const path = input.work.paths.find((item) => item.operationIndex === 20_000)
    if (!exterior || !proof || !path) throw new Error('Missing exterior crossing fixture')
    if (mutation === 'missing-proof') exterior.vertexProofs = undefined
    else if (mutation === 'stale-source') path.points[0] = { x: 6, y: 5 }
    else if (mutation === 'stale-snapshot') proof.segments[0].start.x = 6
    else if (mutation === 'missing-segment')
      input.work.paths = input.work.paths.filter((item) => item.operationIndex !== 20_000)
    else if (mutation === 'duplicate-source-reference') input.work.paths.push(structuredClone(path))
    else if (proof.kind === 'bounded-native-rational-crossing')
      proof.exactPointKey = mutation === 'wrong-exact-key' ? '11/1:10/1' : '20/2:20/2'
    expect(verifyPlanPageOpeningFaces(input.work, input.source, input.contours)).toEqual([
      {
        roomSourceNumber: 1,
        openingId: 'door-0',
        status: 'unresolved',
        reason: 'non-native-contour-vertex',
      },
      {
        roomSourceNumber: 2,
        openingId: 'door-1',
        status: 'unresolved',
        reason: 'non-native-contour-vertex',
      },
    ])
    expect(pairs(input)).toEqual([])
  })

  it('accepts two native reveals painted with a hairline fill and a backed partial stroke', () => {
    const input = mixedRevealFixture()
    const before = structuredClone(input)
    const result = pairs(input)
    expect(result).toHaveLength(1)
    expect(result[0]?.jambs.map((jamb) => jamb.strokeSegment?.operationIndex)).toEqual([10, 11])
    expect(input).toEqual(before)
  })

  it.each(['missing-stroke', 'shifted-stroke', 'wide-fill', 'unsupported-stroke'] as const)(
    'rejects a mixed reveal with %s',
    (mutation) => {
      const input = mixedRevealFixture()
      const stroke = input.work.paths.find((path) => path.operationIndex === 10)
      const fill = input.work.paths.find((path) => path.operationIndex === 1)
      const backing = input.work.paths.find((path) => path.operationIndex === 2)
      if (!stroke || !fill || !backing) throw new Error('Missing reveal test path')
      if (mutation === 'missing-stroke') {
        input.work.paths = input.work.paths.filter((path) => path.operationIndex !== 10)
      } else if (mutation === 'shifted-stroke') {
        stroke.points = stroke.points.map((point) => ({ ...point, x: point.x + 0.001 }))
      } else if (mutation === 'wide-fill') {
        fill.points = fill.points.map((point) =>
          point.x === 50.15 ? { ...point, x: 50.5 } : point,
        )
        stroke.points = stroke.points.map((point) => ({ ...point, x: 50.5 }))
      } else {
        backing.points = backing.points.map((point) =>
          point.x === 100 ? { ...point, x: 100.01 } : point,
        )
      }
      expect(pairs(input)).toEqual([])
    },
  )

  it('preserves both fill and stroke evidence for independently painted reveals', () => {
    const input = separatelyPaintedFixture()
    const before = structuredClone(input)
    const result = pairs(input)
    expect(result).toHaveLength(1)
    for (const pair of result)
      for (const jamb of pair.jambs) {
        expect(jamb.strokeSegment).toBeDefined()
        const stroke = input.work.paths.find(
          (path) => path.operationIndex === jamb.strokeSegment?.operationIndex,
        )
        expect(stroke?.points).toEqual([jamb.start, jamb.end])
      }
    expect(input).toEqual(before)
  })
  it.each(['centered', 'off-center'])(
    'does not connect door faces through a %s intervening source room',
    (position) => {
      const input = separatelyPaintedFixture()
      expect(pairs(input)).toHaveLength(1)
      const polygon =
        position === 'centered'
          ? [
              { x: 60, y: 170 },
              { x: 90, y: 170 },
              { x: 90, y: 180 },
              { x: 60, y: 180 },
            ]
          : [
              { x: 51, y: 151 },
              { x: 53, y: 151 },
              { x: 53, y: 153 },
              { x: 51, y: 153 },
            ]
      addThirdRoom(input, polygon)
      const before = structuredClone(input)
      expect(pairs(input)).toEqual([])
      expect(verifyPlanPageOpeningFaces(input.work, input.source, input.contours)).toEqual([
        expect.objectContaining({ status: 'unresolved', reason: 'opening-strip-overlaps-room' }),
        expect.objectContaining({ status: 'unresolved', reason: 'opening-strip-overlaps-room' }),
      ])
      expect(input).toEqual(before)
    },
  )
  it.each(['whole-strip', 'crossing-edges', 'boundary-contact'])(
    'uses full polygon intersection rather than a midpoint for %s',
    (position) => {
      const input = separatelyPaintedFixture()
      const polygon =
        position === 'whole-strip'
          ? [
              { x: 25, y: 150 },
              { x: 125, y: 150 },
              { x: 125, y: 200 },
              { x: 25, y: 200 },
            ]
          : position === 'crossing-edges'
            ? [
                { x: 25, y: 155 },
                { x: 125, y: 155 },
                { x: 125, y: 156 },
                { x: 25, y: 156 },
              ]
            : [
                { x: 40, y: 170 },
                { x: 50, y: 170 },
                { x: 50, y: 180 },
                { x: 40, y: 180 },
              ]
      addThirdRoom(input, polygon)
      expect(pairs(input)).toHaveLength(position === 'boundary-contact' ? 1 : 0)
    },
  )
  it('does not pair through a concave part of one of the two declared neighbours', () => {
    const input = separatelyPaintedFixture()
    const first = input.contours.rooms[0]
    const door = first?.openings?.[0]
    if (!first || !door) throw new Error('Missing door face')
    first.polygon = [
      { x: 25, y: 100 },
      { x: 135, y: 100 },
      { x: 135, y: 185 },
      { x: 90, y: 185 },
      { x: 90, y: 170 },
      { x: 125, y: 170 },
      { x: 125, y: 150 },
      { x: 25, y: 150 },
    ]
    door.wallEdgeIndex = 6
    input.work.paths.push({
      operationIndex: 99999,
      subpathIndex: 0,
      paint: 'stroke',
      closed: true,
      points: first.polygon,
    })
    expect(pairs(input)).toEqual([])
    expect(verifyPlanPageOpeningFaces(input.work, input.source, input.contours)[0]).toMatchObject({
      status: 'unresolved',
      reason: 'opening-strip-overlaps-room',
    })
  })
  it('does not pair across a declared no-floor void in the source strip', () => {
    const input = separatelyPaintedFixture()
    const polygon = [
      { x: 60, y: 170 },
      { x: 90, y: 170 },
      { x: 90, y: 180 },
      { x: 60, y: 180 },
    ]
    input.contours.voids = [{ id: 'void-in-strip', polygon }]
    input.work.paths.push({
      operationIndex: 99999,
      subpathIndex: 0,
      paint: 'stroke',
      closed: true,
      points: polygon,
    })
    expect(pairs(input)).toEqual([])
    expect(verifyPlanPageOpeningFaces(input.work, input.source, input.contours)[0]).toMatchObject({
      status: 'unresolved',
      reason: 'opening-strip-overlaps-void',
    })
  })
  it.each(['exterior', 'floor'] as const)(
    'does not connect through a known outside notch in the declared %s boundary',
    (kind) => {
      const input = separatelyPaintedFixture()
      const polygon = [
        { x: 25, y: 100 },
        { x: 125, y: 100 },
        { x: 125, y: 250 },
        { x: 25, y: 250 },
        { x: 25, y: 200 },
        { x: 110, y: 200 },
        { x: 110, y: 150 },
        { x: 25, y: 150 },
      ]
      input.work.paths.push({
        operationIndex: 99999,
        subpathIndex: 0,
        paint: 'stroke',
        closed: true,
        points: polygon,
      })
      if (kind === 'exterior')
        input.contours.exterior = { boundaryRole: 'outer-wall-envelope', polygon }
      else {
        const envelope = [
          { x: 25, y: 100 },
          { x: 125, y: 100 },
          { x: 125, y: 250 },
          { x: 25, y: 250 },
        ]
        input.contours.exterior = { boundaryRole: 'outer-wall-envelope', polygon: envelope }
        input.contours.floor = { polygon }
      }
      expect(planPageContoursSchema.safeParse(input.contours).success).toBe(true)
      expect(pairs(input)).toEqual([])
      expect(verifyPlanPageOpeningFaces(input.work, input.source, input.contours)[0]).toMatchObject(
        {
          status: 'unresolved',
          reason: `opening-strip-outside-${kind}`,
        },
      )
    },
  )
  it('retains a strip within the declared boundary, including contact along a jamb', () => {
    const input = separatelyPaintedFixture()
    const polygon = [
      { x: 25, y: 100 },
      { x: 125, y: 100 },
      { x: 125, y: 250 },
      { x: 25, y: 250 },
      { x: 25, y: 200 },
      { x: 50, y: 200 },
      { x: 50, y: 150 },
      { x: 25, y: 150 },
    ]
    input.contours.exterior = { boundaryRole: 'outer-wall-envelope', polygon }
    input.work.paths.push({
      operationIndex: 99999,
      subpathIndex: 0,
      paint: 'stroke',
      closed: true,
      points: polygon,
    })
    expect(pairs(input)).toHaveLength(1)
  })
  it.each([false, true])(
    'keeps the same direct-neighbour rule on swapped axes: %s',
    (transpose) => {
      const input = separatelyPaintedFixture()
      if (transpose) swapAxes(input)
      expect(pairs(input)).toHaveLength(1)
      const polygon = [
        { x: 60, y: 170 },
        { x: 90, y: 170 },
        { x: 90, y: 180 },
        { x: 60, y: 180 },
      ]
      addThirdRoom(
        input,
        transpose ? polygon.map((point) => ({ x: point.y, y: point.x })) : polygon,
      )
      expect(pairs(input)).toEqual([])
      expect(
        verifyPlanPageOpeningFaces(input.work, input.source, input.contours).every(
          (check) => check.status === 'unresolved',
        ),
      ).toBe(true)
    },
  )
  it('does not count the false pair in the same-source saved review report', () => {
    const input = separatelyPaintedFixture()
    addThirdRoom(input, [
      { x: 60, y: 170 },
      { x: 90, y: 170 },
      { x: 90, y: 180 },
      { x: 60, y: 180 },
    ])
    const reading: PlanReading = {
      readAt: '2026-10-10',
      sourcePage: input.source.pdfPage,
      planState: 'existing',
      rooms: input.contours.rooms.map((room) => ({
        name: `Комната ${room.roomSourceNumber}`,
        sourceNumber: room.roomSourceNumber,
        kind: 'living',
      })),
    }
    const report = inspectReviewedPageCoverage({ ...input, reading, linework: input.work })
    expect(report.status).toBe('partial')
    expect(report.openings).toMatchObject({
      declaredDoors: 2,
      doorPairCandidates: 0,
      pairedDoorFaces: 0,
      unresolvedDoorChecks: 2,
    })
    expect(report.issues).toContain('door-face-pairing-partial')
    expect(report.readiness).toEqual({ readOnly: true, readyFor2D: false, readyFor3D: false })
  })
  it('keeps an intervening-room refusal when contour order, winding and source directions change', () => {
    const input = separatelyPaintedFixture()
    addThirdRoom(input, [
      { x: 60, y: 170 },
      { x: 90, y: 170 },
      { x: 90, y: 180 },
      { x: 60, y: 180 },
    ])
    input.contours.rooms.reverse()
    for (const room of input.contours.rooms) {
      room.polygon.reverse()
      for (const opening of room.openings ?? []) {
        opening.wallEdgeIndex =
          (room.polygon.length - 2 - opening.wallEdgeIndex + room.polygon.length) %
          room.polygon.length
        const start = opening.start
        opening.start = opening.end
        opening.end = start
      }
    }
    for (const path of input.work.paths) path.points.reverse()
    expect(pairs(input)).toEqual([])
    expect(
      verifyPlanPageOpeningFaces(input.work, input.source, input.contours).every(
        (check) => check.status === 'unresolved' && check.reason === 'opening-strip-overlaps-room',
      ),
    ).toBe(true)
  })
  it('withholds all matches on the strip work limit instead of retaining earlier partial pairs', () => {
    // Deliberately adversarial synthetic inventory, not a surveyed apartment or floor acceptance.
    const source = { sha256: 'a'.repeat(64), pdfPage: 1, state: 'existing' as const }
    const rooms: PlanPageContours['rooms'] = Array.from({ length: 100 }, (_, index) => {
      const top = 5 + index * 9
      const bottom = top + 4
      const polygon = [
        { x: 25, y: top },
        { x: 125, y: top },
      ]
      for (let part = 1; part <= 7; part++) polygon.push({ x: 125, y: top + (4 * part) / 7 })
      polygon.push({ x: 25, y: bottom })
      for (let part = 1; part <= 6; part++) polygon.push({ x: 25, y: bottom - (4 * part) / 7 })
      return {
        roomSourceNumber: index + 1,
        polygon,
        openings: [
          {
            id: `top-${index}`,
            kind: 'door',
            wallEdgeIndex: 0,
            start: { x: 50, y: top },
            end: { x: 100, y: top },
          },
          {
            id: `bottom-${index}`,
            kind: 'door',
            wallEdgeIndex: 8,
            start: { x: 50, y: bottom },
            end: { x: 100, y: bottom },
          },
        ],
      }
    })
    const paths: PdfVectorPath[] = rooms.map((room, index) => ({
      operationIndex: index,
      subpathIndex: 0,
      paint: 'stroke',
      closed: true,
      points: room.polygon,
    }))
    let count = 0
    for (let first = 0; first < 100 && count < 3400; first++) {
      for (let second = first + 1; second < 100 && count < 3400; second++) {
        const start = 9 + first * 9
        const end = 5 + second * 9
        const points = [
          { x: 50, y: start },
          { x: 50, y: end },
          { x: 100, y: end },
          { x: 100, y: start },
        ]
        if (count % 2 === 0)
          paths.push({
            operationIndex: 1000 + count,
            subpathIndex: 0,
            paint: 'stroke',
            closed: true,
            points,
          })
        else paths.at(-1)?.points.push(...points)
        count++
      }
    }
    const work: PdfLinework = {
      coordinateSystem: 'page-0-1000',
      pageWidth: 1000,
      pageHeight: 1000,
      paths,
      skippedCurves: 0,
      clippedPaths: 0,
      unsupportedPaths: 0,
      unsupportedContexts: 0,
      truncated: false,
    }
    const contours: PlanPageContours = {
      source,
      coordinateSystem: 'page-0-1000',
      review: 'manual-source-review',
      pageWidth: 1000,
      pageHeight: 1000,
      rooms,
    }
    const checks = verifyPlanPageOpeningFaces(work, source, contours)
    expect(planPageContoursSchema.safeParse(contours).success).toBe(true)
    expect(checks).toHaveLength(200)
    expect(
      checks.every(
        (check) => check.status === 'unresolved' && check.reason === 'opening-strip-work-limit',
      ),
    ).toBe(true)
  })

  it.each(['remove-strokes', 'move-strokes', 'fill-only', 'compound-fill'] as const)(
    'does not accept separately painted reveals after %s',
    (mutation) => {
      const input = separatelyPaintedFixture()
      if (mutation === 'remove-strokes')
        input.work.paths = input.work.paths.filter((path) => path.paint === 'fill')
      if (mutation === 'move-strokes')
        for (const path of input.work.paths) {
          if (path.operationIndex >= 10000)
            path.points = path.points.map((point) => ({ ...point, x: point.x + 0.001 }))
        }
      if (mutation === 'fill-only') for (const path of input.work.paths) path.paint = 'fill'
      if (mutation === 'compound-fill')
        input.work.paths.push(
          ...input.work.paths
            .filter((path) => path.closed)
            .map((path) => ({ ...structuredClone(path), subpathIndex: path.subpathIndex + 100 })),
        )
      expect(pairs(input)).toEqual([])
    },
  )
  it('rejects a moved room corner even when both door reveals remain unchanged', () => {
    const input = fixture()
    const room = input.contours.rooms.find((room) => room.roomSourceNumber === 2)
    const point = room?.polygon[0]
    if (!point) throw new Error('Missing room corner')
    point.x += 0.001
    expect(pairs(input)).toEqual([])
    expect(verifyPlanPageOpeningFaces(input.work, input.source, input.contours)).toContainEqual(
      expect.objectContaining({ reason: 'non-native-contour-vertex', status: 'unresolved' }),
    )
  })

  it('rejects a moved exterior corner without changing the door annotations', () => {
    const input = fixture()
    const point = input.contours.exterior?.polygon[0]
    if (!point) throw new Error('Missing exterior corner')
    point.x += 0.001
    expect(pairs(input)).toEqual([])
  })
  it('pairs five existing door spans without changing any annotation or native point', () => {
    const input = fixture()
    const before = structuredClone(input)
    const result = pairs(input)
    expect(result).toHaveLength(5)
    expect(result.map((pair) => pair.openings.map((face) => face.openingId).sort()).sort()).toEqual(
      [
        ['room-2-door', 'zone-1-5-to-kitchen'],
        ['room-3-passage', 'zone-1-5-to-living'],
        ['room-4-door', 'zone-1-5-to-bedroom-4'],
        ['room-7-door', 'zone-1-5-to-bath'],
        ['room-8-door', 'zone-1-5-to-wc'],
      ].sort(),
    )
    for (const pair of result) {
      expect(pair.jambs).toHaveLength(2)
      for (const jamb of pair.jambs) {
        const path = input.work.paths.find(
          (item) =>
            item.operationIndex === jamb.operationIndex && item.subpathIndex === jamb.subpathIndex,
        )
        expect(path?.points[jamb.segmentIndex]).toEqual(jamb.start)
        expect(path?.points[(jamb.segmentIndex + 1) % path.points.length]).toEqual(jamb.end)
      }
      expect(pair).not.toHaveProperty('widthMm')
      expect(pair).not.toHaveProperty('thicknessCm')
    }
    expect(input).toEqual(before)
  })

  it('does not treat the coincident stepped-bedroom threshold as two wall faces', () => {
    const input = fixture()
    const result = verifyPlanPageOpeningFaces(input.work, input.source, input.contours)
    for (const id of ['room-6-door', 'zone-1-5-to-bedroom-6', 'zone-1-5-entrance']) {
      expect(result.find((check) => check.openingId === id)).toMatchObject({ status: 'unresolved' })
    }
    expect(result.some((check) => check.openingId.includes('window'))).toBe(false)
  })

  it('distinguishes a missing opposing door annotation from missing native jambs', () => {
    const input = fixture()
    const kitchen = input.contours.rooms.find((room) => room.roomSourceNumber === 2)
    if (!kitchen) throw new Error('Missing kitchen room')
    kitchen.openings = []

    const check = verifyPlanPageOpeningFaces(input.work, input.source, input.contours).find(
      (item) => item.openingId === 'zone-1-5-to-kitchen',
    )
    expect(check).toMatchObject({ status: 'unresolved', reason: 'no-opposing-door-face' })
  })

  it('keeps the native-jamb reason when both annotated faces exist', () => {
    const input = mixedRevealFixture()
    input.work.paths = input.work.paths.filter((path) => path.operationIndex !== 10)

    const checks = verifyPlanPageOpeningFaces(input.work, input.source, input.contours)
    expect(checks).toHaveLength(2)
    expect(checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'unresolved', reason: 'no-two-native-jambs' }),
      ]),
    )
  })

  it.each(['remove', 'open', 'fill', 'shorten'] as const)(
    'refuses a kitchen pair after a native jamb is made %s',
    (mutation) => {
      const input = fixture()
      const supporting = input.work.paths.filter((path) =>
        path.points.some((point, index) => {
          const next = path.points[(index + 1) % path.points.length]
          return (
            next &&
            point.x === 339.634 &&
            next.x === 339.634 &&
            ((point.y === 281.919 && next.y === 285.489) ||
              (point.y === 285.489 && next.y === 281.919))
          )
        }),
      )
      expect(supporting.length).toBeGreaterThan(0)
      for (const path of supporting) {
        if (mutation === 'remove') {
          input.work.paths = input.work.paths.filter((item) => item !== path)
        } else if (mutation === 'open') {
          path.closed = false
        } else if (mutation === 'fill') {
          path.paint = 'fill'
        } else {
          const end = path.points.find((point) => point.x === 339.634 && point.y === 285.489)
          if (!end) throw new Error('Missing kitchen native endpoint')
          end.y -= 0.001
        }
      }
      expect(
        pairs(input).some((pair) => pair.openings.some((face) => face.openingId === 'room-2-door')),
      ).toBe(false)
    },
  )

  it('recognizes repeated painting of identical native jambs without moving endpoints', () => {
    const input = fixture()
    const before = pairs(input)
    const path = input.work.paths.find((path) => path.operationIndex === 873)
    if (!path) throw new Error('Missing kitchen path')
    input.work.paths.push({ ...structuredClone(path), operationIndex: 9999 })
    expect(pairs(input)).toEqual(before)
  })

  it('does not count a farther face through an intervening room as a competing immediate neighbour', () => {
    const input = fixture()
    const rectangle = (number: number, top: number, bottom: number, edge: number) => ({
      roomSourceNumber: number,
      polygon: [
        { x: 25, y: top },
        { x: 125, y: top },
        { x: 125, y: bottom },
        { x: 25, y: bottom },
      ],
      openings: [
        {
          id: `door-${number}`,
          kind: 'door' as const,
          wallEdgeIndex: edge,
          start: { x: 50, y: edge === 0 ? top : bottom },
          end: { x: 100, y: edge === 0 ? top : bottom },
        },
      ],
    })
    input.contours.exterior = undefined
    input.contours.rooms = [
      rectangle(1, 200, 250, 0),
      rectangle(2, 100, 150, 2),
      rectangle(3, 25, 75, 2),
    ]
    input.work.paths = [150, 75].map((y, index) => ({
      operationIndex: index,
      subpathIndex: 0,
      paint: 'stroke',
      closed: true,
      points: [
        { x: 50, y: 200 },
        { x: 50, y },
        { x: 100, y },
        { x: 100, y: 200 },
      ],
    }))
    input.work.paths.push(
      ...input.contours.rooms.map((room, index) => ({
        operationIndex: 100 + index,
        subpathIndex: 0,
        paint: 'stroke' as const,
        closed: true,
        points: structuredClone(room.polygon),
      })),
    )
    const result = verifyPlanPageOpeningFaces(input.work, input.source, input.contours)
    expect(result.find((check) => check.openingId === 'door-1')).toMatchObject({
      status: 'candidate',
      opposite: { openingId: 'door-2', roomSourceNumber: 2 },
    })
    expect(result.find((check) => check.openingId === 'door-3')).toMatchObject({
      status: 'unresolved',
      reason: 'opening-strip-overlaps-room',
    })
    expect(pairs(input).map((pair) => pair.openings.map((face) => face.openingId).sort())).toEqual([
      ['door-1', 'door-2'],
    ])
  })

  it('does not substitute a nearby face or a window for a declared door face', () => {
    const moved = fixture()
    const door = moved.contours.rooms
      .find((room) => room.roomSourceNumber === 2)
      ?.openings?.find((opening) => opening.id === 'room-2-door')
    if (!door) throw new Error('Missing kitchen door')
    door.start.x += 0.001
    door.end.x += 0.001
    expect(pairs(moved)).toHaveLength(4)
    const window = fixture()
    const opening = window.contours.rooms
      .find((room) => room.roomSourceNumber === 2)
      ?.openings?.find((opening) => opening.id === 'room-2-door')
    if (!opening) throw new Error('Missing kitchen door')
    opening.kind = 'window'
    expect(pairs(window)).toHaveLength(4)
  })

  it('is independent of contour, endpoint, and native segment direction', () => {
    const input = fixture()
    const before = pairs(input)
    input.contours.rooms.reverse()
    for (const room of input.contours.rooms) {
      room.polygon.reverse()
      for (const opening of room.openings ?? []) {
        opening.wallEdgeIndex =
          (room.polygon.length - 2 - opening.wallEdgeIndex + room.polygon.length) %
          room.polygon.length
        const start = opening.start
        opening.start = opening.end
        opening.end = start
      }
    }
    for (const path of input.work.paths) path.points.reverse()
    const after = pairs(input)
    const ids = (result: ReturnType<typeof pairs>) =>
      result.map((pair) => pair.openings.map((face) => face.openingId).sort()).sort()
    expect(ids(after)).toEqual(ids(before))
  })

  it.each(['hash', 'page', 'format', 'proposed', 'truncated', 'clipped', 'unsupported'] as const)(
    'refuses %s source evidence',
    (mutation) => {
      const input = fixture()
      if (mutation === 'hash') input.source = { ...input.source, sha256: '0'.repeat(64) }
      if (mutation === 'page') input.source = { ...input.source, pdfPage: 12 }
      if (mutation === 'format') input.work.pageWidth += 1
      if (mutation === 'proposed') input.contours.source = { ...input.source, state: 'proposed' }
      if (mutation === 'truncated') input.work.truncated = true
      if (mutation === 'clipped') input.work.clippedPaths = 1
      if (mutation === 'unsupported') input.work.unsupportedPaths = 1
      expect(pairs(input)).toEqual([])
    },
  )

  it('bounds the pair search before validating oversized evidence', () => {
    const input = fixture()
    const path = input.work.paths[0]
    if (!path) throw new Error('Missing native paths')
    input.work.paths = Array.from({ length: 3001 }, () => path)
    expect(pairs(input)).toEqual([])
    const annotations = fixture()
    const room = annotations.contours.rooms[0]
    const opening = room?.openings?.[0]
    if (!room || !opening) throw new Error('Missing annotated openings')
    room.openings = Array.from({ length: 201 }, () => opening)
    expect(pairs(annotations)).toEqual([])
  })
})
