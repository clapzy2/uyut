import type { PlanPageContours, PlanReading } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import { exactNativeCrossing } from './plan-native-exact-intersections'
import {
  planPageContoursSchema,
  planPageFeaturesIssue,
  planPageReviewIssue,
  retainedPlanPageReview,
  sourceRoomContourVertices,
} from './plan-page-review'
import type { PdfLinework } from './plan-pdf-linework'
import { nativePageSegments } from './plan-pdf-opening-endpoint'

const contours: PlanPageContours = {
  source: { sha256: 'a'.repeat(64), pdfPage: 6, state: 'existing' },
  coordinateSystem: 'page-0-1000',
  review: 'manual-source-review',
  pageWidth: 842,
  pageHeight: 1191,
  rooms: [
    {
      roomSourceNumber: 4,
      polygon: [
        { x: 10, y: 10 },
        { x: 30, y: 10 },
        { x: 30, y: 30 },
      ],
    },
  ],
}
const reading: PlanReading = {
  sourcePage: 6,
  planState: 'existing',
  readAt: '2026-09-27',
  rooms: [{ name: 'Спальня', kind: 'bedroom', sourceNumber: 4 }],
  pageReview: { version: 1, savedAt: '2026-09-27', contours },
}

describe('decimal source room identities', () => {
  it('parses informational source trace only on a physical existing room', () => {
    const sourceTrace = {
      polygon: structuredClone(contours.rooms[0]?.polygon),
      sourceTopology: {
        kind: 'unclassified-source-paint' as const,
        floorId: 'floor-4',
        exactPointKeys: ['10/1:10/1', '30/1:10/1', '30/1:30/1'],
        holes: [],
        holeExactPointKeys: [],
      },
    }
    const room = { ...contours.rooms[0], sourceTrace }
    expect(planPageContoursSchema.parse({ ...contours, rooms: [room] }).rooms[0]).toEqual(room)
    expect(
      planPageContoursSchema.safeParse({
        ...contours,
        rooms: [{ ...room, sourceTopology: sourceTrace.sourceTopology }],
      }).success,
    ).toBe(false)
    expect(
      planPageContoursSchema.safeParse({
        ...contours,
        source: { ...contours.source, state: 'proposed' },
        rooms: [room],
      }).success,
    ).toBe(false)
  })
  it('preserves distinct parent and subroom identities in source review', () => {
    const rooms = [3, 3.1].map((roomSourceNumber) => ({ ...contours.rooms[0], roomSourceNumber }))
    expect(
      planPageContoursSchema
        .parse({ ...contours, rooms })
        .rooms.map((room) => ('roomSourceNumber' in room ? room.roomSourceNumber : undefined)),
    ).toEqual([3, 3.1])
  })
  it.each([3.1001, 0.1, -3.1, Number.NaN, Number.POSITIVE_INFINITY, 10000.1])(
    'rejects invalid source identity %s without rounding it',
    (roomSourceNumber) => {
      expect(
        planPageContoursSchema.safeParse({
          ...contours,
          rooms: [{ ...contours.rooms[0], roomSourceNumber }],
        }).success,
      ).toBe(false)
    },
  )
})
const linework: PdfLinework = {
  coordinateSystem: 'page-0-1000',
  pageWidth: 842,
  pageHeight: 1191,
  paths: [
    {
      operationIndex: 1,
      subpathIndex: 0,
      paint: 'stroke',
      closed: false,
      points: [
        { x: 10, y: 10 },
        { x: 30, y: 10 },
        { x: 30, y: 30 },
      ],
    },
  ],
  skippedCurves: 0,
  unsupportedPaths: 0,
  unsupportedContexts: 0,
  clippedPaths: 0,
  truncated: false,
}

describe('versioned source page review', () => {
  function crossingReview() {
    const work = structuredClone(linework)
    work.paths = [
      {
        ...at(linework.paths),
        points: [
          { x: 10, y: 10 },
          { x: 40, y: 10 },
        ],
      },
      {
        ...at(linework.paths),
        operationIndex: 2,
        points: [
          { x: 30, y: 0 },
          { x: 30, y: 30 },
        ],
      },
    ]
    const input = structuredClone(contours)
    at(input.rooms).vertexProofs = [
      {
        vertexIndex: 1,
        kind: 'bounded-native-crossing',
        segments: work.paths.map((path) => ({
          operationIndex: path.operationIndex,
          subpathIndex: 0,
          segmentIndex: 0,
          start: { ...at(path.points) },
          end: { ...at(path.points, 1) },
        })) as NonNullable<PlanPageContours['rooms'][number]['vertexProofs']>[number]['segments'],
      },
    ]
    return { input, work }
  }

  it('rechecks an explicitly reviewed bounded crossing against fresh native segments', () => {
    const { input, work } = crossingReview()
    const before = structuredClone({ input, work })
    expect(planPageContoursSchema.safeParse(input).success).toBe(true)
    expect(planPageReviewIssue(input, reading, input.source, work)).toBeUndefined()
    expect({ input, work }).toEqual(before)
    delete at(input.rooms).vertexProofs
    expect(planPageReviewIssue(input, reading, input.source, work)).toBe(
      'non-native-contour-vertex',
    )
  })

  function diagonalCrossingReview() {
    const work = structuredClone(linework)
    work.paths = [
      {
        ...at(linework.paths),
        points: [
          { x: 10, y: 10 },
          { x: 40, y: 40 },
        ],
      },
      {
        ...at(linework.paths),
        operationIndex: 2,
        points: [
          { x: 10, y: 35 },
          { x: 35, y: 10 },
        ],
      },
    ]
    const segments = nativePageSegments(work)
    const input = structuredClone(contours)
    const room = at(input.rooms)
    room.polygon = [
      { x: 10, y: 10 },
      { x: 22.5, y: 22.5 },
      { x: 35, y: 10 },
    ]
    room.vertexProofs = [
      {
        vertexIndex: 1,
        kind: 'bounded-native-rational-crossing',
        exactPointKey: '45/2:45/2',
        segments: [structuredClone(at(segments)), structuredClone(at(segments, 1))],
      },
    ]
    return { input, work }
  }

  it('rechecks an exactly representable diagonal crossing without moving source coordinates', () => {
    const { input, work } = diagonalCrossingReview()
    const before = structuredClone({ input, work })
    expect(planPageContoursSchema.safeParse(input).success).toBe(true)
    expect(planPageReviewIssue(input, reading, input.source, work)).toBeUndefined()
    expect({ input, work }).toEqual(before)
  })

  it.each([
    'wrong-key',
    'unreduced-key',
    'rounded-point',
    'stale-snapshot',
    'duplicate-index',
    'duplicate-ref',
    'same-ref',
    'missing-source',
    'extension',
    'legacy-kind',
  ])('refuses %s diagonal crossing evidence without coordinate repair', (change) => {
    const { input, work } = diagonalCrossingReview()
    const room = at(input.rooms)
    const proof = at(room.vertexProofs)
    if (proof.kind !== 'bounded-native-rational-crossing') throw new Error('Missing rational proof')
    if (change === 'wrong-key') proof.exactPointKey = '46/2:45/2'
    if (change === 'unreduced-key') proof.exactPointKey = '90/4:90/4'
    if (change === 'rounded-point') at(room.polygon, 1).x += 0.000001
    if (change === 'stale-snapshot') proof.segments[0].end.x += 1
    if (change === 'duplicate-index') room.vertexProofs?.push(structuredClone(proof))
    if (change === 'duplicate-ref') work.paths.push(structuredClone(at(work.paths)))
    if (change === 'same-ref') proof.segments[1] = structuredClone(proof.segments[0])
    if (change === 'missing-source') work.paths.pop()
    if (change === 'extension') {
      at(at(work.paths).points, 1).x = 20
      at(at(work.paths).points, 1).y = 20
      proof.segments[0].end = { x: 20, y: 20 }
    }
    if (change === 'legacy-kind')
      room.vertexProofs = [
        {
          vertexIndex: proof.vertexIndex,
          kind: 'bounded-native-crossing',
          segments: proof.segments,
        },
      ]
    expect(planPageReviewIssue(input, reading, input.source, work)).toBe(
      'non-native-contour-vertex',
    )
  })

  it.each([undefined, '', '0/0:1/1', '-1/1:1/1', '045/2:45/2', '2.25e1:2.25e1', '1'.repeat(257)])(
    'bounds the exact-key wire format before source revalidation (%s)',
    (exactPointKey) => {
      const { input } = diagonalCrossingReview()
      const proof = at(at(input.rooms).vertexProofs)
      expect(
        planPageContoursSchema.safeParse({
          ...input,
          rooms: [{ ...at(input.rooms), vertexProofs: [{ ...proof, exactPointKey }] }],
        }).success,
      ).toBe(false)
    },
  )

  it('holds a non-terminating source crossing instead of accepting its rounded display point', () => {
    const { input, work } = diagonalCrossingReview()
    at(work.paths, 1).points = [
      { x: 10, y: 11 },
      { x: 40, y: 10 },
    ]
    const segments = nativePageSegments(work)
    const crossing = exactNativeCrossing(at(segments), at(segments, 1))
    if (!crossing.point) throw new Error('Missing rational source intersection')
    const room = at(input.rooms)
    room.polygon[1] = crossing.point
    room.polygon[2] = { x: 40, y: 10 }
    room.vertexProofs = [
      {
        vertexIndex: 1,
        kind: 'bounded-native-rational-crossing',
        exactPointKey: crossing.exactPointKey,
        segments: [at(segments), at(segments, 1)],
      },
    ]
    expect(planPageContoursSchema.safeParse(input).success).toBe(true)
    expect(planPageReviewIssue(input, reading, input.source, work)).toBe(
      'non-native-contour-vertex',
    )
  })

  it('keeps the physical conditioning guard even for a rational proof', () => {
    const first = {
      operationIndex: 1,
      subpathIndex: 0,
      segmentIndex: 0,
      start: { x: 0, y: 0 },
      end: { x: 1000, y: 1000 },
    }
    const second = {
      operationIndex: 2,
      subpathIndex: 0,
      segmentIndex: 0,
      start: { x: 0, y: 0.00000000000001 },
      end: { x: 1000, y: 999.9999999999999 },
    }
    const paintCrossing = exactNativeCrossing(first, second, {
      topology: 'source-decimal-rational',
    })
    if (!paintCrossing.point) throw new Error('Missing paint-only rational crossing')
    expect(exactNativeCrossing(first, second).reason).toBe('ill-conditioned-intersection')
    expect(
      sourceRoomContourVertices(
        {
          polygon: [{ x: 0, y: 0 }, paintCrossing.point, { x: 1000, y: 0 }],
          vertexProofs: [
            {
              vertexIndex: 1,
              kind: 'bounded-native-rational-crossing',
              exactPointKey: paintCrossing.exactPointKey,
              segments: [first, second],
            },
          ],
        },
        new Set(['0:0', '1000:0']),
        [first, second],
      ),
    ).toBe(false)
  })

  it.each([
    'rounded',
    'changed-segment',
    'duplicate-proof',
    'duplicate-ref',
    'invalid-index',
    'same-segment',
    'extension',
  ])('refuses %s vertex evidence without snapping or extending source lines', (change) => {
    const { input, work } = crossingReview()
    const room = at(input.rooms)
    const proof = at(room.vertexProofs)
    if (change === 'rounded') at(room.polygon, 1).x += 0.000001
    if (change === 'changed-segment') at(at(work.paths).points, 1).x += 1
    if (change === 'duplicate-proof') room.vertexProofs?.push(structuredClone(proof))
    if (change === 'duplicate-ref') {
      const duplicate = structuredClone(at(work.paths))
      at(duplicate.points, 1).x += 1
      work.paths.push(duplicate)
    }
    if (change === 'invalid-index') proof.vertexIndex = 90
    if (change === 'same-segment') proof.segments[1] = structuredClone(proof.segments[0])
    if (change === 'extension') {
      at(at(work.paths).points, 1).x = 20
      proof.segments[0].end.x = 20
    }
    expect(planPageReviewIssue(input, reading, input.source, work)).toBe(
      'non-native-contour-vertex',
    )
  })

  it('uses the same fresh vertex proof for an exterior and a separate floor', () => {
    const { input, work } = crossingReview()
    const room = at(input.rooms)
    input.exterior = {
      polygon: structuredClone(room.polygon),
      vertexProofs: structuredClone(room.vertexProofs),
    }
    expect(planPageReviewIssue(input, reading, input.source, work)).toBeUndefined()
    delete input.exterior.vertexProofs
    expect(planPageReviewIssue(input, reading, input.source, work)).toBe(
      'non-native-contour-vertex',
    )
    const envelope = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 50 },
      { x: 0, y: 50 },
    ]
    input.exterior = { polygon: envelope, boundaryRole: 'outer-wall-envelope' }
    work.paths.push({ ...at(linework.paths), operationIndex: 3, points: envelope, closed: true })
    input.floor = {
      polygon: structuredClone(room.polygon),
      vertexProofs: structuredClone(room.vertexProofs),
    }
    work.paths.push({
      ...at(linework.paths),
      operationIndex: 4,
      points: structuredClone(room.polygon),
      closed: true,
    })
    expect(planPageReviewIssue(input, reading, input.source, work)).toBeUndefined()
    delete input.floor.vertexProofs
    work.paths.pop()
    expect(planPageReviewIssue(input, reading, input.source, work)).toBe('non-native-floor-vertex')
  })

  it('accepts a separate floor only inside an explicit outer-wall envelope with native vertices', () => {
    const exterior = {
      boundaryRole: 'outer-wall-envelope' as const,
      polygon: [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 40, y: 40 },
        { x: 0, y: 40 },
      ],
    }
    const floor = {
      polygon: [
        { x: 5, y: 5 },
        { x: 35, y: 5 },
        { x: 35, y: 35 },
        { x: 5, y: 35 },
      ],
    }
    const input = { ...contours, exterior, floor }
    const nativeWork = {
      ...linework,
      paths: [
        ...linework.paths,
        { ...at(linework.paths), operationIndex: 18, points: exterior.polygon },
        { ...at(linework.paths), operationIndex: 19, points: floor.polygon, closed: true },
      ],
    }
    expect(planPageContoursSchema.safeParse(input).success).toBe(true)
    expect(planPageReviewIssue(input, reading, input.source, nativeWork)).toBeUndefined()
    const paintedOnly = structuredClone(nativeWork)
    const paintedFloor = at(paintedOnly.paths, paintedOnly.paths.length - 1)
    paintedFloor.paint = 'fill'
    expect(planPageReviewIssue(input, reading, input.source, paintedOnly)).toBe(
      'non-native-floor-edge',
    )
    const dashed = structuredClone(nativeWork)
    const dashedFloor = at(dashed.paths, dashed.paths.length - 1)
    dashedFloor.strokeInk = {
      points: floor.polygon,
      sourceToPage: [1, 0, 0, 1, 0, 0],
      lineWidth: 1,
      lineCap: 0,
      lineJoin: 0,
      miterLimit: 10,
      dashArray: [2, 2],
      dashPhase: 0,
      refusalReason: 'dashed-source-pen',
    }
    expect(planPageReviewIssue(input, reading, input.source, dashed)).toBe('non-native-floor-edge')
    const disconnectedFloor = {
      ...nativeWork,
      paths: [
        ...nativeWork.paths.slice(0, -1),
        {
          ...at(linework.paths),
          operationIndex: 20,
          points: floor.polygon,
          closed: false,
        },
      ],
    }
    expect(planPageReviewIssue(input, reading, input.source, disconnectedFloor)).toBe(
      'non-native-floor-edge',
    )
    expect(
      planPageReviewIssue(input, reading, input.source, {
        ...nativeWork,
        paths: nativeWork.paths.slice(0, -1),
      }),
    ).toBe('non-native-floor-vertex')
    expect(planPageFeaturesIssue({ ...input, exterior: { polygon: exterior.polygon } })).toBe(
      'floor-requires-outer-wall-envelope',
    )
    expect(
      planPageFeaturesIssue({ ...input, exterior: { ...exterior, boundaryRole: 'floor' } }),
    ).toBe('floor-requires-outer-wall-envelope')
    expect(planPageFeaturesIssue({ ...input, exterior: undefined })).toBe(
      'floor-requires-outer-wall-envelope',
    )
    expect(planPageContoursSchema.safeParse({ ...input, exterior: undefined }).success).toBe(false)
    expect(
      planPageFeaturesIssue({
        ...input,
        floor: {
          polygon: [
            at(floor.polygon),
            at(floor.polygon, 2),
            at(floor.polygon, 1),
            at(floor.polygon, 3),
          ],
        },
      }),
    ).toBe('invalid-floor-contour')
    expect(
      planPageContoursSchema.safeParse({ ...input, floor: { polygon: floor.polygon.slice(0, 2) } })
        .success,
    ).toBe(false)
    expect(
      planPageContoursSchema.safeParse({
        ...input,
        floor: { polygon: Array.from({ length: 101 }, () => ({ x: 5, y: 5 })) },
      }).success,
    ).toBe(false)
  })

  it('checks all floor, room and void edges across concave boundary gaps', () => {
    const rectangle = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 40 },
      { x: 0, y: 40 },
    ]
    const concave = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 40 },
      { x: 25, y: 40 },
      { x: 25, y: 20 },
      { x: 15, y: 20 },
      { x: 15, y: 40 },
      { x: 0, y: 40 },
    ]
    const crossing = [
      { x: 10, y: 10 },
      { x: 30, y: 10 },
      { x: 30, y: 30 },
      { x: 10, y: 30 },
    ]
    const input: PlanPageContours = {
      ...contours,
      exterior: { boundaryRole: 'outer-wall-envelope', polygon: rectangle },
      floor: { polygon: concave },
      rooms: [
        {
          roomSourceNumber: 4,
          polygon: [
            { x: 1, y: 1 },
            { x: 3, y: 1 },
            { x: 3, y: 3 },
          ],
        },
      ],
    }
    expect(planPageFeaturesIssue(input)).toBeUndefined()
    expect(
      planPageFeaturesIssue({
        ...input,
        exterior: { ...input.exterior, boundaryRole: 'outer-wall-envelope', polygon: concave },
        floor: { polygon: crossing },
      }),
    ).toBe('floor-outside-exterior-contour')
    expect(
      planPageFeaturesIssue({ ...input, rooms: [{ roomSourceNumber: 4, polygon: crossing }] }),
    ).toBe('room-outside-floor-contour')
    expect(planPageFeaturesIssue({ ...input, voids: [{ id: 'shaft', polygon: crossing }] })).toBe(
      'void-outside-floor-contour',
    )
    expect(
      planPageFeaturesIssue({
        ...input,
        floor: { polygon: rectangle },
        rooms: [{ roomSourceNumber: 4, polygon: rectangle }],
      }),
    ).toBeUndefined()
  })

  it('accepts only source-backed technical voids outside room floors', () => {
    const polygon = [
      { x: 40, y: 40 },
      { x: 50, y: 40 },
      { x: 50, y: 50 },
      { x: 40, y: 50 },
    ]
    const input: PlanPageContours = { ...contours, voids: [{ id: 'shaft-a', polygon }] }
    const work: PdfLinework = {
      ...linework,
      paths: [
        ...linework.paths,
        { operationIndex: 2, subpathIndex: 0, paint: 'stroke', closed: true, points: polygon },
      ],
    }
    expect(planPageContoursSchema.safeParse(input).success).toBe(true)
    expect(planPageReviewIssue(input, reading, input.source, work)).toBeUndefined()
    expect(planPageReviewIssue(input, reading, input.source, linework)).toBe(
      'non-native-void-vertex',
    )
    const room = contours.rooms[0]
    if (!room) throw new Error('Missing room fixture')
    expect(
      planPageFeaturesIssue({ ...input, voids: [{ id: 'shaft-a', polygon: room.polygon }] }),
    ).toBe('void-overlaps-room-contour')
    expect(
      planPageFeaturesIssue({
        ...input,
        voids: [
          { id: 'shaft-a', polygon },
          { id: 'shaft-a', polygon },
        ],
      }),
    ).toBe('duplicate-page-void-id')
    expect(
      planPageFeaturesIssue({
        ...input,
        voids: [
          { id: 'shaft-a', polygon },
          { id: 'shaft-b', polygon },
        ],
      }),
    ).toBe('overlapping-page-voids')
    expect(planPageFeaturesIssue({ ...input, exterior: { polygon: room.polygon } })).toBe(
      'void-outside-exterior-contour',
    )
    expect(
      planPageFeaturesIssue({
        ...input,
        voids: [
          {
            id: 'shaft-a',
            polygon: [
              { x: 40, y: 40 },
              { x: 50, y: 50 },
              { x: 50, y: 40 },
              { x: 40, y: 50 },
            ],
          },
        ],
      }),
    ).toBe('invalid-page-void')
  })

  it('accepts a reviewed open-zone divider only when its non-node endpoint has native crossing proof', () => {
    const input: PlanPageContours = {
      ...contours,
      rooms: [
        {
          roomSourceNumber: 4,
          polygon: [
            { x: 10, y: 20 },
            { x: 30, y: 20 },
            { x: 30, y: 30 },
            { x: 10, y: 30 },
          ],
          conditionalEdges: [
            {
              wallEdgeIndex: 0,
              endpointProofs: {
                start: {
                  kind: 'native-edge-crossing',
                  operationIndex: 1,
                  subpathIndex: 0,
                  segmentIndex: 0,
                },
              },
            },
          ],
        },
      ],
    }
    const work: PdfLinework = {
      ...linework,
      paths: [
        {
          ...at(linework.paths),
          points: [
            { x: 10, y: 10 },
            { x: 10, y: 30 },
            { x: 30, y: 30 },
            { x: 30, y: 20 },
          ],
        },
      ],
    }
    expect(planPageContoursSchema.safeParse(input).success).toBe(true)
    expect(planPageReviewIssue(input, reading, input.source, work)).toBeUndefined()
    const withoutProof = structuredClone(input)
    withoutProof.rooms[0]?.conditionalEdges?.splice(0, 1, { wallEdgeIndex: 0 })
    expect(planPageReviewIssue(withoutProof, reading, input.source, work)).toBe(
      'non-native-contour-vertex',
    )
    const shifted = structuredClone(input)
    at(at(shifted.rooms).polygon).x = 11
    expect(planPageReviewIssue(shifted, reading, input.source, work)).toBe(
      'non-native-contour-vertex',
    )
    const unanchored = structuredClone(input)
    at(at(unanchored.rooms).polygon).y = 21
    at(at(unanchored.rooms).polygon, 1).y = 21
    expect(planPageReviewIssue(unanchored, reading, input.source, work)).toBe(
      'non-native-contour-vertex',
    )
  })

  it('rejects conditional edges with duplicates or a door on the same edge', () => {
    const input = featureContours()
    const room = at(input.rooms)
    room.conditionalEdges = [{ wallEdgeIndex: 0 }]
    expect(planPageFeaturesIssue(input)).toBe('opening-on-conditional-edge')
    room.conditionalEdges = [{ wallEdgeIndex: 2 }, { wallEdgeIndex: 2 }]
    expect(planPageFeaturesIssue(input)).toBe('invalid-conditional-edge')
    room.conditionalEdges = [{ wallEdgeIndex: 4 }]
    expect(planPageFeaturesIssue(input)).toBe('invalid-conditional-edge')
  })

  it('requires exactly one explication row for every member of a shared contour', () => {
    const input: PlanPageContours = {
      ...contours,
      rooms: [{ roomSourceNumbers: [1, 5], polygon: at(contours.rooms).polygon }],
    }
    const groupedReading: PlanReading = {
      ...reading,
      rooms: [
        { name: 'Прихожая', kind: 'living', sourceNumber: 1 },
        { name: 'Коридор', kind: 'living', sourceNumber: 5 },
      ],
    }
    expect(planPageContoursSchema.safeParse(input).success).toBe(true)
    expect(planPageReviewIssue(input, groupedReading, input.source, linework)).toBeUndefined()
    expect(
      planPageReviewIssue(
        input,
        { ...groupedReading, rooms: groupedReading.rooms.slice(0, 1) },
        input.source,
        linework,
      ),
    ).toBe('unknown-room-number')
    expect(
      planPageReviewIssue(
        input,
        { ...groupedReading, rooms: [...groupedReading.rooms, at(groupedReading.rooms)] },
        input.source,
        linework,
      ),
    ).toBe('unknown-room-number')
  })

  it.each([[1], [1, 1], [1, '5'], [1, 5, 1]].map((roomSourceNumbers) => ({ roomSourceNumbers })))(
    'rejects invalid group membership %j',
    ({ roomSourceNumbers }) => {
      expect(
        planPageContoursSchema.safeParse({
          ...contours,
          rooms: [{ roomSourceNumbers, polygon: at(contours.rooms).polygon }],
        }).success,
      ).toBe(false)
    },
  )

  it('rejects group/scalar and group/group repeated ownership or simultaneous keys', () => {
    const polygon = at(contours.rooms).polygon
    for (const rooms of [
      [
        { roomSourceNumbers: [1, 5], polygon },
        { roomSourceNumber: 5, polygon },
      ],
      [
        { roomSourceNumbers: [1, 5], polygon },
        { roomSourceNumbers: [5, 6], polygon },
      ],
      [{ roomSourceNumbers: [1, 5], roomSourceNumber: undefined, polygon }],
    ])
      expect(planPageContoursSchema.safeParse({ ...contours, rooms }).success).toBe(false)
  })

  it('requires native exterior vertices and full containment including concave edge crossings', () => {
    const exterior = {
      polygon: [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 40, y: 40 },
        { x: 0, y: 40 },
      ],
    }
    const input = { ...contours, exterior }
    expect(planPageContoursSchema.safeParse(input).success).toBe(true)
    expect(planPageReviewIssue(input, reading, input.source, linework)).toBe(
      'non-native-contour-vertex',
    )
    const nativeWork = {
      ...linework,
      paths: [...linework.paths, { ...at(linework.paths), points: exterior.polygon }],
    }
    expect(planPageReviewIssue(input, reading, input.source, nativeWork)).toBeUndefined()
    const concave = {
      polygon: [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 40, y: 40 },
        { x: 25, y: 40 },
        { x: 25, y: 20 },
        { x: 15, y: 20 },
        { x: 15, y: 40 },
        { x: 0, y: 40 },
      ],
    }
    const crossing = {
      ...input,
      exterior: concave,
      rooms: [
        {
          roomSourceNumber: 4,
          polygon: [
            { x: 10, y: 10 },
            { x: 30, y: 10 },
            { x: 30, y: 30 },
            { x: 10, y: 30 },
          ],
        },
      ],
    }
    expect(planPageFeaturesIssue(crossing)).toBe('room-outside-exterior-contour')
    expect(planPageContoursSchema.safeParse(crossing).success).toBe(false)
    expect(
      planPageFeaturesIssue({
        ...input,
        rooms: [{ roomSourceNumber: 4, polygon: exterior.polygon }],
      }),
    ).toBeUndefined()
  })

  it('checks intersecting polygon-only rooms for metric conversion without changing legacy saves', () => {
    const input: PlanPageContours = {
      ...contours,
      rooms: [
        {
          roomSourceNumber: 4,
          polygon: [
            { x: 10, y: 10 },
            { x: 30, y: 10 },
            { x: 30, y: 30 },
            { x: 10, y: 30 },
          ],
        },
        {
          roomSourceNumber: 6,
          polygon: [
            { x: 20, y: 20 },
            { x: 40, y: 20 },
            { x: 40, y: 40 },
            { x: 20, y: 40 },
          ],
        },
      ],
    }
    expect(planPageFeaturesIssue(input)).toBeUndefined()
    expect(planPageFeaturesIssue(input, { checkRoomOverlap: true })).toBe(
      'overlapping-room-contours',
    )
    const separate = structuredClone(input)
    const second = separate.rooms[1]
    if (!second) throw new Error('Missing second room')
    second.polygon = second.polygon.map((point) => ({ x: point.x + 10, y: point.y }))
    expect(planPageFeaturesIssue(separate, { checkRoomOverlap: true })).toBeUndefined()
  })

  it('accepts a bounded contour for the unique printed room number', () => {
    expect(planPageContoursSchema.safeParse(contours).success).toBe(true)
    expect(planPageReviewIssue(contours, reading, contours.source, linework)).toBeUndefined()
  })

  it.each([
    null,
    { ...contours, extra: true },
    { ...contours, rooms: [] },
    { ...contours, pageWidth: Infinity },
    { ...contours, rooms: [{ roomSourceNumber: 4, polygon: [{ x: -1, y: 2 }] }] },
  ])('rejects malformed browser input without throwing', (input) => {
    expect(planPageContoursSchema.safeParse(input).success).toBe(false)
  })

  it('rejects duplicate rooms and self-crossing contours', () => {
    expect(
      planPageReviewIssue(
        { ...contours, rooms: [...contours.rooms, ...contours.rooms] },
        reading,
        contours.source,
        linework,
      ),
    ).toBe('invalid-room-contours')
    const polygon = [
      { x: 10, y: 10 },
      { x: 30, y: 30 },
      { x: 10, y: 30 },
      { x: 30, y: 10 },
    ]
    expect(
      planPageReviewIssue(
        { ...contours, rooms: [{ roomSourceNumber: 4, polygon }] },
        reading,
        contours.source,
        linework,
      ),
    ).toBe('invalid-room-contours')
  })

  it('rejects different source files, page formats, and incomplete native layers', () => {
    expect(
      planPageReviewIssue(
        contours,
        reading,
        { ...contours.source, sha256: 'b'.repeat(64) },
        linework,
      ),
    ).toBe('different-plan-source')
    expect(
      planPageReviewIssue(contours, reading, contours.source, { ...linework, pageWidth: 1000 }),
    ).toBe('different-page-format')
    expect(
      planPageReviewIssue(contours, reading, contours.source, { ...linework, truncated: true }),
    ).toBe('incomplete-vector-layer')
    expect(
      planPageReviewIssue(contours, reading, contours.source, { ...linework, paths: [] }),
    ).toBe('missing-vector-layer')
  })

  it('does not bind by a matching name without a unique printed number', () => {
    expect(
      planPageReviewIssue(
        contours,
        { ...reading, rooms: [{ name: 'Спальня', kind: 'bedroom' }] },
        contours.source,
        linework,
      ),
    ).toBe('unknown-room-number')
    expect(
      planPageReviewIssue(
        contours,
        { ...reading, rooms: [...reading.rooms, ...reading.rooms] },
        contours.source,
        linework,
      ),
    ).toBe('unknown-room-number')
  })

  it('rejects valid-looking vertices that were not taken from the exact native layer', () => {
    const changed = structuredClone(contours)
    const vertex = changed.rooms[0]?.polygon[0]
    if (!vertex) throw new Error('Missing contour vertex')
    vertex.x += 0.1
    expect(planPageReviewIssue(changed, reading, contours.source, linework)).toBe(
      'non-native-contour-vertex',
    )
  })

  it('preserves renamed rooms and coordinate review without confirming measurements', () => {
    const room = reading.rooms[0]
    if (!room) throw new Error('Missing source room')
    const after = {
      ...reading,
      rooms: [{ ...room, name: 'Моя спальня', widthCm: 400 }],
    }
    expect(retainedPlanPageReview(reading, after)).toEqual(reading.pageReview)
    expect(after.rooms[0]).not.toHaveProperty('verification')
  })

  it.each([
    { ...reading, sourcePage: 12 },
    { ...reading, planState: 'proposed' as const },
    { ...reading, rooms: [] },
    { ...reading, rooms: [...reading.rooms, ...reading.rooms] },
  ])('drops review when source identity changes', (after) => {
    expect(retainedPlanPageReview(reading, after)).toBeUndefined()
  })

  it('includes page review changes in the existing edit revision', async () => {
    const { planEditRevision } = await import('./plan-edit-revision')
    expect(planEditRevision('plan.pdf', reading)).not.toBe(
      planEditRevision('plan.pdf', { ...reading, pageReview: undefined }),
    )
  })
})

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing feature fixture value')
  return value
}
function at<T>(items: readonly T[] | undefined, index = 0): T {
  return required(items?.[index])
}
const rectangle = (left: number, top: number, right: number, bottom: number) => [
  { x: left, y: top },
  { x: right, y: top },
  { x: right, y: bottom },
  { x: left, y: bottom },
]
function featureContours(): PlanPageContours {
  return {
    ...structuredClone(contours),
    rooms: [
      {
        roomSourceNumber: 4,
        polygon: rectangle(10, 10, 90, 90),
        openings: [
          {
            id: 'door-1',
            kind: 'door',
            wallEdgeIndex: 0,
            start: { x: 20, y: 10 },
            end: { x: 40, y: 10 },
          },
        ],
        obstacles: [{ id: 'shaft-1', kind: 'shaft', polygon: rectangle(10, 50, 30, 70) }],
      },
    ],
  }
}
function nativeFeatureWork(input: PlanPageContours): PdfLinework {
  return {
    ...linework,
    pageWidth: input.pageWidth,
    pageHeight: input.pageHeight,
    paths: [
      {
        ...at(linework.paths),
        points: structuredClone(
          input.rooms.flatMap((room) => [
            ...room.polygon,
            ...(room.openings ?? []).flatMap((opening) => [opening.start, opening.end]),
            ...(room.obstacles ?? []).flatMap((obstacle) => obstacle.polygon),
          ]),
        ),
      },
    ],
  }
}

describe('manual source opening and obstacle annotations', () => {
  it('accepts exact source nodes on a declared edge and an obstacle touching its room wall', () => {
    const input = featureContours()
    expect(planPageContoursSchema.safeParse(input).success).toBe(true)
    expect(
      planPageReviewIssue(input, reading, input.source, nativeFeatureWork(input)),
    ).toBeUndefined()
    expect(input.rooms[0]).not.toHaveProperty('widthCm')
  })

  it('retains the whole reviewed payload when printed identities remain stable', () => {
    const input = featureContours()
    const before = {
      ...reading,
      pageReview: { version: 1 as const, savedAt: 'now', contours: input },
    }
    expect(retainedPlanPageReview(before, reading)).toBe(before.pageReview)
  })

  it.each([
    (input: PlanPageContours) => {
      Reflect.set(at(at(input.rooms).openings), 'extra', true)
    },
    (input: PlanPageContours) => {
      at(at(input.rooms).openings).wallEdgeIndex = -1
    },
    (input: PlanPageContours) => {
      at(at(input.rooms).openings).id = ' '
    },
    (input: PlanPageContours) => {
      at(at(at(input.rooms).obstacles).polygon).x = Infinity
    },
    (input: PlanPageContours) => {
      at(at(input.rooms).obstacles).polygon = rectangle(0, 0, 1, 1).slice(0, 2)
    },
  ])('rejects malformed, unknown, or unbounded feature data', (change) => {
    const input = featureContours()
    change(input)
    expect(planPageContoursSchema.safeParse(input).success).toBe(false)
  })

  it('refuses ids reused by an opening and obstacle in the same room', () => {
    const input = featureContours()
    at(at(input.rooms).obstacles).id = 'door-1'
    expect(planPageFeaturesIssue(input)).toBe('duplicate-page-feature-id')
    expect(planPageContoursSchema.safeParse(input).success).toBe(false)
    const before = {
      ...reading,
      pageReview: { version: 1 as const, savedAt: 'now', contours: input },
    }
    expect(retainedPlanPageReview(before, reading)).toBeUndefined()
  })

  it.each([1, 4, 99])('refuses a foreign or missing declared wall edge %i', (edge) => {
    const input = featureContours()
    at(at(input.rooms).openings).wallEdgeIndex = edge
    expect(planPageContoursSchema.safeParse(input).success).toBe(false)
  })

  it.each([
    [
      { x: 0, y: 10 },
      { x: 40, y: 10 },
    ],
    [
      { x: 20, y: 10 },
      { x: 100, y: 10 },
    ],
    [
      { x: 20, y: 10 },
      { x: 90, y: 20 },
    ],
    [
      { x: 20, y: 10 },
      { x: 20, y: 10 },
    ],
  ])('refuses intervals outside an edge, across a corner, or of zero length', (start, end) => {
    const input = featureContours()
    Object.assign(at(at(input.rooms).openings), { start, end })
    expect(planPageFeaturesIssue(input)).toBe('opening-outside-wall-edge')
  })

  it('uses physical PDF point tolerance and still requires exact native opening coordinates', () => {
    const input = featureContours()
    const work = nativeFeatureWork(input)
    at(at(input.rooms).openings).start.y += 0.01
    expect(planPageContoursSchema.safeParse(input).success).toBe(true)
    expect(planPageReviewIssue(input, reading, input.source, work)).toBe(
      'non-native-opening-vertex',
    )
    at(at(input.rooms).openings).start.y = 10 + 0.12 / (1191 / 1000) + 0.0001
    expect(planPageFeaturesIssue(input)).toBe('opening-outside-wall-edge')
  })

  it.each([
    [
      { x: 20, y: 10 },
      { x: 40, y: 10 },
    ],
    [
      { x: 30, y: 10 },
      { x: 60, y: 10 },
    ],
    [
      { x: 40, y: 10 },
      { x: 20, y: 10 },
    ],
  ])('refuses duplicate, reversed, or intersecting opening intervals', (start, end) => {
    const input = featureContours()
    required(at(input.rooms).openings).push({
      id: 'window-1',
      kind: 'window',
      wallEdgeIndex: 0,
      start,
      end,
    })
    expect(planPageFeaturesIssue(input)).toBe('overlapping-page-openings')
  })

  it('allows separate intervals, including an adjoining endpoint, on the same edge', () => {
    const input = featureContours()
    required(at(input.rooms).openings).push({
      id: 'window-1',
      kind: 'window',
      wallEdgeIndex: 0,
      start: { x: 40, y: 10 },
      end: { x: 60, y: 10 },
    })
    expect(planPageFeaturesIssue(input)).toBeUndefined()
  })

  it('refuses an obstacle not using exact native PDF vertices', () => {
    const input = featureContours()
    const work = nativeFeatureWork(input)
    at(at(at(input.rooms).obstacles).polygon, 1).x += 0.01
    expect(planPageReviewIssue(input, reading, input.source, work)).toBe(
      'non-native-obstacle-vertex',
    )
  })

  it.each([
    rectangle(0, 50, 30, 70),
    rectangle(10, 50, 30, 70).map(() => ({ x: 20, y: 60 })),
    [
      { x: 20, y: 50 },
      { x: 40, y: 70 },
      { x: 20, y: 70 },
      { x: 40, y: 50 },
    ],
  ])('refuses outside, degenerate, and self-crossing obstacles', (...points) => {
    const input = featureContours()
    at(at(input.rooms).obstacles).polygon = points
    expect(planPageContoursSchema.safeParse(input).success).toBe(false)
  })

  it('checks the complete obstacle edges through a concave room, not its vertices or centroid', () => {
    const input = featureContours()
    at(input.rooms).polygon = [
      { x: 10, y: 10 },
      { x: 90, y: 10 },
      { x: 90, y: 90 },
      { x: 60, y: 90 },
      { x: 60, y: 40 },
      { x: 40, y: 40 },
      { x: 40, y: 90 },
      { x: 10, y: 90 },
    ]
    at(at(input.rooms).obstacles).polygon = rectangle(20, 20, 80, 50)
    expect(planPageFeaturesIssue(input)).toBe('obstacle-outside-room-contour')
    at(at(input.rooms).obstacles).polygon = [
      { x: 30, y: 50 },
      { x: 50, y: 30 },
      { x: 70, y: 50 },
    ]
    expect(planPageFeaturesIssue(input)).toBe('obstacle-outside-room-contour')
    at(at(input.rooms).obstacles).polygon = rectangle(15, 45, 35, 70)
    expect(planPageFeaturesIssue(input)).toBeUndefined()
  })

  it.each(
    [rectangle(20, 60, 40, 80), rectangle(10, 50, 30, 70), rectangle(15, 55, 25, 65)].map(
      (polygon) => [polygon],
    ),
  )('refuses partial, identical, and contained obstacle overlap', (polygon) => {
    const input = featureContours()
    required(at(input.rooms).obstacles).push({ id: 'column-2', kind: 'column', polygon })
    expect(planPageFeaturesIssue(input)).toBe('overlapping-page-obstacles')
  })

  it('allows obstacles and rooms to adjoin without occupying the same interior', () => {
    const input = featureContours()
    required(at(input.rooms).obstacles).push({
      id: 'column-2',
      kind: 'column',
      polygon: rectangle(30, 50, 40, 70),
    })
    input.rooms.push({ roomSourceNumber: 5, polygon: rectangle(90, 10, 150, 90) })
    expect(planPageFeaturesIssue(input)).toBeUndefined()
  })

  it('has no outward epsilon allowance for obstacle containment or overlap', () => {
    const input = featureContours()
    at(input.rooms).obstacles = [
      { id: 'outside', kind: 'shaft', polygon: rectangle(10 - 0.00000005, 20, 20, 30) },
    ]
    expect(planPageFeaturesIssue(input)).toBe('obstacle-outside-room-contour')
    at(input.rooms).obstacles = [
      { id: 'first', kind: 'shaft', polygon: rectangle(20, 20, 30, 30) },
      { id: 'second', kind: 'fixed', polygon: rectangle(30 - 0.00000005, 20, 40, 30) },
    ]
    expect(planPageFeaturesIssue(input)).toBe('overlapping-page-obstacles')
  })

  it.each(
    [rectangle(50, 50, 150, 150), rectangle(10, 10, 90, 90), rectangle(20, 20, 80, 80)].map(
      (polygon) => [polygon],
    ),
  )('refuses rooms with overlapping interiors when interpreting their features', (polygon) => {
    const input = featureContours()
    input.rooms.push({ roomSourceNumber: 5, polygon })
    expect(planPageFeaturesIssue(input)).toBe('overlapping-room-contours')
  })

  it('preserves legacy contour parsing and source mismatch rejection with feature data', () => {
    const legacy = structuredClone(contours)
    legacy.rooms.push({ polygon: at(legacy.rooms).polygon, roomSourceNumber: 5 })
    expect(planPageContoursSchema.safeParse(legacy).success).toBe(true)
    const input = featureContours()
    expect(
      planPageReviewIssue(
        input,
        reading,
        { ...input.source, sha256: 'b'.repeat(64) },
        nativeFeatureWork(input),
      ),
    ).toBe('different-plan-source')
  })

  it('bounds geometric intersection work for an entire annotated page', () => {
    const input = featureContours()
    input.rooms = Array.from({ length: 11 }, (_, index) => ({
      roomSourceNumber: index + 1,
      polygon: rectangle(10, 10, 90, 90),
      obstacles: Array.from({ length: 20 }, (_, feature) => ({
        id: `fixed-${feature}`,
        kind: 'fixed' as const,
        polygon: rectangle(20, 20, 30, 30),
      })),
    }))
    expect(planPageFeaturesIssue(input)).toBe('page-features-too-complex')
    expect(planPageContoursSchema.safeParse(input).success).toBe(false)
  })
})
