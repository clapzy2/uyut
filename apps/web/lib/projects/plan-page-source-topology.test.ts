import type { PlanPageContours, PlanReading } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import { exactNativePointKey } from './plan-native-exact-intersections'
import { floorHeightFixture } from './plan-native-reviewed-floor-heights.fixture'
import { nativeVisiblePaintRegions } from './plan-native-visible-paint'
import { planPageReviewIssue } from './plan-page-review'
import { planPageSourceFloors } from './plan-page-source-floors'
import { sourceTopologyDraftIssue } from './plan-page-source-topology'

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing fixture value')
  return value
}

function fixture() {
  const evidence = floorHeightFixture()
  evidence.work.paths.push(
    {
      operationIndex: 20,
      subpathIndex: 0,
      paint: 'fill',
      closed: true,
      points: [
        { x: 200, y: 200 },
        { x: 230, y: 200 },
        { x: 230, y: 230 },
        { x: 200, y: 230 },
      ],
    },
    {
      operationIndex: 30,
      subpathIndex: 0,
      paint: 'fill',
      closed: true,
      points: [
        { x: 251, y: 80 },
        { x: 310, y: 111 },
        { x: 270, y: 141 },
      ],
    },
  )
  const piece = nativeVisiblePaintRegions(evidence).regions.find(
    (region) => region.candidateId === 'native-fill-10:0',
  )?.pieces[0]
  const reviewed = evidence.reviewedFloors.floors[0]
  if (!piece || !reviewed) throw new Error('Missing source fixture')
  Object.assign(reviewed, {
    polygon: piece.polygon,
    holes: piece.holes,
    boundaryRoles: piece.polygon.map((_, edgeIndex) => ({ edgeIndex, kind: 'unresolved' })),
  })
  const reading: PlanReading = {
    sourcePage: 3,
    planState: 'existing',
    readAt: '2026-10-12',
    rooms: [{ name: 'Спальня', kind: 'bedroom', sourceNumber: 3.1 }],
    paintedFloorReview: {
      version: 1,
      savedAt: '2026-10-12',
      draftJson: JSON.stringify(evidence.reviewedFloors),
    },
  }
  const source = evidence.reviewedFloors.source
  const reference = planPageSourceFloors({
    source,
    sourceRevision: 'c'.repeat(64),
    reading,
    evidence,
    pageWidth: evidence.work.pageWidth,
    pageHeight: evidence.work.pageHeight,
  })
  const floor = reference.floors[0]
  if (!floor) throw new Error(`Missing fresh source floor: ${reference.reason}`)
  const contours: PlanPageContours = {
    source,
    coordinateSystem: 'page-0-1000',
    review: 'manual-source-review',
    pageWidth: evidence.work.pageWidth,
    pageHeight: evidence.work.pageHeight,
    rooms: [
      {
        roomSourceNumber: 3.1,
        polygon: structuredClone(floor.polygon),
        sourceTopology: {
          kind: 'unclassified-source-paint',
          floorId: floor.id,
          exactPointKeys: [...floor.exactPointKeys],
          holes: structuredClone(floor.holes),
          holeExactPointKeys: structuredClone(floor.holeExactPointKeys),
        },
      },
    ],
  }
  return { contours, reading, source, linework: evidence.work, evidence }
}

function selected(input: ReturnType<typeof fixture>) {
  const room = input.contours.rooms[0]
  if (!room?.sourceTopology) throw new Error('Missing selected source topology')
  return room as typeof room & { sourceTopology: NonNullable<typeof room.sourceTopology> }
}

describe('source-only topology draft verification', () => {
  it('keeps a physical trace informational while verifying its original source snapshot', () => {
    const input = fixture()
    const room = selected(input)
    const trace = {
      polygon: structuredClone(room.polygon),
      sourceTopology: structuredClone(room.sourceTopology),
    }
    input.contours.rooms[0] = {
      roomSourceNumber: 3.1,
      sourceTrace: trace,
      polygon: [
        { x: 200, y: 200 },
        { x: 230, y: 200 },
        { x: 230, y: 230 },
        { x: 200, y: 230 },
      ],
    }
    expect(sourceTopologyDraftIssue(input)).toBeUndefined()
    trace.sourceTopology.exactPointKeys[0] = '1/1:1/1'
    expect(sourceTopologyDraftIssue(input)).toBe('source-topology-snapshot-mismatch')
  })
  it('preserves fresh rational crossings and holes through JSON roundtrip without mutation', () => {
    const input = fixture()
    const room = selected(input)
    expect(room.sourceTopology.holes).toHaveLength(1)
    expect(
      room.polygon.some(
        (point, index) => exactNativePointKey(point) !== room.sourceTopology.exactPointKeys[index],
      ),
    ).toBe(true)
    input.contours = JSON.parse(JSON.stringify(input.contours)) as PlanPageContours
    const before = structuredClone(input)
    expect(sourceTopologyDraftIssue(input)).toBeUndefined()
    expect(input).toEqual(before)
    expect(input.reading.geometry).toBeUndefined()
  })

  it.each(['keys', 'polygon', 'holes', 'hole-keys', 'hole-order', 'owner', 'floor-id'])(
    'refuses a stale or altered %s snapshot',
    (fault) => {
      const input = fixture()
      const room = selected(input)
      if (fault === 'keys') room.sourceTopology.exactPointKeys[0] = '1/1:1/1'
      if (fault === 'polygon') required(room.polygon[0]).x += 0.001
      if (fault === 'holes') room.sourceTopology.holes = []
      if (fault === 'hole-keys') required(room.sourceTopology.holeExactPointKeys[0])[0] = '1/1:1/1'
      if (fault === 'hole-order') required(room.sourceTopology.holes[0]).reverse()
      if (fault === 'owner') {
        room.roomSourceNumber = 4
        required(input.reading.rooms[0]).sourceNumber = 4
      }
      if (fault === 'floor-id') room.sourceTopology.floorId = 'another-floor'
      expect(sourceTopologyDraftIssue(input)).toBeDefined()
    },
  )

  it.each([
    'hash',
    'page',
    'format',
    'state',
    'stale-source',
    'missing-review',
    'missing-evidence',
  ])('holds %s without using an old saved snapshot', (fault) => {
    const input = fixture()
    if (fault === 'hash') input.source = { ...input.source, sha256: 'd'.repeat(64) }
    if (fault === 'page') input.source = { ...input.source, pdfPage: 4 }
    if (fault === 'format') input.contours.pageWidth += 1
    if (fault === 'state') input.reading.planState = 'proposed'
    if (fault === 'stale-source')
      required(required(input.evidence.work.paths[0]).points[0]).x += 0.001
    if (fault === 'missing-review') delete input.reading.paintedFloorReview
    const result = sourceTopologyDraftIssue(
      fault === 'missing-evidence' ? { ...input, evidence: undefined } : input,
    )
    expect(result).toBeDefined()
  })

  it.each(['vertexProofs', 'conditionalEdges', 'dimensionEdges', 'openings', 'obstacles'])(
    'refuses an explicitly supplied empty %s field',
    (field) => {
      const input = fixture()
      Object.assign(selected(input), { [field]: [] })
      expect(sourceTopologyDraftIssue(input)).toBe('source-topology-features-not-supported')
    },
  )

  it('refuses grouping and duplicate membership instead of inferring ownership', () => {
    const input = fixture()
    input.reading.rooms.push({ name: 'Кухня', kind: 'kitchen', sourceNumber: 4 })
    const room = selected(input)
    input.contours.rooms[0] = {
      roomSourceNumbers: [3.1, 4],
      polygon: room.polygon,
      sourceTopology: room.sourceTopology,
    }
    expect(sourceTopologyDraftIssue(input)).toBe('source-topology-features-not-supported')
    input.contours.rooms = [room, structuredClone(room)]
    expect(sourceTopologyDraftIssue(input)).toBe('duplicate-room-membership')
  })

  it('preserves legacy validation in a mixed draft and on the legacy-only path', () => {
    const input = fixture()
    input.reading.rooms.push({ name: 'Кухня', kind: 'kitchen', sourceNumber: 4 })
    const polygon = [
      { x: 500, y: 500 },
      { x: 550, y: 500 },
      { x: 550, y: 550 },
      { x: 500, y: 550 },
    ]
    input.evidence.work.paths.push({
      operationIndex: 40,
      subpathIndex: 0,
      paint: 'stroke',
      closed: true,
      points: polygon,
    })
    input.contours.rooms.push({ roomSourceNumber: 4, polygon: structuredClone(polygon) })
    expect(sourceTopologyDraftIssue(input)).toBeUndefined()
    required(required(input.contours.rooms[1]).polygon[0]).x += 0.001
    expect(sourceTopologyDraftIssue(input)).toBe('non-native-contour-vertex')
    input.contours.rooms.shift()
    expect(sourceTopologyDraftIssue(input)).toBe(
      planPageReviewIssue(input.contours, input.reading, input.source, input.linework),
    )
  })
})
