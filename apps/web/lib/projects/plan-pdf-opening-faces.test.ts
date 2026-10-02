import type { PlanPageContours } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import page from '../../../../docs/qa/fixtures/apartment-74-77-complete-page.json'
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

describe('physical door face candidates from two native reveals', () => {
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

  it('refuses several opposing room faces even when each has two native segments', () => {
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
      status: 'ambiguous',
      reason: 'competing-native-door-faces',
    })
    expect(pairs(input)).toEqual([])
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
