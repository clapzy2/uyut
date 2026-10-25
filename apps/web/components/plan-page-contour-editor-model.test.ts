import type { PlanPageContours, PlanRoomReading } from '@uyut/db'
import { describe, expect, it, vi } from 'vitest'
import type { NativePageSegment } from '@/lib/projects/plan-pdf-opening-endpoint'
import {
  canAddPageFeature,
  contourDraftFromFillHint,
  contourDraftsFromSaved,
  fillHintsFromResponse,
  finiteContourPoint,
  groupPageContourDraft,
  nativeContourPoint,
  nativePointsFromResponse,
  nativeSegmentsFromResponse,
  numberedContourRooms,
  type PageContourPoint,
  pageContourOptions,
  pageContourPoint,
  pageContourProgress,
  pageContourRoomsForSave,
  pageContourVertexProofsChanged,
  pageContourVoidsForSave,
  pageExteriorForSave,
  pageFloorForSave,
  pageOpeningPointsChanged,
  previewFromHeaders,
  samePlanPage,
  savedPageOpeningCheck,
  snapPageContourPoint,
  snapPageOpeningPoint,
  voidDraftsFromSaved,
} from './plan-page-contour-editor-model'

const preview = { sha256: 'a'.repeat(64), page: 6, pageCount: 48, width: 842, height: 1191 }

describe('display-only PDF fill hints', () => {
  const valid = () => ({
    sourceRevision: 'b'.repeat(64),
    source: { sha256: preview.sha256, pdfPage: preview.page, state: 'existing' },
    status: 'diagnostic',
    refusalReason: null,
    truncated: false,
    candidates: [
      {
        id: 'native-fill-10:0',
        polygon: [
          { x: 10, y: 10 },
          { x: 20, y: 10 },
          { x: 20, y: 20 },
        ],
        areaM2: 5.512,
        nearbyText: ['Кухня'],
      },
    ],
  })

  it('accepts bounded same-source hints without adding a room or metric claim', () => {
    const result = fillHintsFromResponse(valid(), preview, 'b'.repeat(64))
    expect(result).toEqual({
      sourceRevision: 'b'.repeat(64),
      sourceSha256: preview.sha256,
      page: preview.page,
      status: 'diagnostic',
      refusalReason: null,
      truncated: false,
      candidates: valid().candidates,
      roomHints: [],
    })
    expect(result).not.toHaveProperty('roomSourceNumber')
    expect(result).not.toHaveProperty('readyFor2D')
  })

  it('переносит напечатанную подпись площади и отвергает подделанную', () => {
    const response = valid()
    const candidate = response.candidates[0] as unknown as Record<string, unknown>
    if (!candidate) throw new Error('Нет кандидата заливки')
    candidate.printedAreas = ['S: 2,46 м²']
    expect(
      fillHintsFromResponse(response, preview, 'b'.repeat(64))?.candidates[0]?.printedAreas,
    ).toEqual(['S: 2,46 м²'])
    // Подпись только показывается рядом с расчётом: выбор контура она не задаёт.
    candidate.printedAreas = ['один', 'два', 'три']
    expect(fillHintsFromResponse(response, preview, 'b'.repeat(64))).toBeNull()
    candidate.printedAreas = ['x'.repeat(41)]
    expect(fillHintsFromResponse(response, preview, 'b'.repeat(64))).toBeNull()
    candidate.printedAreas = [2.46]
    expect(fillHintsFromResponse(response, preview, 'b'.repeat(64))).toBeNull()
  })

  it('keeps numbered alternatives display-only and tied to returned fill IDs', () => {
    const response = {
      ...valid(),
      roomHints: [
        {
          sourceNumber: 2,
          name: 'Кухня',
          markerLabelIds: ['native-text-4'],
          fillIds: ['native-fill-10:0'],
          otherSameNumberLabels: 0,
        },
      ],
    }
    expect(fillHintsFromResponse(response, preview, 'b'.repeat(64))?.roomHints).toEqual(
      response.roomHints,
    )
    const hint = response.roomHints[0]
    if (!hint) throw new Error('Missing test room hint')
    hint.fillIds = ['native-fill-99:0']
    expect(fillHintsFromResponse(response, preview, 'b'.repeat(64))).toBeNull()
  })

  it('rejects changed sources, duplicate hints and invalid coordinates', () => {
    const changed = valid()
    changed.source.sha256 = 'c'.repeat(64)
    expect(fillHintsFromResponse(changed, preview, 'b'.repeat(64))).toBeNull()

    const duplicate = valid()
    const first = duplicate.candidates[0]
    if (!first) throw new Error('Missing test candidate')
    duplicate.candidates.push(structuredClone(first))
    expect(fillHintsFromResponse(duplicate, preview, 'b'.repeat(64))).toBeNull()

    const invalid = valid()
    const invalidPoint = invalid.candidates[0]?.polygon[0]
    if (!invalidPoint) throw new Error('Missing test point')
    invalidPoint.x = -1
    expect(fillHintsFromResponse(invalid, preview, 'b'.repeat(64))).toBeNull()
  })

  it('переносит способ снять уступ оболочки и отвергает испорченный', () => {
    const collapse = { corner: { x: 10, y: 10.5 }, replaces: [0, 1, 2], roomsOutside: [2] }
    const response = () => ({
      ...valid(),
      outerEnvelope: {
        polygon: [
          { x: 10, y: 10 },
          { x: 30, y: 10 },
          { x: 30, y: 10.5 },
          { x: 60, y: 10.5 },
          { x: 60, y: 50 },
          { x: 10, y: 50 },
        ],
        shortEdges: [
          {
            index: 1,
            start: { x: 30, y: 10 },
            end: { x: 30, y: 10.5 },
            lengthCm: 0.5,
            collapses: [structuredClone(collapse)] as unknown[],
          },
        ],
      },
    })
    expect(
      fillHintsFromResponse(response(), preview, 'b'.repeat(64))?.outerEnvelope?.shortEdges?.[0]
        ?.collapses,
    ).toEqual([collapse])
    for (const broken of [
      { ...collapse, corner: null },
      { ...collapse, corner: { x: 10, y: -1 } },
      { ...collapse, replaces: [0, 1] },
      { ...collapse, replaces: [4, 5, 6] },
      { ...collapse, replaces: [0, 1.5, 2] },
      { ...collapse, roomsOutside: ['2'] },
      null,
    ]) {
      const changed = response()
      const edge = changed.outerEnvelope.shortEdges[0]
      if (!edge) throw new Error('Нет короткого ребра')
      edge.collapses = [broken]
      expect(fillHintsFromResponse(changed, preview, 'b'.repeat(64))).toBeNull()
    }
  })
})
const rect = { left: 20, top: 40, width: 400, height: 600 }

const crossingSegments: [NativePageSegment, NativePageSegment] = [
  {
    operationIndex: 1,
    subpathIndex: 0,
    segmentIndex: 0,
    start: { x: 10, y: 10 },
    end: { x: 40, y: 10 },
  },
  {
    operationIndex: 2,
    subpathIndex: 0,
    segmentIndex: 0,
    start: { x: 30, y: 0 },
    end: { x: 30, y: 30 },
  },
]
const crossingRoom: PlanPageContours['rooms'][number] = {
  roomSourceNumber: 3.1,
  polygon: [
    { x: 10, y: 10 },
    { x: 30, y: 10 },
    { x: 30, y: 30 },
  ],
  vertexProofs: [
    {
      vertexIndex: 1,
      kind: 'bounded-native-crossing',
      segments: [crossingSegments[0], crossingSegments[1]],
    },
  ],
}
const crossingNodes = crossingSegments.flatMap((segment) => [segment.start, segment.end])

describe('whole-page contour progress', () => {
  const sourceRooms = [
    { sourceNumber: 1, name: 'Прихожая' },
    { sourceNumber: 2, name: 'Спальня' },
    { sourceNumber: 3, name: 'Балкон' },
  ]
  const readings: PlanRoomReading[] = [
    { name: 'Прихожая', sourceNumber: 1, kind: 'living' },
    { name: 'Спальня', sourceNumber: 2, kind: 'bedroom' },
  ]

  it('does not count a source-only area or a table row as physical floor', () => {
    const progress = pageContourProgress(sourceRooms, readings, [
      { roomSourceNumber: 1, polygon: crossingRoom.polygon, closed: true },
      {
        roomSourceNumber: 2,
        polygon: crossingRoom.polygon,
        closed: true,
        sourceTopology: {
          kind: 'unclassified-source-paint',
          floorId: 'source-floor-2',
          exactPointKeys: [],
          holes: [],
          holeExactPointKeys: [],
        },
      },
    ])
    expect(progress.map((room) => room.status)).toEqual([
      'physical',
      'source-only',
      'missing-reading',
    ])
    expect(progress[2]?.selectable).toBe(false)
  })

  it('shows unfinished and ambiguous source numbers without promoting either', () => {
    const progress = pageContourProgress(sourceRooms, readings, [
      { roomSourceNumber: 1, polygon: [], closed: false },
      { roomSourceNumber: 2, polygon: crossingRoom.polygon, closed: true },
      { roomSourceNumber: 2, polygon: crossingRoom.polygon, closed: true },
    ])
    expect(progress.map((room) => room.status)).toEqual([
      'incomplete',
      'ambiguous',
      'missing-reading',
    ])
    expect(progress[1]?.selectable).toBe(false)
  })
})

describe('saved bounded source intersections', () => {
  it('preserves rational source topology and holes on hydrate/save without snapping them into native nodes', () => {
    const sourceRoom: PlanPageContours['rooms'][number] = {
      roomSourceNumber: 3.1,
      polygon: [
        { x: 10.333333333333334, y: 10 },
        { x: 30, y: 10 },
        { x: 30, y: 30 },
        { x: 10, y: 30 },
      ],
      sourceTopology: {
        kind: 'unclassified-source-paint',
        floorId: 'source-floor-3.1',
        exactPointKeys: ['31/3:10/1', '30/1:10/1', '30/1:30/1', '10/1:30/1'],
        holes: [
          [
            { x: 15, y: 15 },
            { x: 20, y: 15 },
            { x: 20, y: 20 },
          ],
        ],
        holeExactPointKeys: [['15/1:15/1', '20/1:15/1', '20/1:20/1']],
      },
    }
    const before = structuredClone(sourceRoom)
    const drafts = contourDraftsFromSaved([sourceRoom])
    expect(pageContourRoomsForSave(drafts, [], [])).toEqual([sourceRoom])
    expect(drafts[0]?.sourceTopology).not.toBe(sourceRoom.sourceTopology)
    expect(canAddPageFeature(drafts[0], 'door')).toBe(false)
    expect(
      groupPageContourDraft(drafts, { roomSourceNumber: 3.1 }, 4, [
        { name: 'Гардероб', sourceNumber: 3.1, kind: 'bedroom' },
        { name: 'Другая', sourceNumber: 4, kind: 'bedroom' },
      ]),
    ).toBeNull()
    expect(sourceRoom).toEqual(before)
  })
  it('reloads and resaves a room without losing or sharing its crossing evidence', () => {
    const drafts = contourDraftsFromSaved([crossingRoom])
    expect(pageContourRoomsForSave(drafts, crossingNodes, crossingSegments)).toEqual([crossingRoom])
    expect(drafts[0]?.vertexProofs).not.toBe(crossingRoom.vertexProofs)
    expect(drafts[0]?.vertexProofs?.[0]?.segments[0].start).not.toBe(crossingSegments[0]?.start)
    expect(pageContourRoomsForSave(drafts, crossingNodes)).toBeNull()
  })

  it('round-trips an informational source trace separately from the physical polygon', () => {
    const traced = structuredClone(crossingRoom)
    traced.sourceTrace = {
      polygon: [
        { x: 10, y: 10 },
        { x: 20, y: 10 },
        { x: 20, y: 20 },
      ],
      sourceTopology: {
        kind: 'unclassified-source-paint',
        floorId: 'original-source',
        exactPointKeys: ['10/1:10/1', '20/1:10/1', '20/1:20/1'],
        holes: [],
        holeExactPointKeys: [],
      },
    }
    const drafts = contourDraftsFromSaved([traced])
    expect(drafts[0]?.sourceTrace).toEqual(traced.sourceTrace)
    expect(drafts[0]?.sourceTrace).not.toBe(traced.sourceTrace)
    expect(pageContourRoomsForSave(drafts, crossingNodes, crossingSegments)).toEqual([traced])
  })

  it.each(['floor', 'exterior'] as const)(
    'resaves %s crossing proofs only against fresh segments',
    (kind) => {
      const boundary = {
        polygon: crossingRoom.polygon,
        vertexProofs: crossingRoom.vertexProofs,
        boundaryRole: 'outer-wall-envelope' as const,
      }
      const save = kind === 'floor' ? pageFloorForSave : pageExteriorForSave
      const saved = save(boundary, true, crossingNodes, crossingSegments)
      expect(saved?.vertexProofs).toEqual(crossingRoom.vertexProofs)
      expect(saved?.vertexProofs).not.toBe(crossingRoom.vertexProofs)
      expect(save(boundary, true, crossingNodes)).toBeNull()
      expect(save(boundary, false, crossingNodes, crossingSegments)).toBeNull()
      const changed = structuredClone(crossingSegments)
      changed[0].end.x += 1
      expect(save(boundary, true, crossingNodes, changed)).toBeNull()
    },
  )

  it('keeps evidence on closure, drops it on a changed or removed vertex, and never restores it by undo', () => {
    expect(
      pageContourVertexProofsChanged(crossingRoom, structuredClone(crossingRoom.polygon)),
    ).toEqual(crossingRoom.vertexProofs)
    const moved = structuredClone(crossingRoom.polygon)
    const movedPoint = moved[1]
    if (!movedPoint) throw new Error('Missing crossing vertex')
    movedPoint.x += 0.000001
    expect(pageContourVertexProofsChanged(crossingRoom, moved)).toBeUndefined()
    expect(pageContourVertexProofsChanged({ polygon: moved }, crossingRoom.polygon)).toBeUndefined()
    expect(
      pageContourVertexProofsChanged(crossingRoom, crossingRoom.polygon.slice(0, 1)),
    ).toBeUndefined()
    const reversed = [...crossingRoom.polygon].reverse()
    expect(pageContourVertexProofsChanged(crossingRoom, reversed)).toEqual(
      crossingRoom.vertexProofs,
    )
    expect(
      pageContourVertexProofsChanged(crossingRoom, crossingRoom.polygon.slice(1)),
    ).toBeUndefined()
    expect(
      pageContourVertexProofsChanged(crossingRoom, [...crossingRoom.polygon, { x: 20, y: 20 }]),
    ).toEqual(crossingRoom.vertexProofs)
  })

  it.each([
    'rounded',
    'changed-snapshot',
    'duplicate-proof',
    'duplicate-reference',
    'extended',
  ] as const)('holds %s evidence in the reopened room', (change) => {
    const room = structuredClone(crossingRoom)
    const segments: NativePageSegment[] = structuredClone(crossingSegments)
    const proof = room.vertexProofs?.[0]
    const point = room.polygon[1]
    const segment = segments[0]
    if (!proof || !point || !segment) throw new Error('Missing crossing fixture')
    if (change === 'rounded') point.x += 0.000001
    if (change === 'changed-snapshot') proof.segments[0].end.x += 1
    if (change === 'duplicate-proof') room.vertexProofs?.push(structuredClone(proof))
    if (change === 'duplicate-reference') segments.push(structuredClone(segment))
    if (change === 'extended') {
      segment.end.x = 20
      proof.segments[0].end.x = 20
    }
    expect(
      pageContourRoomsForSave(contourDraftsFromSaved([room]), crossingNodes, segments),
    ).toBeNull()
  })

  it('preserves the same reviewed shape when explicitly grouping room identities', () => {
    const readings: PlanRoomReading[] = [
      { name: 'Гардероб', kind: 'living', sourceNumber: 3.1 },
      { name: 'Спальня', kind: 'bedroom', sourceNumber: 3 },
      { name: 'Коридор', kind: 'living', sourceNumber: 4 },
    ]
    const grouped = groupPageContourDraft(
      contourDraftsFromSaved([crossingRoom]),
      { roomSourceNumber: 3.1 },
      3,
      readings,
    )
    expect(grouped?.[0]?.vertexProofs).toEqual(crossingRoom.vertexProofs)
    expect(
      pageContourRoomsForSave(grouped ?? [], crossingNodes, crossingSegments)?.[0]?.vertexProofs,
    ).toEqual(crossingRoom.vertexProofs)
    const extended = groupPageContourDraft(
      grouped ?? [],
      { roomSourceNumbers: [3, 3.1] },
      4,
      readings,
    )
    expect(extended?.[0]?.roomSourceNumbers).toEqual([3, 3.1, 4])
    expect(extended?.[0]?.polygon).toEqual(crossingRoom.polygon)
    expect(
      pageContourRoomsForSave(extended ?? [], crossingNodes, crossingSegments)?.[0]?.vertexProofs,
    ).toEqual(crossingRoom.vertexProofs)
  })
})

describe('page contour editor model', () => {
  it('keeps a parent and subroom separate in options and saved source contours', () => {
    const rooms: PlanRoomReading[] = [
      { name: 'Спальня', kind: 'bedroom', sourceNumber: 3 },
      { name: 'Гардеробная', kind: 'living', sourceNumber: 3.1 },
    ]
    expect(pageContourOptions(rooms, []).map(({ key }) => key)).toEqual(['3', '3.1'])
    const polygon = [
      { x: 10, y: 10 },
      { x: 30, y: 10 },
      { x: 30, y: 30 },
    ]
    const drafts = rooms.map((room) => ({
      roomSourceNumber: room.sourceNumber as number,
      polygon,
      closed: true,
    }))
    expect(pageContourRoomsForSave(drafts, polygon)?.map((room) => room.roomSourceNumber)).toEqual([
      3, 3.1,
    ])
    expect(
      numberedContourRooms([
        ...rooms,
        {
          name: 'Invalid',
          kind: 'living',
          sourceNumber: 3.1001,
        },
      ]),
    ).toEqual(rooms)
  })
  it('saves a separate floor only when closed on source nodes; never copies the exterior', () => {
    const polygon = [
      { x: 10, y: 10 },
      { x: 30, y: 10 },
      { x: 30, y: 30 },
    ]
    expect(pageFloorForSave(undefined, false, polygon)).toBeUndefined()
    expect(pageFloorForSave({ polygon: [] }, false, polygon)).toBeNull()
    expect(pageFloorForSave({ polygon }, false, polygon)).toBeNull()
    expect(pageFloorForSave({ polygon }, true, polygon.slice(1))).toBeNull()
    const result = pageFloorForSave({ polygon }, true, polygon)
    expect(result).toEqual({ polygon })
    expect(result?.polygon).not.toBe(polygon)
  })
  it('requires an explicit role and native closed vertices for an outer boundary', () => {
    const polygon = [
      { x: 10, y: 10 },
      { x: 30, y: 10 },
      { x: 30, y: 30 },
    ]
    expect(pageExteriorForSave(undefined, false, polygon)).toBeUndefined()
    expect(pageExteriorForSave({ polygon: [] }, false, polygon)).toBeNull()
    expect(pageExteriorForSave({ polygon }, true, polygon)).toBeNull()
    expect(pageExteriorForSave({ polygon, boundaryRole: 'floor' }, false, polygon)).toBeNull()
    expect(
      pageExteriorForSave({ polygon, boundaryRole: 'floor' }, true, polygon.slice(1)),
    ).toBeNull()
    expect(pageExteriorForSave({ polygon, boundaryRole: 'floor' }, true, polygon)).toEqual({
      polygon,
      boundaryRole: 'floor',
    })
    expect(
      pageExteriorForSave({ polygon, boundaryRole: 'outer-wall-envelope' }, true, polygon),
    ).toEqual({ polygon, boundaryRole: 'outer-wall-envelope' })
  })

  it('saves only closed, native-vertex technical voids and reloads them independently', () => {
    const polygon = [
      { x: 10, y: 10 },
      { x: 30, y: 10 },
      { x: 30, y: 30 },
    ]
    const draft = { id: 'shaft-1', polygon, closed: true }
    const saved = pageContourVoidsForSave([draft], polygon)
    expect(saved).toEqual([{ id: 'shaft-1', polygon }])
    expect(voidDraftsFromSaved(saved ?? [])).toEqual([draft])
    expect(pageContourVoidsForSave([{ ...draft, closed: false }], polygon)).toBeNull()
    expect(pageContourVoidsForSave([draft], polygon.slice(1))).toBeNull()
    expect(pageContourVoidsForSave([draft, draft], polygon)).toBeNull()
    expect(
      pageContourVoidsForSave(
        Array.from({ length: 21 }, (_, index) => ({ ...draft, id: `shaft-${index}` })),
        polygon,
      ),
    ).toBeNull()
  })

  it('snaps an opening endpoint to a source crossing, preserving proof through reload and save', () => {
    const left = { x: 10, y: 10 }
    const right = { x: 30, y: 10 }
    const polygon = [left, right, { x: 30, y: 30 }, { x: 10, y: 30 }]
    const segment = {
      operationIndex: 5,
      subpathIndex: 0,
      segmentIndex: 0,
      start: { x: 20, y: 4 },
      end: { x: 20, y: 12 },
    }
    const result = snapPageOpeningPoint(
      { x: 20, y: 10 },
      polygon,
      preview,
      [left, right],
      [segment],
    )
    expect(result.kind).toBe('candidate')
    if (result.kind !== 'candidate') throw new Error('Missing candidate')
    expect(result.proof?.kind).toBe('native-edge-crossing')
    const opening = pageOpeningPointsChanged(
      { id: 'split', kind: 'window', wallEdgeIndex: 0, points: [left] },
      [left, result.point],
      { index: 1, proof: result.proof },
    )
    const drafts = [{ roomSourceNumber: 2, polygon, closed: true, openings: [opening] }]
    const saved = pageContourRoomsForSave(drafts, polygon, [segment])
    expect(saved?.[0]?.openings?.[0]?.endpointProofs).toEqual(opening.endpointProofs)
    if (!saved) throw new Error('Missing save')
    expect(contourDraftsFromSaved(saved)[0]?.openings?.[0]).toEqual(opening)
    expect(pageContourRoomsForSave(drafts, polygon)).toBeNull()
    const moved = pageOpeningPointsChanged(opening, [left, { x: 21, y: 10 }])
    expect(moved.endpointProofs).toBeUndefined()
    expect(
      pageOpeningPointsChanged(opening, opening.points.slice(0, 1)).endpointProofs,
    ).toBeUndefined()
  })

  it('validates segment response bounds and rejects competing crossing points', () => {
    const segment = {
      operationIndex: 5,
      subpathIndex: 0,
      segmentIndex: 0,
      start: { x: 20, y: 4 },
      end: { x: 20, y: 12 },
    }
    expect(nativeSegmentsFromResponse({ segments: [segment] })).toEqual([segment])
    expect(nativeSegmentsFromResponse({ segments: [segment, segment] })).toBeNull()
    expect(
      nativeSegmentsFromResponse({ segments: [{ ...segment, start: { x: NaN, y: 4 } }] }),
    ).toBeNull()
    expect(nativeSegmentsFromResponse({ segments: new Array(20_001).fill(segment) })).toBeNull()
    expect(
      snapPageOpeningPoint(
        { x: 20.05, y: 10 },
        [],
        preview,
        [
          { x: 10, y: 10 },
          { x: 30, y: 10 },
        ],
        [
          segment,
          { ...segment, operationIndex: 6, start: { x: 20.1, y: 4 }, end: { x: 20.1, y: 12 } },
        ],
      ).kind,
    ).toBe('ambiguous')
  })

  it('deduplicates repeated crossings without scanning the native node array for each segment', () => {
    const nativePoints = Array.from({ length: 20_000 }, (_, i) => ({ x: i / 100, y: 50 }))
    const segments = Array.from({ length: 20_000 }, (_, i) => ({
      operationIndex: i,
      subpathIndex: 0,
      segmentIndex: 0,
      start: { x: 20, y: 4 },
      end: { x: 20, y: 12 },
    }))
    const reads = vi.spyOn(nativePoints, 'some')
    expect(
      snapPageOpeningPoint(
        { x: 20, y: 10 },
        nativePoints,
        preview,
        [
          { x: 10, y: 10 },
          { x: 30, y: 10 },
        ],
        segments,
      ).kind,
    ).toBe('candidate')
    expect(reads).not.toHaveBeenCalled()
  })
  it('maps the actual displayed page independently along each axis without inventing millimetres', () => {
    expect(pageContourPoint({ x: 220, y: 190 }, rect)).toEqual({ x: 500, y: 250 })
    expect(pageContourPoint({ x: 420, y: 640 }, rect)).toEqual({ x: 1000, y: 1000 })
  })

  it('rejects points outside the rendered page, nonfinite input and zero-sized previews', () => {
    expect(pageContourPoint({ x: 19, y: 40 }, rect)).toBeNull()
    expect(pageContourPoint({ x: 20, y: 641 }, rect)).toBeNull()
    expect(pageContourPoint({ x: Number.NaN, y: 40 }, rect)).toBeNull()
    expect(pageContourPoint({ x: 20, y: 40 }, { ...rect, width: 0 })).toBeNull()
  })

  it('selects only positive unique printed numbers, never matching by a repeated room name', () => {
    const rooms: PlanRoomReading[] = [
      { name: 'Спальня', kind: 'bedroom', sourceNumber: 4 },
      { name: 'Спальня', kind: 'bedroom', sourceNumber: 6 },
      { name: 'Кухня', kind: 'kitchen', sourceNumber: 2 },
      { name: 'Другая кухня', kind: 'kitchen', sourceNumber: 2 },
      { name: 'Без номера', kind: 'living' },
      { name: 'Нулевой номер', kind: 'living', sourceNumber: 0 },
      { name: 'Недопустимая точность номера', kind: 'living', sourceNumber: 1.5001 },
    ]
    expect(numberedContourRooms(rooms).map((room) => room.sourceNumber)).toEqual([4, 6])
  })

  it('makes hash, page and physical format part of draft source identity', () => {
    expect(samePlanPage(preview, { ...preview, pageCount: 49 })).toBe(true)
    expect(samePlanPage(preview, { ...preview, sha256: 'b'.repeat(64) })).toBe(false)
    expect(samePlanPage(preview, { ...preview, page: 12 })).toBe(false)
    expect(samePlanPage(preview, { ...preview, height: 842 })).toBe(false)
  })

  it('accepts verified page headers and rejects missing or inconsistent metadata', () => {
    const headers = new Headers({
      'X-Plan-Sha256': preview.sha256,
      'X-Plan-Page': '6',
      'X-Plan-Page-Count': '48',
      'X-Plan-Page-Width': '842',
      'X-Plan-Page-Height': '1191',
    })
    expect(previewFromHeaders(headers, 6)).toEqual(preview)
    expect(previewFromHeaders(headers, 12)).toBeNull()
    headers.delete('X-Plan-Sha256')
    expect(previewFromHeaders(headers, 6)).toBeNull()
  })

  it('rejects malformed physical formats and page bounds', () => {
    const headers = new Headers({
      'X-Plan-Sha256': preview.sha256,
      'X-Plan-Page': '6',
      'X-Plan-Page-Count': '5',
      'X-Plan-Page-Width': '842',
      'X-Plan-Page-Height': '1191',
    })
    expect(previewFromHeaders(headers, 6)).toBeNull()
    headers.set('X-Plan-Page-Count', '48')
    headers.set('X-Plan-Page-Height', 'Infinity')
    expect(previewFromHeaders(headers, 6)).toBeNull()
    headers.set('X-Plan-Page-Height', '0')
    expect(previewFromHeaders(headers, 6)).toBeNull()
  })

  it('keeps unfinished or out-of-bounds numeric editing separate from drawable points', () => {
    expect(finiteContourPoint({ x: 0, y: 1000 })).toBe(true)
    expect(finiteContourPoint({ x: Number.NaN, y: 1 })).toBe(false)
    expect(finiteContourPoint({ x: 1000.1, y: 1 })).toBe(false)
    expect(finiteContourPoint({ x: 1, y: -0.1 })).toBe(false)
  })

  it('proposes the exact native vertex for an imprecise click without rounding its original coordinates', () => {
    const native = { x: 123.45678912345, y: 345.6789123456 }
    const result = snapPageContourPoint({ x: native.x + 0.1, y: native.y - 0.1 }, [native], preview)
    expect(result.kind).toBe('candidate')
    if (result.kind !== 'candidate') throw new Error('Expected candidate')
    expect(result.point).toEqual(native)
    expect(result.point.x).toBe(native.x)
    expect(result.distance).toBeGreaterThan(0)
    expect(nativeContourPoint(result.point, [native])).toBe(true)
    expect(nativeContourPoint({ x: 123.5, y: 345.7 }, [native])).toBe(false)
  })

  it('measures the candidate radius in physical PDF points on both axes', () => {
    const native = { x: 100, y: 200 }
    expect(snapPageContourPoint({ x: 103.5, y: 200 }, [native], preview).kind).toBe('candidate')
    expect(snapPageContourPoint({ x: 100, y: 203.5 }, [native], preview).kind).toBe('none')
    expect(snapPageContourPoint({ x: 104, y: 200 }, [native], preview).kind).toBe('none')
  })

  it('refuses equally close competing nodes and keeps the user click unbound', () => {
    const click = { x: 100, y: 200 }
    const nodes = [
      { x: 99, y: 200 },
      { x: 101, y: 200 },
    ]
    expect(snapPageContourPoint(click, nodes, preview)).toEqual({ kind: 'ambiguous' })
    expect(nativeContourPoint(click, nodes)).toBe(false)
  })

  it('deduplicates native vertices and permits an explicit exact numeric node beside other nearby features', () => {
    const native = { x: 100, y: 200 }
    expect(snapPageContourPoint(native, [native, native, { x: 100.1, y: 200 }], preview)).toEqual({
      kind: 'candidate',
      point: native,
      distance: 0,
    })
  })

  it('refuses invalid source format and nonfinite candidates instead of freely accepting coordinates', () => {
    const point = { x: 100, y: 200 }
    expect(snapPageContourPoint(point, [], preview)).toEqual({ kind: 'none' })
    expect(snapPageContourPoint(point, [point], { ...preview, width: 0 })).toEqual({ kind: 'none' })
    expect(snapPageContourPoint(point, [{ x: Number.NaN, y: 200 }], preview)).toEqual({
      kind: 'none',
    })
    expect(snapPageContourPoint({ x: -1, y: 200 }, [point], preview)).toEqual({ kind: 'none' })
  })

  it('accepts only a bounded finite normalized vector payload and deduplicates without changing native precision', () => {
    const point = { x: 123.45678912345, y: 234.5678912345 }
    expect(nativePointsFromResponse({ points: [point, point] })).toEqual([point])
    expect(nativePointsFromResponse({ points: [] })).toBeNull()
    expect(nativePointsFromResponse({ points: [null] })).toBeNull()
    expect(nativePointsFromResponse({ points: [{ x: '100', y: 100 }] })).toBeNull()
    expect(nativePointsFromResponse({ points: [{ x: 1001, y: 100 }] })).toBeNull()
    expect(nativePointsFromResponse({ points: [{ x: 100, y: Number.NaN }] })).toBeNull()
    expect(
      nativePointsFromResponse({ points: Array.from({ length: 20_001 }, () => point) }),
    ).toBeNull()
  })
})

describe('room feature drafts', () => {
  const room: PlanPageContours['rooms'][number] = {
    roomSourceNumber: 4,
    polygon: [
      { x: 10, y: 10 },
      { x: 30, y: 10 },
      { x: 30, y: 30 },
      { x: 10, y: 30 },
    ],
    openings: [
      {
        id: 'door',
        kind: 'door',
        wallEdgeIndex: 0,
        start: { x: 15, y: 10 },
        end: { x: 20, y: 10 },
      },
    ],
    obstacles: [
      {
        id: 'shaft',
        kind: 'shaft',
        polygon: [
          { x: 11, y: 11 },
          { x: 12, y: 11 },
          { x: 12, y: 12 },
        ],
      },
    ],
  }
  const native = [
    ...room.polygon,
    ...(room.openings ?? []).flatMap((opening) => [opening.start, opening.end]),
    ...(room.obstacles ?? []).flatMap((obstacle) => obstacle.polygon),
  ]

  it('reopens and saves every annotation without converting page coordinates to centimetres', () => {
    const drafts = contourDraftsFromSaved([room])
    expect(pageContourRoomsForSave(drafts, native)).toEqual([room])
    expect(drafts[0]?.polygon).not.toBe(room.polygon)
    expect(drafts[0]?.openings?.[0]?.points[0]).not.toBe(room.openings?.[0]?.start)
  })

  it('refuses incomplete openings or obstacle polygons instead of dropping them', () => {
    const drafts = contourDraftsFromSaved([room])
    const opening = drafts[0]?.openings?.[0]
    if (!opening) throw new Error('Missing draft opening')
    opening.points.pop()
    expect(pageContourRoomsForSave(drafts, native)).toBeNull()
    const unfinished = contourDraftsFromSaved([room])
    const obstacle = unfinished[0]?.obstacles?.[0]
    if (!obstacle) throw new Error('Missing draft obstacle')
    obstacle.closed = false
    expect(pageContourRoomsForSave(unfinished, native)).toBeNull()
  })

  it('requires native points for features as well as room contours', () => {
    const drafts = contourDraftsFromSaved([room])
    const point = drafts[0]?.openings?.[0]?.points[0]
    if (!point) throw new Error('Missing draft point')
    point.x += 0.01
    expect(pageContourRoomsForSave(drafts, native)).toBeNull()
  })

  it('keeps legacy contours saveable and does not include empty feature arrays', () => {
    const minimal = { roomSourceNumber: room.roomSourceNumber, polygon: room.polygon }
    expect(pageContourRoomsForSave(contourDraftsFromSaved([minimal]), native)).toEqual([minimal])
  })

  it('round-trips an explicitly conditional side without dropping its source proof', () => {
    const marked = {
      roomSourceNumber: room.roomSourceNumber,
      polygon: room.polygon,
      conditionalEdges: [{ wallEdgeIndex: 0 }],
    }
    const drafts = contourDraftsFromSaved([marked])
    expect(pageContourRoomsForSave(drafts, native)).toEqual([marked])
    expect(drafts[0]?.conditionalEdges).not.toBe(marked.conditionalEdges)
  })

  it('preserves a conditional crossing anchored by another native vertex', () => {
    const crossing = {
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
              kind: 'native-edge-crossing' as const,
              operationIndex: 1,
              subpathIndex: 0,
              segmentIndex: 0,
            },
          },
        },
      ],
    }
    const native = [
      { x: 10, y: 10 },
      { x: 10, y: 30 },
      { x: 30, y: 20 },
      { x: 30, y: 30 },
    ]
    const segments = [
      {
        operationIndex: 1,
        subpathIndex: 0,
        segmentIndex: 0,
        start: { x: 10, y: 10 },
        end: { x: 10, y: 30 },
      },
    ]
    const drafts = contourDraftsFromSaved([crossing])
    expect(pageContourRoomsForSave(drafts, native, segments)).toEqual([crossing])
    expect(pageContourRoomsForSave(drafts, native)).toBeNull()
  })

  it('round-trips a shared physical zone, preserving its features without scalar duplicates', () => {
    const shared: PlanPageContours['rooms'][number] = {
      roomSourceNumbers: [1, 5],
      polygon: room.polygon,
      openings: room.openings,
      obstacles: room.obstacles,
    }
    const drafts = contourDraftsFromSaved([shared])
    expect(drafts).toHaveLength(1)
    expect(drafts[0]).not.toHaveProperty('roomSourceNumber')
    expect(pageContourRoomsForSave(drafts, native)).toEqual([shared])
    expect(drafts[0]?.roomSourceNumbers).not.toBe(shared.roomSourceNumbers)
    const readings: PlanRoomReading[] = [
      { name: 'Прихожая', kind: 'living', sourceNumber: 1 },
      { name: 'Коридор', kind: 'living', sourceNumber: 5 },
      { name: 'Кухня', kind: 'kitchen', sourceNumber: 2 },
    ]
    expect(pageContourOptions(readings, drafts).map(({ key }) => key)).toEqual(['1+5', '2'])
    expect(pageContourOptions(readings, drafts)[0]?.label).toBe('№ 1 + 5 · Общая зона')
  })

  it('groups two explicit existing numbers but refuses foreign numbers or other contour claims', () => {
    const readings: PlanRoomReading[] = [
      { name: 'Прихожая', kind: 'living', sourceNumber: 1 },
      { name: 'Коридор', kind: 'living', sourceNumber: 5 },
    ]
    const first = contourDraftsFromSaved([{ ...room, roomSourceNumber: 1 }])
    const grouped = groupPageContourDraft(first, { roomSourceNumber: 1 }, 5, readings)
    expect(grouped?.[0]?.roomSourceNumbers).toEqual([1, 5])
    expect(grouped?.[0]?.openings).toEqual(first[0]?.openings)
    expect(grouped?.[0]).not.toHaveProperty('roomSourceNumber')
    expect(groupPageContourDraft([], { roomSourceNumber: 1 }, 6, readings)).toBeNull()
    expect(groupPageContourDraft([], { roomSourceNumber: 1 }, 1, readings)).toBeNull()
    expect(groupPageContourDraft([], { roomSourceNumbers: [1, 5] }, 6, readings)).toBeNull()
    const second = contourDraftsFromSaved([{ ...room, roomSourceNumber: 5 }])
    expect(
      groupPageContourDraft([...first, ...second], { roomSourceNumber: 1 }, 5, readings),
    ).toBeNull()
    const empty = groupPageContourDraft([], { roomSourceNumber: 1 }, 5, readings)
    expect(empty?.[0]?.closed).toBe(false)
    expect(pageContourRoomsForSave(empty ?? [], native)).toBeNull()
  })

  it('adds further unclaimed numbers to one contour without changing its shape or openings', () => {
    const readings: PlanRoomReading[] = [1, 2, 3, 4].map((sourceNumber) => ({
      name: `Комната ${sourceNumber}`,
      kind: 'living',
      sourceNumber,
    }))
    const first = contourDraftsFromSaved([{ ...room, roomSourceNumber: 1 }])
    const pair = groupPageContourDraft(first, { roomSourceNumber: 1 }, 2, readings)
    const triple = groupPageContourDraft(pair ?? [], { roomSourceNumbers: [1, 2] }, 3, readings)
    const extended = groupPageContourDraft(
      triple ?? [],
      { roomSourceNumbers: [1, 2, 3] },
      4,
      readings,
    )
    expect(extended?.[0]).toEqual({
      ...first[0],
      roomSourceNumber: undefined,
      roomSourceNumbers: [1, 2, 3, 4],
    })
    expect(first[0]?.roomSourceNumber).toBe(1)
    expect(pair?.[0]?.roomSourceNumbers).toEqual([1, 2])
    expect(extended?.[0]).not.toHaveProperty('roomSourceNumber')
  })

  it('rejects overlapping, invalid or source-only identities when extending a group', () => {
    const readings: PlanRoomReading[] = [1, 2, 3, 4].map((sourceNumber) => ({
      name: `Комната ${sourceNumber}`,
      kind: 'living',
      sourceNumber,
    }))
    const shared = contourDraftsFromSaved([
      { ...room, roomSourceNumber: undefined, roomSourceNumbers: [1, 2] },
    ])
    const selected = { roomSourceNumbers: [1, 2] }
    const separate = contourDraftsFromSaved([{ ...room, roomSourceNumber: 3 }])
    const overlap = contourDraftsFromSaved([
      { ...room, roomSourceNumber: undefined, roomSourceNumbers: [2, 4] },
    ])
    expect(groupPageContourDraft([...shared, ...separate], selected, 3, readings)).toBeNull()
    expect(groupPageContourDraft([...shared, ...overlap], selected, 3, readings)).toBeNull()
    expect(groupPageContourDraft([...shared, ...shared], selected, 3, readings)).toBeNull()
    expect(groupPageContourDraft(shared, { roomSourceNumbers: [1, 1] }, 3, readings)).toBeNull()
    expect(groupPageContourDraft(shared, { roomSourceNumbers: [1] }, 3, readings)).toBeNull()
    for (const other of [1, 2, 0, 5, Number.NaN, 1.0001]) {
      expect(groupPageContourDraft(shared, selected, other, readings)).toBeNull()
    }
    const sourceTopology = {
      kind: 'unclassified-source-paint' as const,
      floorId: 'source-only',
      exactPointKeys: [],
      holes: [],
      holeExactPointKeys: [],
    }
    const before = shared[0]
    if (!before) throw new Error('Missing shared contour')
    expect(groupPageContourDraft([{ ...before, sourceTopology }], selected, 3, readings)).toBeNull()
    expect(
      groupPageContourDraft(
        [{ ...before, sourceTrace: { polygon: room.polygon, sourceTopology } }],
        selected,
        3,
        readings,
      ),
    ).toBeNull()
    const fullReadings: PlanRoomReading[] = Array.from({ length: 13 }, (_, index) => ({
      name: `Комната ${index + 1}`,
      kind: 'living',
      sourceNumber: index + 1,
    }))
    const fullIdentity = {
      roomSourceNumbers: Array.from({ length: 12 }, (_, index) => index + 1),
    }
    expect(
      groupPageContourDraft(
        [{ ...before, roomSourceNumber: undefined, ...fullIdentity }],
        fullIdentity,
        13,
        fullReadings,
      ),
    ).toBeNull()
  })

  it('refuses duplicated source claims and invalid shared membership before submitting', () => {
    const shared = contourDraftsFromSaved([{ roomSourceNumbers: [1, 5], polygon: room.polygon }])
    const individual = contourDraftsFromSaved([{ roomSourceNumber: 5, polygon: room.polygon }])
    expect(pageContourRoomsForSave([...shared, ...individual], native)).toBeNull()
    expect(
      pageContourRoomsForSave(
        contourDraftsFromSaved([{ roomSourceNumbers: [1, 1], polygon: room.polygon }]),
        native,
      ),
    ).toBeNull()
    expect(
      pageContourRoomsForSave(
        contourDraftsFromSaved([{ roomSourceNumbers: [1], polygon: room.polygon }]),
        native,
      ),
    ).toBeNull()
    expect(
      pageContourRoomsForSave(
        contourDraftsFromSaved([{ roomSourceNumbers: [1, 10_001], polygon: room.polygon }]),
        native,
      ),
    ).toBeNull()
  })

  it('uses the same per-type caps as the server and requires a closed room', () => {
    const draft = contourDraftsFromSaved([room])[0]
    if (!draft) throw new Error('Missing room')
    expect(canAddPageFeature({ ...draft, closed: false }, 'door')).toBe(false)
    expect(
      canAddPageFeature({ ...draft, openings: Array(32).fill(draft.openings?.[0]) }, 'door'),
    ).toBe(false)
    expect(
      canAddPageFeature({ ...draft, obstacles: Array(20).fill(draft.obstacles?.[0]) }, 'shaft'),
    ).toBe(false)
    expect(canAddPageFeature(draft, 'window')).toBe(true)
  })
  it('shows a saved printed width only for unchanged points, edge, room polygon and source', () => {
    const check = {
      roomSourceNumber: 4,
      openingId: 'door',
      status: 'candidate' as const,
      widthMm: 900,
      labelIndex: 10,
    }
    const review = {
      version: 1 as const,
      savedAt: '2026-09-27',
      contours: {
        source: { sha256: preview.sha256, pdfPage: 6, state: 'existing' as const },
        coordinateSystem: 'page-0-1000' as const,
        review: 'manual-source-review' as const,
        pageWidth: preview.width,
        pageHeight: preview.height,
        rooms: [room],
      },
      featureChecks: { openings: [check] },
    }
    const draft = contourDraftsFromSaved([room])[0]
    const opening = draft?.openings?.[0]
    expect(savedPageOpeningCheck(review, draft, opening, preview)).toEqual(check)
    expect(
      savedPageOpeningCheck(review, draft, opening, { ...preview, sha256: 'b'.repeat(64) }),
    ).toBeUndefined()
    if (!draft || !opening) throw new Error('Missing opening draft')
    expect(
      savedPageOpeningCheck(review, draft, { ...opening, wallEdgeIndex: 1 }, preview),
    ).toBeUndefined()
    expect(
      savedPageOpeningCheck(
        review,
        { ...draft, polygon: draft.polygon.slice(0, 3) },
        opening,
        preview,
      ),
    ).toBeUndefined()
    const point = opening.points[0]
    if (!point) throw new Error('Missing point')
    point.x += 1
    expect(savedPageOpeningCheck(review, draft, opening, preview)).toBeUndefined()
  })

  it('shows shared-zone checks only for the same full membership and unchanged annotation', () => {
    const shared: PlanPageContours['rooms'][number] = {
      roomSourceNumbers: [1, 5],
      polygon: room.polygon,
      openings: room.openings,
    }
    const check = {
      roomSourceNumbers: [1, 5],
      openingId: 'door',
      status: 'candidate' as const,
      widthMm: 900,
      labelIndex: 10,
    }
    const review = {
      version: 1 as const,
      savedAt: '2026-09-28',
      contours: {
        source: { sha256: preview.sha256, pdfPage: 6, state: 'existing' as const },
        coordinateSystem: 'page-0-1000' as const,
        review: 'manual-source-review' as const,
        pageWidth: preview.width,
        pageHeight: preview.height,
        rooms: [shared],
      },
      featureChecks: { openings: [check] },
    }
    const draft = contourDraftsFromSaved([shared])[0]
    const opening = draft?.openings?.[0]
    expect(savedPageOpeningCheck(review, draft, opening, preview)).toEqual(check)
    if (!draft?.roomSourceNumbers) throw new Error('Missing shared draft')
    expect(
      savedPageOpeningCheck(review, { ...draft, roomSourceNumbers: [5, 1] }, opening, preview),
    ).toEqual(check)
    expect(
      savedPageOpeningCheck(review, { ...draft, roomSourceNumbers: [1, 6] }, opening, preview),
    ).toBeUndefined()
    const scalar = contourDraftsFromSaved([{ ...room, roomSourceNumber: 1 }])[0]
    expect(savedPageOpeningCheck(review, scalar, opening, preview)).toBeUndefined()
  })
})

describe('contourDraftFromFillHint', () => {
  // Балкон № 8 листа CHI DESIGN: шесть исходных вершин PDF с уступом внизу.
  const balcony = [
    { x: 878.7, y: 392.1 },
    { x: 952.2, y: 392.1 },
    { x: 952.2, y: 696.6 },
    { x: 898.4, y: 696.6 },
    { x: 898.4, y: 676.4 },
    { x: 878.7, y: 676.4 },
  ]
  const nativePoints = [...balcony, { x: 10, y: 10 }]

  it('переносит заливку в черновик комнаты', () => {
    const draft = contourDraftFromFillHint({ roomSourceNumber: 8 }, balcony, nativePoints)
    expect(draft).toEqual({ roomSourceNumber: 8, polygon: balcony, closed: true })
    // Это черновик, а не доказанная геометрия: подтверждений в нём нет.
    expect(draft?.vertexProofs).toBeUndefined()
    expect(draft?.sourceTopology).toBeUndefined()
  })

  it('отдаёт контур, который проходит обычную проверку сохранения', () => {
    const draft = contourDraftFromFillHint({ roomSourceNumber: 8 }, balcony, nativePoints)
    if (!draft) throw new Error('Черновик не создан')
    expect(pageContourRoomsForSave([draft], nativePoints)).toEqual([
      { roomSourceNumber: 8, polygon: balcony },
    ])
  })

  it('не берёт заливку с вершиной вне исходных узлов PDF', () => {
    const moved = balcony.map((point, index) => (index === 2 ? { ...point, x: 952.3 } : point))
    expect(contourDraftFromFillHint({ roomSourceNumber: 8 }, moved, nativePoints)).toBeNull()
  })

  it('не затирает комнату с проёмами и препятствиями', () => {
    const before = {
      roomSourceNumber: 8,
      polygon: balcony,
      closed: true,
      openings: [{ id: 'a', kind: 'window' as const, wallEdgeIndex: 0, points: [] }],
    }
    expect(
      contourDraftFromFillHint({ roomSourceNumber: 8 }, balcony, nativePoints, before),
    ).toBeNull()
    expect(
      contourDraftFromFillHint({ roomSourceNumber: 8 }, balcony, nativePoints, {
        roomSourceNumber: 8,
        polygon: balcony,
        closed: true,
        obstacles: [{ id: 'b', kind: 'column' as const, polygon: [], closed: false }],
      }),
    ).toBeNull()
  })

  it('заменяет незаконченный черновик той же комнаты', () => {
    const before = { roomSourceNumber: 8, polygon: [balcony[0] as PageContourPoint], closed: false }
    expect(
      contourDraftFromFillHint({ roomSourceNumber: 8 }, balcony, nativePoints, before),
    ).toEqual({ roomSourceNumber: 8, polygon: balcony, closed: true })
  })

  it('не берёт заливку для общей зоны из нескольких номеров', () => {
    expect(
      contourDraftFromFillHint({ roomSourceNumbers: [1, 2] }, balcony, nativePoints),
    ).toBeNull()
  })

  it('отказывает на вырожденном и слишком подробном контуре', () => {
    expect(
      contourDraftFromFillHint({ roomSourceNumber: 8 }, balcony.slice(0, 2), nativePoints),
    ).toBeNull()
    const many = Array.from({ length: 101 }, (_, index) => ({ x: index, y: index }))
    expect(contourDraftFromFillHint({ roomSourceNumber: 8 }, many, many)).toBeNull()
    const repeated = [...balcony, balcony[0] as PageContourPoint]
    expect(contourDraftFromFillHint({ roomSourceNumber: 8 }, repeated, nativePoints)).toBeNull()
    expect(
      contourDraftFromFillHint(
        { roomSourceNumber: 8 },
        [{ x: Number.NaN, y: 0 }, ...balcony.slice(1)],
        nativePoints,
      ),
    ).toBeNull()
  })
})
