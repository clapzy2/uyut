import type { PlanPageRoomIdentity, PlanReading } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import { nativeAnnotationFixture } from '../../scripts/qa-native-annotation-fixture'
import type { nativeDimensionEvidence } from './plan-native-dimension-evidence'
import type { ReviewedNativeFaces } from './plan-native-face-cycle'
import { nativePageContourCandidates } from './plan-native-page-contours'
import { planPageContoursSchema } from './plan-page-review'
import type { PdfVectorPath } from './plan-pdf-linework'

function fixture() {
  const base = nativeAnnotationFixture()
  const source = base.reviewed.source
  const review = (operationIndex: number): ReviewedNativeFaces => {
    const path = base.work.paths.find((path) => path.operationIndex === operationIndex)
    if (!path) throw new Error('Missing path')
    return {
      review: 'manual-native-face-review',
      source: { ...source },
      rasterSource: { ...base.native.source },
      faces: path.points.map((_, segmentIndex) => ({
        ref: { operationIndex, subpathIndex: 0, segmentIndex },
        kind: 'wall-face',
      })),
    }
  }
  const dimensions: ReturnType<typeof nativeDimensionEvidence> = {
    status: 'draft',
    source: { ...source },
    rasterSource: { ...base.native.source },
    chains: [],
    dimensionOperations: [10, 11, 12],
    nativeCoverageWarnings: {
      skippedCurves: 0,
      clippedPaths: 0,
      unsupportedPaths: 0,
      unsupportedContexts: 0,
    },
  }
  const reading: Pick<PlanReading, 'rooms' | 'sourcePage' | 'planState'> = {
    sourcePage: 1,
    planState: 'existing',
    rooms: [
      { sourceNumber: 1, name: 'Гостиная', kind: 'living' },
      { sourceNumber: 2, name: 'Балкон', kind: 'living', utility: true },
    ],
  }
  const input = {
    ...base,
    source,
    dimensions,
    reading,
    rooms: [
      { identity: { roomSourceNumber: 1 } as PlanPageRoomIdentity, reviewed: review(1) },
      { identity: { roomSourceNumber: 2 } as PlanPageRoomIdentity, reviewed: review(2) },
    ],
  }
  return { input, review }
}

describe('explicit same-source native page assignments, never automatic confirmation', () => {
  it('accepts exact decimal neighbours through the complete fresh source validation path', () => {
    const { input } = fixture()
    const shapes = [
      [
        { x: 0.1, y: 0.3 },
        { x: 0.3, y: 0.9 },
        { x: 0.3, y: 0.3 },
      ],
      [
        { x: 0.2, y: 0.6 },
        { x: 0.3, y: 0.9 },
        { x: 0.1, y: 0.9 },
      ],
    ]
    input.work.paths = shapes.map((points, index) => ({
      operationIndex: index + 1,
      subpathIndex: 0,
      closed: true,
      paint: 'stroke',
      points,
    }))
    for (const room of input.rooms) room.reviewed.faces = room.reviewed.faces.slice(0, 3)
    const result = nativePageContourCandidates(input)
    expect(result.status, result.reason).toBe('partial')
    expect(result.roomContacts?.total).toBe(1)
    expect(result.roomContacts?.physicalPassagesAccepted).toBe(false)
    expect(result.contours).not.toHaveProperty('review')
  })
  it('keeps a diagonal balcony room distinct and missing floor explicit', () => {
    const { input } = fixture(),
      before = structuredClone(input)
    const result = nativePageContourCandidates(input)
    expect(result.status).toBe('partial')
    expect(result.contours?.rooms.map((room) => room.polygon.length)).toEqual([4, 5])
    expect(result.missingSourceNumbers).toEqual([])
    expect(result.roomContacts).toMatchObject({
      status: 'candidate',
      total: 1,
      physicalPassagesAccepted: false,
    })
    expect(result.roomContacts?.spans[0]).toMatchObject({
      firstRoomKey: '1',
      secondRoomKey: '2',
      firstEdgeIndex: 1,
      secondEdgeIndex: 4,
      start: { x: 520, y: 100 },
      end: { x: 520, y: 280 },
    })
    expect(result.issues).toContain('floor-boundary-missing')
    expect(result.contours).not.toHaveProperty('review')
    expect(result.contours).not.toHaveProperty('floor')
    expect(result.contours).not.toHaveProperty('footprint')
    expect(planPageContoursSchema.safeParse(result.contours).success).toBe(false)
    expect(result.readiness).toEqual({ readOnly: true, readyFor2D: false, readyFor3D: false })
    expect(input).toEqual(before)
  })
  it('never guesses missing source IDs from a contiguous numeric sequence', () => {
    const { input } = fixture()
    input.reading.rooms.push({ sourceNumber: 8, name: 'Спальня', kind: 'bedroom' })
    const result = nativePageContourCandidates(input)
    expect(result.missingSourceNumbers).toEqual([8])
    expect(result.issues).toContain('room-inventory-partial')
  })
  it('preserves an explicitly grouped identity without adding a divider', () => {
    const { input } = fixture()
    const room = input.rooms[0]
    if (!room) throw new Error('Missing room')
    room.identity = { roomSourceNumbers: [1, 2] }
    input.rooms = [room]
    const result = nativePageContourCandidates(input)
    expect(result.contours?.rooms[0]?.roomSourceNumbers).toEqual([1, 2])
    expect(result.contours?.rooms[0]).not.toHaveProperty('conditionalEdges')
    const numbers = result.contours?.rooms[0]?.roomSourceNumbers
    if (!numbers) throw new Error('Missing identities')
    numbers[0] = 99
    expect(room.identity.roomSourceNumbers).toEqual([1, 2])
  })
  it.each(['duplicate', 'unknown', 'both', 'unlabelled', 'inventory-duplicate'])(
    'refuses invalid %s identity mapping atomically',
    (change) => {
      const { input } = fixture()
      const room = input.rooms[0]
      if (!room) throw new Error('Missing room')
      if (change === 'duplicate') input.rooms.push(structuredClone(room))
      if (change === 'unknown') room.identity = { roomSourceNumber: 99 }
      if (change === 'both')
        room.identity = {
          roomSourceNumber: 1,
          roomSourceNumbers: [1, 2],
        } as unknown as PlanPageRoomIdentity
      if (change === 'unlabelled') delete input.reading.rooms[0]?.sourceNumber
      if (change === 'inventory-duplicate')
        input.reading.rooms.push({ sourceNumber: 1, name: 'Повтор', kind: 'living' })
      expect(nativePageContourCandidates(input)).toMatchObject({
        status: 'unresolved',
        contours: null,
      })
    },
  )
  it.each(['pdf', 'page', 'state', 'raster', 'dimensions', 'bad-hash', 'dimension-limit'])(
    'refuses mismatched %s evidence without leaking the first valid room',
    (change) => {
      const { input } = fixture()
      const second = input.rooms[1]
      if (!second) throw new Error('Missing room')
      if (change === 'pdf') second.reviewed.source.sha256 = 'c'.repeat(64)
      if (change === 'page') second.reviewed.source.pdfPage = 2
      if (change === 'state') second.reviewed.source.state = 'proposed' as 'existing'
      if (change === 'raster') second.reviewed.rasterSource.sha256 = 'c'.repeat(64)
      if (change === 'dimensions') input.dimensions.source.pdfPage = 2
      if (change === 'bad-hash') {
        input.source.sha256 = 'bad'
        input.native.originalPdfSha256 = 'bad'
      }
      if (change === 'dimension-limit')
        input.dimensions.dimensionOperations = Array.from({ length: 161 }, (_, index) => index)
      expect(nativePageContourCandidates(input)).toMatchObject({
        status: 'unresolved',
        contours: null,
      })
    },
  )
  it('does not emit partial contours when a later cycle is open', () => {
    const { input } = fixture()
    input.rooms[1]?.reviewed.faces.pop()
    expect(nativePageContourCandidates(input)).toMatchObject({
      status: 'unresolved',
      contours: null,
    })
  })
  it('rejects room overlaps instead of unioning or relocating them', () => {
    const { input } = fixture()
    const first = input.rooms[0],
      second = input.rooms[1]
    if (!first || !second) throw new Error('Missing rooms')
    second.reviewed = structuredClone(first.reviewed)
    expect(nativePageContourCandidates(input)).toMatchObject({
      status: 'unresolved',
      reason: 'overlapping-room-contours',
      contours: null,
    })
  })
  it('requires a separate outer envelope for a selected floor, never invents one', () => {
    const { input } = fixture()
    expect(
      nativePageContourCandidates({ ...input, floor: input.rooms[0]?.reviewed }),
    ).toMatchObject({
      status: 'unresolved',
      reason: 'floor-requires-outer-wall-envelope',
      contours: null,
    })
  })
  it('bounds the whole selected-face batch before attempting any cycle', () => {
    const { input } = fixture()
    const room = input.rooms[0]
    if (!room) throw new Error('Missing room')
    input.rooms = Array.from({ length: 100 }, () => ({
      identity: { roomSourceNumber: 1 },
      reviewed: { ...room.reviewed, faces: [...room.reviewed.faces, ...room.reviewed.faces] },
    }))
    expect(nativePageContourCandidates(input)).toMatchObject({
      status: 'unresolved',
      reason: 'native-page-assignment-limit',
      contours: null,
    })
  })
  it('does not turn a reviewed opening closure into a typed door or a wall', () => {
    const { input } = fixture()
    const face = input.rooms[1]?.reviewed.faces[0]
    if (!face) throw new Error('Missing face')
    face.kind = 'reviewed-opening-boundary'
    const result = nativePageContourCandidates(input)
    expect(result.status).toBe('partial')
    expect(result.issues).toContain('opening-closures-untyped')
    expect(result.contours?.rooms[1]).not.toHaveProperty('openings')
    expect(result.contours).not.toHaveProperty('walls')
  })
  it('assembles explicit separate floor and envelope candidates without accepting completeness', () => {
    const { input, review } = fixture()
    const path = (
      operationIndex: number,
      left: number,
      top: number,
      right: number,
      bottom: number,
    ): PdfVectorPath => ({
      operationIndex,
      subpathIndex: 0,
      paint: 'stroke',
      closed: true,
      points: [
        { x: left, y: top },
        { x: right, y: top },
        { x: right, y: bottom },
        { x: left, y: bottom },
      ],
    })
    input.work.paths.push(path(20, 80, 80, 680, 480), path(21, 100, 100, 650, 455))
    const result = nativePageContourCandidates({
      ...input,
      floor: review(21),
      exterior: review(20),
    })
    expect(result.status).toBe('candidate')
    expect(result.contours?.exterior?.boundaryRole).toBe('outer-wall-envelope')
    expect(result.contours?.floor?.polygon).toHaveLength(4)
    expect(result.contours?.exterior?.polygon).not.toEqual(result.contours?.floor?.polygon)
    expect(result.issues).toContain('complete-floor-coverage-unverified')
    expect(result.contours).not.toHaveProperty('review')
    expect(result.readiness.readyFor3D).toBe(false)
    const floorPath = input.work.paths.find((path) => path.operationIndex === 21)
    if (!floorPath) throw new Error('Missing floor')
    for (const point of floorPath.points) point.x += 300
    const refused = nativePageContourCandidates({
      ...input,
      floor: review(21),
      exterior: review(20),
    })
    expect(refused).toMatchObject({
      status: 'unresolved',
      reason: 'floor-outside-exterior-contour',
      contours: null,
    })
    expect(result.contours?.floor?.polygon[0]?.x).toBe(100)
  })
})
