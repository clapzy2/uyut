import type { PlanPageContours, PlanReading } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import {
  planPageContoursSchema,
  planPageFeaturesIssue,
  planPageReviewIssue,
  retainedPlanPageReview,
} from './plan-page-review'
import type { PdfLinework } from './plan-pdf-linework'

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
