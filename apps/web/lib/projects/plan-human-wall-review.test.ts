import type { PlanGeometry, PlanPageContours, PlanReading, PlanWallFacePair } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import { humanWallReviewCandidates } from './plan-human-wall-review'
import { planPageGeometryElementId } from './plan-page-metric-draft'
import type { PdfLinework, PdfVectorPath } from './plan-pdf-linework'

const source = { sha256: 'a'.repeat(64), pdfPage: 1, state: 'existing' as const }
const rectangle = (left: number, top: number, right: number, bottom: number) => [
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
  const work: PdfLinework = {
    coordinateSystem: 'page-0-1000',
    pageWidth: 1000,
    pageHeight: 1000,
    skippedCurves: 0,
    clippedPaths: 0,
    unsupportedPaths: 0,
    unsupportedContexts: 0,
    truncated: false,
    paths: [
      wall,
      ...contours.rooms
        .flatMap((room) => room.polygon)
        .map(
          (point, index): PdfVectorPath => ({
            operationIndex: 100 + index,
            subpathIndex: 0,
            paint: 'stroke',
            closed: false,
            points: [point],
          }),
        ),
    ],
  }
  const rooms: PlanGeometry['rooms'] = contours.rooms.map((room) => ({
    name: `Комната ${room.roomSourceNumber}`,
    sourceNumber: room.roomSourceNumber,
    polygon: room.polygon.map((point) => ({ xCm: point.x, yCm: point.y })),
  }))
  const geometry: PlanGeometry = {
    version: 1,
    source: 'manual',
    status: 'draft',
    widthCm: 400,
    heightCm: 400,
    rooms,
    openings: [],
    warnings: [],
    walls: contours.rooms.flatMap((room) =>
      room.polygon.map((point, index) => {
        const end = room.polygon[(index + 1) % room.polygon.length]
        if (!end) throw new Error('Missing source edge')
        return {
          id: planPageGeometryElementId(source, String(room.roomSourceNumber), 'wall', index),
          kind: 'inner' as const,
          start: { xCm: point.x, yCm: point.y },
          end: { xCm: end.x, yCm: end.y },
        }
      }),
    ),
    pdfCalibration: {
      sourceSha256: source.sha256,
      pdfPage: source.pdfPage,
      cmPerPoint: 1,
      origin: { x: 0, y: 0 },
      anchorRoomNumbers: [],
      labelIndexes: [],
      derivedOpeningIds: [],
      wallFaceRoomPolygons: structuredClone(rooms.map((room) => room.polygon)),
      sourceWallFacePairs: [],
      wallFacePairs: [],
    },
  }
  const reading: PlanReading = {
    readAt: '2026-10-24',
    planState: 'existing',
    sourcePage: 1,
    rooms: rooms.map((room) => ({
      name: room.name,
      sourceNumber: room.sourceNumber,
      kind: 'living',
    })),
    geometry,
    pageReview: { version: 1, savedAt: '2026-10-24', contours },
  }
  return { reading, geometry, work }
}

describe('human wall pair options stay bound to current source geometry', () => {
  it('returns exact source candidates with stable host IDs and no accepted verification', () => {
    const input = fixture()
    const options = humanWallReviewCandidates(input.reading, input.work)
    expect(options).toHaveLength(2)
    for (const option of options) {
      expect(option.id).toMatch(/^[a-f0-9]{64}$/)
      expect(option.metricPair.verification).toBeUndefined()
      expect(
        option.metricPair.faces.every((face) => face.nativeSegment.operationIndex === 10),
      ).toBe(true)
      expect(
        option.metricPair.faces.every((face) =>
          input.geometry.walls.some((wall) => wall.id === face.wall.id),
        ),
      ).toBe(true)
    }
  })

  it('does not offer a source pair after a host kind changes', () => {
    const input = fixture()
    const [option] = humanWallReviewCandidates(input.reading, input.work)
    if (!option) throw new Error('Missing source candidate')
    const wall = input.geometry.walls.find((wall) => wall.id === option.metricPair.faces[0].wall.id)
    if (!wall) throw new Error('Missing host')
    wall.kind = 'outer'
    expect(humanWallReviewCandidates(input.reading, input.work)).toEqual([])
  })

  it('requires a one-to-one room snapshot match rather than accepting a duplicate polygon', () => {
    const input = fixture()
    const snapshots = input.geometry.pdfCalibration?.wallFaceRoomPolygons
    if (!snapshots?.[0]) throw new Error('Missing room snapshots')
    snapshots[1] = structuredClone(snapshots[0])
    expect(humanWallReviewCandidates(input.reading, input.work)).toEqual([])
  })

  it('hides a current human review and offers it again when a host opening snapshot becomes stale', () => {
    const input = fixture()
    const calibration = input.geometry.pdfCalibration
    const [initial] = humanWallReviewCandidates(input.reading, input.work)
    if (!calibration || !initial) throw new Error('Missing candidate calibration')
    const firstHost = initial.metricPair.faces.find(
      (face) => face.wall.start.xCm === 200 && face.wall.end.xCm === 200,
    )
    if (!firstHost) throw new Error('Missing long host')
    input.geometry.openings.push({
      id: 'outside-reviewed-span',
      type: 'door',
      wallId: firstHost.wall.id,
      offsetCm: 150,
      widthCm: 10,
    })
    const candidate = humanWallReviewCandidates(input.reading, input.work).find(
      (option) => option.id === initial.id,
    )
    if (!candidate) throw new Error('Opening outside the span should leave the source option')
    const reviewed: PlanWallFacePair = {
      ...candidate.metricPair,
      verification: { kind: 'human-source-review', reviewedAt: '2026-10-24T00:00:00.000Z' },
    }
    calibration.sourceWallFacePairs = [reviewed]
    calibration.wallFacePairs = [reviewed]
    expect(
      humanWallReviewCandidates(input.reading, input.work).some(
        (option) => option.id === initial.id,
      ),
    ).toBe(false)
    const opening = input.geometry.openings[0]
    if (!opening) throw new Error('Missing host opening')
    opening.widthCm = 11
    const resverka = humanWallReviewCandidates(input.reading, input.work).find(
      (option) => option.id === initial.id,
    )
    expect(resverka?.metricPair.openings[0]?.widthCm).toBe(11)
    expect(resverka?.metricPair.verification).toBeUndefined()
  })
})
