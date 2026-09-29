import type { PlanPageContours } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import type { PdfLinework, PdfVectorPath } from './plan-pdf-linework'
import { inspectPlanPageWallSolids } from './plan-pdf-wall-solids'

const source = { sha256: 'a'.repeat(64), pdfPage: 1, state: 'existing' as const }
const rect = (left: number, top: number, right: number, bottom: number) => [
  { x: left, y: top },
  { x: right, y: top },
  { x: right, y: bottom },
  { x: left, y: bottom },
]
function fixture(gap = 0) {
  const contours: PlanPageContours = {
    source,
    coordinateSystem: 'page-0-1000',
    review: 'manual-source-review',
    pageWidth: 1000,
    pageHeight: 1000,
    rooms: [
      { roomSourceNumber: 1, polygon: rect(100, 100, 200, 300) },
      { roomSourceNumber: 2, polygon: rect(220, 100, 320, 300) },
    ],
  }
  const paths: PdfVectorPath[] = [
    {
      operationIndex: 1,
      subpathIndex: 0,
      paint: 'stroke',
      closed: true,
      points: rect(200, 100, 220, 200),
    },
    {
      operationIndex: 2,
      subpathIndex: 0,
      paint: 'stroke',
      closed: true,
      points: rect(200, 200 + gap, 220, 300),
    },
    ...contours.rooms
      .flatMap((room) => room.polygon)
      .map((point, index) => ({
        operationIndex: 10 + index,
        subpathIndex: 0,
        paint: 'stroke' as const,
        closed: false,
        points: [point],
      })),
  ]
  const work: PdfLinework = {
    coordinateSystem: 'page-0-1000',
    pageWidth: 1000,
    pageHeight: 1000,
    paths,
    skippedCurves: 0,
    unsupportedPaths: 0,
    unsupportedContexts: 0,
    clippedPaths: 0,
    truncated: false,
  }
  return { work, contours }
}
describe('native wall solid candidates and exact joints', () => {
  it('excludes wall bodies crossing a reviewed technical void and keeps their source', () => {
    const input = fixture()
    const voidPolygon = rect(205, 150, 215, 180)
    input.contours.voids = [{ id: 'shaft', polygon: voidPolygon }]
    input.work.paths.push({
      operationIndex: 70,
      subpathIndex: 0,
      paint: 'stroke',
      closed: true,
      points: voidPolygon,
    })
    const result = inspectPlanPageWallSolids(input.work, source, input.contours)
    expect(result.solids.find((solid) => solid.source.operationIndex === 1)).toMatchObject({
      sourcePaint: 'stroke',
      status: 'conflict',
      reasons: ['void'],
      conflicts: { voidIds: ['shaft'] },
    })
    expect(result.solids.find((solid) => solid.source.operationIndex === 2)?.status).toBe(
      'candidate',
    )
    expect(result.junctions).toEqual([])
    expect(result.components).toEqual([[{ operationIndex: 2, subpathIndex: 0 }]])
    input.work.paths.pop()
    expect(inspectPlanPageWallSolids(input.work, source, input.contours).solids).toEqual([])
  })

  it('reports the exact source edges escaping the exterior without changing them', () => {
    const input = fixture()
    const body = input.work.paths[0]
    if (!body) throw new Error('Missing body')
    body.points = rect(200, 90, 220, 200)
    input.contours.exterior = { polygon: rect(100, 100, 320, 300) }
    const before = structuredClone(input)
    const result = inspectPlanPageWallSolids(input.work, source, input.contours)
    const solid = result.solids.find((candidate) => candidate.source.operationIndex === 1)
    expect(solid?.reasons).toEqual(['outside-exterior'])
    expect(solid?.conflicts.exteriorEdges).toEqual([
      { segmentIndex: 0, start: { x: 200, y: 90 }, end: { x: 220, y: 90 } },
      { segmentIndex: 1, start: { x: 220, y: 90 }, end: { x: 220, y: 200 } },
      { segmentIndex: 3, start: { x: 200, y: 200 }, end: { x: 200, y: 90 } },
    ])
    expect(result.junctions).toEqual([])
    expect(input).toEqual(before)
  })

  it('retains one-sided evidence while still rejecting whole-body floor intrusion', () => {
    const input = fixture()
    const body = input.work.paths[0]
    if (!body) throw new Error('Missing body')
    body.paint = 'fill'
    input.work.paths = input.work.paths.filter((path) => path.operationIndex !== 2)
    input.work.paths.push({
      operationIndex: 40,
      subpathIndex: 0,
      paint: 'stroke',
      closed: false,
      points: [
        { x: 200, y: 100 },
        { x: 200, y: 200 },
      ],
    })
    input.contours.rooms = input.contours.rooms.slice(0, 1)
    const result = inspectPlanPageWallSolids(input.work, source, input.contours)
    expect(result.solids).toHaveLength(1)
    expect(result.solids[0]).toMatchObject({
      sourcePaint: 'fill',
      status: 'candidate',
      boundarySupports: [{ strokeSegment: { operationIndex: 40 }, contourKey: '1' }],
    })
    expect(
      inspectPlanPageWallSolids(input.work, { ...source, pdfPage: 2 }, input.contours).solids,
    ).toEqual([])
    input.contours.rooms.push({ roomSourceNumber: 3, polygon: rect(210, 150, 220, 200) })
    input.work.paths.push({
      operationIndex: 41,
      subpathIndex: 0,
      paint: 'stroke',
      closed: true,
      points: rect(210, 150, 220, 200),
    })
    expect(inspectPlanPageWallSolids(input.work, source, input.contours).solids[0]).toMatchObject({
      status: 'conflict',
      reasons: ['room-floor'],
    })
  })

  it('reports stable connected components independently of source path ordering', () => {
    const input = fixture()
    const result = inspectPlanPageWallSolids(input.work, source, input.contours)
    expect(result.components).toEqual([
      [
        { operationIndex: 1, subpathIndex: 0 },
        { operationIndex: 2, subpathIndex: 0 },
      ],
    ])
    input.work.paths.reverse()
    expect(inspectPlanPageWallSolids(input.work, source, input.contours)).toEqual(result)
    const separated = fixture(0.001)
    expect(
      inspectPlanPageWallSolids(separated.work, source, separated.contours).components,
    ).toEqual([[{ operationIndex: 1, subpathIndex: 0 }], [{ operationIndex: 2, subpathIndex: 0 }]])
  })

  it('refuses an unsplit body closing an annotated door on its face', () => {
    const input = fixture()
    const room = input.contours.rooms[0]
    if (!room) throw new Error('Missing room')
    room.openings = [
      {
        id: 'door',
        kind: 'door',
        wallEdgeIndex: 1,
        start: { x: 200, y: 150 },
        end: { x: 200, y: 180 },
      },
    ]
    input.work.paths.push(
      ...[150, 180].map((y, index) => ({
        operationIndex: 30 + index,
        subpathIndex: 0,
        paint: 'stroke' as const,
        closed: false,
        points: [{ x: 200, y }],
      })),
    )
    const result = inspectPlanPageWallSolids(input.work, source, input.contours)
    expect(result.solids.find((solid) => solid.source.operationIndex === 1)).toMatchObject({
      status: 'conflict',
      reasons: ['opening'],
      conflicts: { openings: [{ contourKey: '1', openingId: 'door' }] },
    })
    expect(result.junctions).toEqual([])
  })

  it('does not merge overlapping source bodies into a junction', () => {
    const input = fixture(-10)
    const result = inspectPlanPageWallSolids(input.work, source, input.contours)
    expect(result.solids).toHaveLength(2)
    expect(result.solids.every((solid) => solid.reasons.includes('overlapping-solid'))).toBe(true)
    expect(result.solids[0]?.conflicts.overlappingSources).toEqual([
      { operationIndex: 2, subpathIndex: 0 },
    ])
    expect(result.solids[1]?.conflicts.overlappingSources).toEqual([
      { operationIndex: 1, subpathIndex: 0 },
    ])
    expect(result.junctions).toEqual([])
  })

  it('finds a mitred corner without filling the surrounding free floor', () => {
    const input = fixture()
    input.contours.rooms = [
      { roomSourceNumber: 1, polygon: rect(100, 100, 200, 220) },
      { roomSourceNumber: 2, polygon: rect(220, 100, 320, 200) },
      { roomSourceNumber: 3, polygon: rect(200, 220, 300, 300) },
    ]
    input.work.paths = [
      {
        operationIndex: 1,
        subpathIndex: 0,
        paint: 'stroke',
        closed: true,
        points: [
          { x: 200, y: 100 },
          { x: 220, y: 100 },
          { x: 220, y: 200 },
          { x: 200, y: 220 },
        ],
      },
      {
        operationIndex: 2,
        subpathIndex: 0,
        paint: 'stroke',
        closed: true,
        points: [
          { x: 200, y: 220 },
          { x: 220, y: 200 },
          { x: 300, y: 200 },
          { x: 300, y: 220 },
        ],
      },
      ...input.contours.rooms
        .flatMap((room) => room.polygon)
        .map((point, index) => ({
          operationIndex: 10 + index,
          subpathIndex: 0,
          paint: 'stroke' as const,
          closed: false,
          points: [point],
        })),
    ]
    const result = inspectPlanPageWallSolids(input.work, source, input.contours)
    expect(result.solids.every((solid) => solid.status === 'candidate')).toBe(true)
    expect(result.junctions).toHaveLength(1)
    expect(result.junctions[0]).toMatchObject({
      start: { x: 200, y: 220 },
      end: { x: 220, y: 200 },
    })
  })

  it('keeps source polygons and identifies shared edges without union or mutation', () => {
    const input = fixture()
    const before = structuredClone(input)
    const result = inspectPlanPageWallSolids(input.work, source, input.contours)
    expect(result.solids).toHaveLength(2)
    expect(result.solids.every((solid) => solid.status === 'candidate')).toBe(true)
    expect(result.junctions).toEqual([
      {
        first: { operationIndex: 1, subpathIndex: 0 },
        second: { operationIndex: 2, subpathIndex: 0 },
        start: { x: 200, y: 200 },
        end: { x: 220, y: 200 },
      },
    ])
    expect(input).toEqual(before)
  })
  it('does not bridge even a small native gap', () => {
    const input = fixture(0.001)
    const result = inspectPlanPageWallSolids(input.work, source, input.contours)
    expect(result.solids).toHaveLength(2)
    expect(result.junctions).toEqual([])
  })
  it('does not turn an unrelated page rectangle or shaft void into wall material', () => {
    const input = fixture()
    input.work.paths.push({
      operationIndex: 99,
      subpathIndex: 0,
      paint: 'fill',
      closed: true,
      points: rect(500, 100, 550, 300),
    })
    expect(
      inspectPlanPageWallSolids(input.work, source, input.contours).solids.map(
        (s) => s.source.operationIndex,
      ),
    ).toEqual([1, 2])
  })
  it('rejects a whole source body invading floor beyond its locally valid face pair', () => {
    const input = fixture()
    const path = input.work.paths[0]
    if (!path) throw new Error('Missing source body')
    path.points = [
      { x: 200, y: 100 },
      { x: 220, y: 100 },
      { x: 220, y: 150 },
      { x: 240, y: 150 },
      { x: 240, y: 180 },
      { x: 220, y: 180 },
      { x: 220, y: 200 },
      { x: 200, y: 200 },
    ]
    const result = inspectPlanPageWallSolids(input.work, source, input.contours)
    expect(result.solids.find((s) => s.source.operationIndex === 1)).toMatchObject({
      status: 'conflict',
      reasons: ['room-floor'],
      conflicts: { roomContours: ['2'] },
    })
    expect(result.junctions).toEqual([])
  })
  it('refuses changed source identity', () => {
    const input = fixture()
    expect(
      inspectPlanPageWallSolids(input.work, { ...source, sha256: 'b'.repeat(64) }, input.contours),
    ).toEqual({ solids: [], junctions: [], components: [] })
  })
})
