import type { PlanPageContours } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import { nativeNumberCircleCandidates } from './plan-native-number-circles'
import { nativeOpeningFrameCandidates } from './plan-native-opening-frames'
import { nativeReviewedFrameRooms } from './plan-native-reviewed-frame-rooms'
import type { PdfCurvePath, PdfVectorPath } from './plan-pdf-linework'
import { verifyPlanPageOpeningFaces } from './plan-pdf-opening-faces'

type Input = Parameters<typeof nativeReviewedFrameRooms>[0]
type Room = PlanPageContours['rooms'][number]

function paintedPath(operationIndex: number, points: number[][]): PdfVectorPath {
  return {
    operationIndex,
    subpathIndex: 0,
    paint: 'stroke',
    closed: true,
    points: points.map(([x, y]) => ({ x: x as number, y: y as number })),
  }
}

function rectangle(operationIndex = 1, top = 100, bottom = 110) {
  return paintedPath(operationIndex, [
    [100, top],
    [200, top],
    [200, bottom],
    [100, bottom],
    [100, top],
  ])
}

function fixture(): Input {
  const source = { sha256: 'a'.repeat(64), pdfPage: 6, state: 'existing' as const }
  const raster = { sha256: 'b'.repeat(64), page: 6, width: 1000, height: 1000 }
  const rooms: Room[] = [
    {
      roomSourceNumber: 1,
      polygon: [
        { x: 50, y: 50 },
        { x: 250, y: 50 },
        { x: 250, y: 100 },
        { x: 50, y: 100 },
      ],
      openings: [
        {
          id: 'upper-door',
          kind: 'door',
          wallEdgeIndex: 2,
          start: { x: 100, y: 100 },
          end: { x: 200, y: 100 },
        },
      ],
    },
    {
      roomSourceNumber: 2,
      polygon: [
        { x: 50, y: 110 },
        { x: 250, y: 110 },
        { x: 250, y: 160 },
        { x: 50, y: 160 },
      ],
      openings: [
        {
          id: 'lower-door',
          kind: 'door',
          wallEdgeIndex: 0,
          start: { x: 100, y: 110 },
          end: { x: 200, y: 110 },
        },
      ],
    },
  ]
  return {
    source,
    native: {
      source: raster,
      originalPdfSha256: source.sha256,
      complete: true,
      labels: [],
      pageNormalizedScale: { x: 1, y: 1 },
    },
    lineworkSource: { ...raster },
    work: {
      coordinateSystem: 'page-0-1000',
      pageWidth: 1000,
      pageHeight: 1000,
      paths: [
        rectangle(),
        // Complex closed source outlines, not invented wall-role input. Their
        // continuous jamb edges contain the two short frame sides exactly.
        paintedPath(2, [
          [50, 80],
          [100, 80],
          [100, 120],
          [50, 120],
          [45, 115],
          [45, 85],
          [50, 80],
        ]),
        paintedPath(3, [
          [200, 80],
          [250, 80],
          [255, 85],
          [255, 115],
          [250, 120],
          [200, 120],
          [200, 80],
        ]),
        ...rooms.map((room, index) => ({
          ...paintedPath(10 + index, []),
          points: structuredClone(room.polygon),
        })),
      ],
      skippedCurves: 0,
      unsupportedPaths: 0,
      unsupportedContexts: 0,
      clippedPaths: 0,
      truncated: false,
    },
    reading: {
      readAt: '2026-10-10',
      sourcePage: 6,
      planState: 'existing',
      rooms: [
        { sourceNumber: 1, name: 'Прихожая', kind: 'living' },
        { sourceNumber: 2, name: 'Гостиная', kind: 'living' },
      ],
      pageReview: {
        version: 1,
        savedAt: '2026-10-10',
        contours: {
          source: { ...source },
          coordinateSystem: 'page-0-1000',
          review: 'manual-source-review',
          pageWidth: 1000,
          pageHeight: 1000,
          rooms,
        },
      },
    },
  }
}

function contoursOf(input: Input) {
  const contours = input.reading?.pageReview?.contours
  if (!contours) throw new Error('Missing fixture review')
  return contours
}

function roomOf(input: Input, index = 0) {
  const room = contoursOf(input).rooms[index]
  if (!room) throw new Error('Missing fixture room')
  return room
}

function openingOf(input: Input, index = 0) {
  const opening = roomOf(input, index).openings?.[0]
  if (!opening) throw new Error('Missing fixture opening')
  return opening
}

function addCircle(input: Input, number: number, x: number, y: number, radius = 10) {
  const index = input.native.labels.length
  const operationIndex = 100 + index
  const k = (4 / 3) * Math.tan(Math.PI / 8)
  const points = [
    { x: x + radius, y },
    { x, y: y + radius },
    { x: x - radius, y },
    { x, y: y - radius },
    { x: x + radius, y },
  ]
  const curve: PdfCurvePath = {
    operationIndex,
    subpathIndex: 0,
    operationSubpathCount: 1,
    paint: 'stroke',
    closed: true,
    start: points[0] as { x: number; y: number },
    segments: points.slice(1).map((end, segmentIndex) => {
      const start = points[segmentIndex] as { x: number; y: number }
      return {
        kind: 'cubic',
        control1: { x: start.x - k * (start.y - y), y: start.y + k * (start.x - x) },
        control2: { x: end.x + k * (end.y - y), y: end.y - k * (end.x - x) },
        end,
      }
    }),
  }
  input.native.labels.push({
    id: `native-text-${index}`,
    nativeIndex: index,
    name: String(number),
    rotation: 0,
    pagePoint: { x, y },
    point: { x, y },
  })
  input.work.curvePaths ??= []
  input.work.curvePaths.push(curve)
  refreshCurveBounds(input)
  return curve
}

function refreshCurveBounds(input: Input) {
  input.work.skippedCurves = input.work.curvePaths?.length ?? 0
  input.work.skippedCurveBounds = (input.work.curvePaths ?? []).map((curve) => {
    const points = [
      curve.start,
      ...curve.segments.flatMap((segment) =>
        segment.kind === 'cubic'
          ? [segment.control1, segment.control2, segment.end]
          : segment.kind === 'quadratic'
            ? [segment.control, segment.end]
            : [segment.end],
      ),
    ]
    return {
      operationIndex: curve.operationIndex,
      bounds: {
        left: Math.min(...points.map((point) => point.x)),
        right: Math.max(...points.map((point) => point.x)),
        top: Math.min(...points.map((point) => point.y)),
        bottom: Math.max(...points.map((point) => point.y)),
      },
    }
  })
}

describe('native frames against a saved source-room review', () => {
  it('matches two complete reviewed sides only after native mutual face and jamb checks', () => {
    const input = fixture()
    expect(nativeOpeningFrameCandidates(input).candidates).toHaveLength(1)
    expect(
      verifyPlanPageOpeningFaces(input.work, input.source, contoursOf(input)).map(
        (check) => check.status,
      ),
    ).toEqual(['candidate', 'candidate'])
    const result = nativeReviewedFrameRooms(input)
    expect(result.status).toBe('checked')
    expect(result.frames).toEqual([
      {
        frameId: 'native-opening-frame-1:0',
        status: 'two-reviewed-sides',
        sides: [
          {
            roomSourceNumbers: [1],
            openingId: 'upper-door',
            kind: 'door',
            frameEdgeIndex: 0,
            numberCue: 'not-inside',
          },
          {
            roomSourceNumbers: [2],
            openingId: 'lower-door',
            kind: 'door',
            frameEdgeIndex: 2,
            numberCue: 'not-inside',
          },
        ],
      },
    ])
    expect(result).toMatchObject({
      basis: 'saved-source-review-frame-side-correspondence',
      roomOwnershipConfirmed: false,
      closesFloorBoundary: false,
      physicalPassagesAccepted: false,
    })
    expect(result).not.toHaveProperty('geometry')
  })

  it('returns not-saved for absent reading or review', () => {
    const withoutReview = fixture()
    if (withoutReview.reading) delete withoutReview.reading.pageReview
    expect(nativeReviewedFrameRooms(withoutReview)).toMatchObject({
      status: 'not-saved',
      frames: [],
    })
    const input = fixture()
    delete input.reading
    expect(nativeReviewedFrameRooms(input)).toMatchObject({ status: 'not-saved', frames: [] })
  })

  it('withholds unknown review versions', () => {
    const input = fixture()
    Object.assign(input.reading?.pageReview ?? {}, { version: 2 })
    expect(nativeReviewedFrameRooms(input)).toMatchObject({
      status: 'unavailable',
      reason: 'unsupported-review-version',
      frames: [],
    })
  })

  it('refuses different original PDF hash, native page, and proposed source', () => {
    for (const mutation of ['hash', 'page', 'state'] as const) {
      const input = fixture()
      if (mutation === 'hash') input.native.originalPdfSha256 = 'c'.repeat(64)
      if (mutation === 'page') input.native.source.page = 7
      if (mutation === 'state') input.source.state = 'proposed'
      expect(nativeReviewedFrameRooms(input)).toMatchObject({
        status: 'refused',
        reason: 'different-plan-source',
        frames: [],
      })
    }
  })

  it('does not reuse a review stored for another PDF source', () => {
    const input = fixture()
    contoursOf(input).source.sha256 = 'c'.repeat(64)
    expect(nativeReviewedFrameRooms(input)).toMatchObject({
      status: 'refused',
      reason: 'different-plan-source',
      frames: [],
    })
  })

  it('refuses changed reading page or plan state', () => {
    for (const mutation of ['page', 'state'] as const) {
      const input = fixture()
      if (!input.reading) throw new Error('Missing fixture reading')
      if (mutation === 'page') input.reading.sourcePage = 7
      else input.reading.planState = 'proposed'
      expect(nativeReviewedFrameRooms(input)).toMatchObject({
        status: 'refused',
        reason: 'different-reading-source',
        frames: [],
      })
    }
  })

  it('refuses absent, zero and duplicate reading room identities', () => {
    for (const sourceNumber of [undefined, 0, 1]) {
      const input = fixture()
      const room = input.reading?.rooms[1]
      if (!room) throw new Error('Missing fixture reading room')
      room.sourceNumber = sourceNumber
      expect(nativeReviewedFrameRooms(input)).toMatchObject({
        status: 'refused',
        reason: 'incomplete-room-identity-inventory',
        frames: [],
      })
    }
  })

  it('refuses source-room declarations missing from the reading identity inventory', () => {
    const input = fixture()
    if (!input.reading) throw new Error('Missing fixture reading')
    input.reading.rooms = input.reading.rooms.slice(0, 1)
    expect(nativeReviewedFrameRooms(input)).toMatchObject({
      status: 'refused',
      reason: 'unknown-room-number',
      frames: [],
    })
  })

  it('rejects stale contour vertices instead of snapping them to source ink', () => {
    const input = fixture()
    const vertex = roomOf(input).polygon[0]
    if (!vertex) throw new Error('Missing fixture vertex')
    vertex.x += 0.001
    expect(nativeReviewedFrameRooms(input)).toMatchObject({
      status: 'refused',
      reason: 'non-native-contour-vertex',
      frames: [],
    })
  })

  it('refuses changed native page format', () => {
    const input = fixture()
    input.work.pageWidth += 1
    expect(nativeReviewedFrameRooms(input)).toMatchObject({
      status: 'refused',
      reason: 'different-page-format',
      frames: [],
    })
  })

  it('returns unavailable rather than throwing when the raster source frame mismatches', () => {
    const input = fixture()
    input.lineworkSource.sha256 = 'c'.repeat(64)
    expect(nativeReviewedFrameRooms(input)).toMatchObject({
      status: 'unavailable',
      reason: 'source-frame-unavailable',
      frames: [],
    })
  })

  it('keeps an entrance one-sided and does not invent an exterior room identity', () => {
    const input = fixture()
    roomOf(input, 1).openings = []
    const result = nativeReviewedFrameRooms(input)
    expect(result.frames[0]).toMatchObject({
      status: 'one-reviewed-side',
      sides: [{ roomSourceNumbers: [1], openingId: 'upper-door' }],
    })
    expect(
      result.frames.flatMap((frame) => frame.sides.map((side) => side.roomSourceNumbers)),
    ).toEqual([[1]])
  })

  it('preserves reversed contour winding, opening endpoints and native frame direction', () => {
    const input = fixture()
    for (const room of contoursOf(input).rooms) {
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
    expect(nativeReviewedFrameRooms(input).frames[0]).toMatchObject({
      status: 'two-reviewed-sides',
    })
  })

  it('does not substitute opening subsets, supersets or nearby parallel declarations', () => {
    for (const [start, end, y] of [
      [110, 190, 100],
      [90, 210, 100],
      [100, 200, 100.001],
    ]) {
      const input = fixture()
      const opening = openingOf(input)
      opening.start = { x: start as number, y: y as number }
      opening.end = { x: end as number, y: y as number }
      input.work.paths.push({
        ...paintedPath(90, []),
        closed: false,
        points: [{ ...opening.start }, { ...opening.end }],
      })
      const result = nativeReviewedFrameRooms(input)
      expect(result.status).toBe('checked')
      expect(result.frames[0]).toMatchObject({
        status: 'one-reviewed-side',
        sides: [{ roomSourceNumbers: [2], openingId: 'lower-door' }],
      })
    }
  })

  it('cannot retain a frame after either actual structural jamb is absent', () => {
    const input = fixture()
    input.work.paths = input.work.paths.filter((path) => path.operationIndex !== 2)
    expect(nativeReviewedFrameRooms(input)).toMatchObject({ status: 'checked', frames: [] })
  })

  it('does not pair windows merely because their reviewed spans oppose each other', () => {
    const input = fixture()
    for (const room of contoursOf(input).rooms) {
      for (const opening of room.openings ?? []) opening.kind = 'window'
    }
    expect(nativeReviewedFrameRooms(input).frames[0]).toMatchObject({
      status: 'unresolved',
      sides: [{ kind: 'window' }, { kind: 'window' }],
    })
  })

  it('keeps conflicting semantic kinds ambiguous rather than using frame proximity', () => {
    const input = fixture()
    openingOf(input, 1).kind = 'balcony'
    expect(nativeReviewedFrameRooms(input).frames[0]).toMatchObject({ status: 'ambiguous' })
  })

  it('withholds two-sided correspondence when the native strip crosses a third reviewed room', () => {
    const input = fixture()
    const room: Room = {
      roomSourceNumber: 3,
      polygon: [
        { x: 120, y: 102 },
        { x: 180, y: 102 },
        { x: 180, y: 108 },
        { x: 120, y: 108 },
      ],
    }
    contoursOf(input).rooms.push(room)
    input.reading?.rooms.push({ sourceNumber: 3, name: 'Кладовая', kind: 'living' })
    input.work.paths.push({ ...paintedPath(12, []), points: structuredClone(room.polygon) })
    const checks = verifyPlanPageOpeningFaces(input.work, input.source, contoursOf(input))
    expect(checks.every((check) => check.status === 'unresolved')).toBe(true)
    expect(nativeReviewedFrameRooms(input).frames[0]).toMatchObject({
      status: 'unresolved',
      sides: [{ openingId: 'upper-door' }, { openingId: 'lower-door' }],
    })
  })

  it('reports coincident logical zone closures without inventing wall thickness', () => {
    const input = fixture()
    const room = roomOf(input, 1)
    for (const point of room.polygon) if (point.y === 110) point.y = 100
    const opening = openingOf(input, 1)
    opening.start.y = 100
    opening.end.y = 100
    const result = nativeReviewedFrameRooms(input)
    expect(result.status).toBe('checked')
    expect(result.frames[0]).toMatchObject({
      status: 'coincident-sides',
      sides: [{ frameEdgeIndex: 0 }, { frameEdgeIndex: 0 }],
    })
  })

  it('retains a merged 1+5 source zone instead of choosing one printed room', () => {
    const input = fixture()
    const room = roomOf(input)
    delete room.roomSourceNumber
    room.roomSourceNumbers = [5, 1]
    input.reading?.rooms.push({ sourceNumber: 5, name: 'Коридор', kind: 'living' })
    expect(nativeReviewedFrameRooms(input).frames[0]).toMatchObject({
      status: 'two-reviewed-sides',
      sides: [{ roomSourceNumbers: [1, 5] }, { roomSourceNumbers: [2] }],
    })
  })

  it('marks every distinct native frame reusing one reviewed opening as ambiguous', () => {
    const input = fixture()
    input.work.paths.push(rectangle(4, 90, 100))
    const result = nativeReviewedFrameRooms(input)
    expect(result.frames).toHaveLength(2)
    expect(result.frames.every((frame) => frame.status === 'ambiguous')).toBe(true)
    expect(result.frames.map((frame) => frame.frameId)).toEqual([
      'native-opening-frame-1:0',
      'native-opening-frame-4:0',
    ])
  })

  it('uses a whole native number-circle hull as an informative cue, never floor ownership', () => {
    const input = fixture()
    addCircle(input, 1, 150, 75)
    const result = nativeReviewedFrameRooms(input)
    expect(result.frames[0]).toMatchObject({
      status: 'two-reviewed-sides',
      sides: [{ numberCue: 'inside' }, { numberCue: 'not-inside' }],
    })
    expect(result.roomOwnershipConfirmed).toBe(false)
    expect(result.closesFloorBoundary).toBe(false)
    expect(result.physicalPassagesAccepted).toBe(false)
  })
  it('retains manual frame matches without numeric uniqueness when curve commands are incomplete', () => {
    const input = fixture()
    addCircle(input, 1, 150, 75)
    addCircle(input, 1, 150, 75)
    input.work.curvePaths = input.work.curvePaths?.slice(0, 1)
    const result = nativeReviewedFrameRooms(input)
    expect(result.status).toBe('checked')
    expect(result.frames[0]).toMatchObject({
      status: 'two-reviewed-sides',
      sides: [{ numberCue: 'unavailable' }, { numberCue: 'unavailable' }],
    })
  })

  it('refuses baseline-only circle ownership when a source control point overshoots the room', () => {
    const input = fixture()
    const curve = addCircle(input, 1, 150, 89.999)
    const segment = curve.segments[0]
    if (segment?.kind !== 'cubic') throw new Error('Missing fixture cubic')
    segment.control2.y = 100.001
    refreshCurveBounds(input)
    const cues = nativeNumberCircleCandidates(input)
    expect(cues.cues).toHaveLength(1)
    expect(cues.cues[0]?.bounds.bottom).toBeLessThan(100)
    expect(nativeReviewedFrameRooms(input).frames[0]?.sides[0]?.numberCue).toBe('not-inside')
  })

  it('keeps repeated printed numbers ambiguous even when both circles lie inside the room', () => {
    const input = fixture()
    addCircle(input, 1, 130, 75)
    addCircle(input, 1, 180, 75)
    expect(nativeNumberCircleCandidates(input).cues).toHaveLength(2)
    expect(nativeReviewedFrameRooms(input).frames[0]).toMatchObject({
      status: 'two-reviewed-sides',
      sides: [{ numberCue: 'ambiguous' }, { numberCue: 'not-inside' }],
    })
  })

  it('does not assign outside or unknown printed numbers to the closest reviewed room', () => {
    const input = fixture()
    addCircle(input, 1, 350, 350)
    addCircle(input, 99, 150, 75)
    expect(nativeReviewedFrameRooms(input).frames[0]?.sides[0]?.numberCue).toBe('not-inside')
  })

  it('retains manual frame correspondence when curve commands for number cues are unavailable', () => {
    const input = fixture()
    input.work.skippedCurves = 1
    input.work.skippedCurveBounds = [
      { operationIndex: 100, bounds: { left: 300, top: 300, right: 320, bottom: 320 } },
    ]
    const result = nativeReviewedFrameRooms(input)
    expect(result.frames[0]).toMatchObject({
      status: 'two-reviewed-sides',
      sides: [{ numberCue: 'unavailable' }, { numberCue: 'unavailable' }],
    })
    expect(input.work.skippedCurves).toBe(1)
  })

  it('leaves source and review unchanged and detaches returned room identities', () => {
    const input = fixture()
    addCircle(input, 1, 150, 75)
    const original = structuredClone(input)
    const result = nativeReviewedFrameRooms(input)
    expect(input).toEqual(original)
    result.frames[0]?.sides[0]?.roomSourceNumbers.push(999)
    expect(input).toEqual(original)
  })

  it('refuses oversized review inventories atomically before frame enumeration', () => {
    const input = fixture()
    const rooms = contoursOf(input).rooms
    const first = rooms[0]
    if (!first) throw new Error('Missing fixture room')
    contoursOf(input).rooms = Array.from({ length: 101 }, () => structuredClone(first))
    expect(nativeReviewedFrameRooms(input)).toMatchObject({
      status: 'refused',
      reason: 'review-work-limit',
      frames: [],
    })
  })
})
