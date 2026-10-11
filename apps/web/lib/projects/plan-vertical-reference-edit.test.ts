import { reconcilePlanGeometryRooms } from '@uyut/ai/geometry'
import type { PlanGeometry } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import { applyPlanVerticalReference, currentPlanVerticalReference } from './plan-vertical-reference'
import {
  buildVerticalReferenceRequest,
  createVerticalReferenceDraft,
  prepareVerticalReferenceGeometry,
  verticalReferenceDraftSnapshot,
} from './plan-vertical-reference-edit'

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing synthetic fixture element')
  return value
}

function fixture() {
  const geometry: PlanGeometry = {
    version: 1,
    status: 'confirmed',
    widthCm: 400,
    heightCm: 1000,
    warnings: [],
    rooms: [0, 350, 700].map((y, index) => ({
      name: ['Interior', 'Bath', 'Balcony'][index] ?? 'Room',
      polygon: [
        { xCm: 0, yCm: y },
        { xCm: 400, yCm: y },
        { xCm: 400, yCm: y + 300 },
        { xCm: 0, yCm: y + 300 },
      ],
      ...(index === 0 ? { sourceNumbers: [1, 5] } : { sourceNumber: index + 1 }),
    })),
    walls: [0, 350, 700].map((y, index) => ({
      id: `wall-${index}`,
      kind: 'outer',
      start: { xCm: 0, yCm: y },
      end: { xCm: 400, yCm: y },
      heightCm: 270,
    })),
    openings: [0, 2].map((index) => ({
      id: `opening-${index}`,
      type: 'balcony',
      wallId: `wall-${index}`,
      offsetCm: 100,
      widthCm: 90,
      bottomCm: index === 0 ? 2 : 17,
      heightCm: 210,
    })),
  }
  const a = { wall: required(geometry.walls[0]), opening: required(geometry.openings[0]) }
  const b = { wall: required(geometry.walls[2]), opening: required(geometry.openings[1]) }
  geometry.pdfCalibration = {
    sourceSha256: 'a'.repeat(64),
    pdfPage: 1,
    cmPerPoint: 1,
    origin: { x: 0, y: 0 },
    anchorRoomNumbers: [1],
    labelIndexes: [],
    derivedOpeningIds: [],
    wallFaceRoomPolygons: structuredClone(geometry.rooms.map((room) => room.polygon)),
    openingFacePairs: [
      {
        bindings: [structuredClone(a), structuredClone(b)],
        jambs: [
          { operationIndex: 1, subpathIndex: 0, segmentIndex: 0 },
          { operationIndex: 1, subpathIndex: 0, segmentIndex: 1 },
        ],
      },
    ],
  }
  let id = 0
  const ids = () => `draft-${++id}`
  return { geometry, ids }
}

function ready() {
  const { geometry, ids } = fixture()
  const draft = createVerticalReferenceDraft(geometry, ids)
  draft.kind = 'finished-floor'
  draft.sourceKind = 'site-measurement'
  draft.sourceReference = 'Synthetic fixture, not user measurements'
  draft.zeroFloorId = required(draft.floors[0]).id
  draft.floors.forEach((floor, index) => {
    floor.surface = 'finished-floor'
    floor.elevation = required(['0', '-2', '-15'][index])
  })
  draft.wallBases.forEach((base, index) => {
    base.floorId = required(draft.floors[index]).id
  })
  return { geometry, draft, ids }
}

describe('explicit vertical reference draft', () => {
  it.each(['canvas', 'room', 'wall', 'thickness', 'offset', 'width'] as const)(
    'holds finer-than-millimetre editable %s without rounding or rebasing',
    (field) => {
      const { geometry, draft } = ready()
      if (field === 'canvas') geometry.widthCm = 400.123
      if (field === 'room') required(geometry.rooms[0]).polygon[1] = { xCm: 400.123, yCm: 0 }
      if (field === 'wall') required(geometry.walls[0]).end.xCm = 400.123
      if (field === 'thickness') required(geometry.walls[0]).thicknessCm = 20.123
      if (field === 'offset') required(geometry.openings[0]).offsetCm = 100.123
      if (field === 'width') required(geometry.openings[0]).widthCm = 90.123
      // The review is current: this specifically tests save precision, not staleness.
      draft.geometrySnapshot = verticalReferenceDraftSnapshot(geometry)
      if (field === 'room')
        required(draft.floors[0]).room = structuredClone(required(geometry.rooms[0]))
      const before = structuredClone(geometry)
      const result = buildVerticalReferenceRequest(geometry, draft)
      expect(result.ok).toBe(false)
      expect(!result.ok && result.error).toContain('миллиметра')
      expect(geometry).toEqual(before)
    },
  )

  it('accepts exact 0.1 cm editable coordinates without changing preserved footprint precision', () => {
    const { geometry, draft } = ready()
    geometry.widthCm = 400.1
    geometry.heightCm = 1000.1
    required(geometry.walls[1]).thicknessCm = 20.1
    required(draft.wallBases[1]).wall.thicknessCm = 20.1
    geometry.footprint = [
      { xCm: 0.123, yCm: 0 },
      { xCm: 400.123, yCm: 0 },
      { xCm: 400.123, yCm: 1000 },
    ]
    draft.geometrySnapshot = verticalReferenceDraftSnapshot(geometry)
    expect(buildVerticalReferenceRequest(geometry, draft).ok).toBe(true)
    expect(geometry.footprint[0]?.xCm).toBe(0.123)
  })

  it('does not invent zeros, datum, surface, source or wall owners', () => {
    const { geometry, ids } = fixture()
    const draft = createVerticalReferenceDraft(geometry, ids)
    expect(draft.kind).toBe('')
    expect(draft.zeroFloorId).toBe('')
    expect(draft.sourceKind).toBe('')
    expect(draft.sourceReference).toBe('')
    expect(
      draft.floors.every(
        (floor) => floor.elevation === '' && floor.surface === '' && floor.ceiling === '',
      ),
    ).toBe(true)
    expect(draft.wallBases.every((base) => base.floorId === '')).toBe(true)
    expect(draft.thresholds).toHaveLength(1)
    expect(draft.thresholds[0]?.elevation).toBe('')
    expect(buildVerticalReferenceRequest(geometry, draft).ok).toBe(false)
  })

  it('builds explicit signed floors, retaining one shared-label physical owner', () => {
    const { geometry, draft } = ready()
    required(draft.floors[1]).elevation = ' -2,5 '
    required(draft.floors[2]).ceiling = '+250.5'
    required(draft.thresholds[0]).elevation = '3'
    const result = buildVerticalReferenceRequest(geometry, draft)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.request.floors.map((floor) => floor.elevationCm)).toEqual([0, -2.5, -15])
    expect(result.request.floors[0]?.room.sourceNumbers).toEqual([1, 5])
    expect(result.request.ceilings?.[0]?.elevationCm).toBe(250.5)
    expect(result.request.thresholds[0]?.bindings.map((side) => side.floorId)).toEqual([
      required(draft.floors[0]).id,
      required(draft.floors[2]).id,
    ])
    expect(result.request).not.toHaveProperty('verifiedBy')
    expect(result.request).not.toHaveProperty('verifiedAt')
    expect(result.request).not.toHaveProperty('contextSnapshot')
    expect(result.request.acknowledged).toBe(true)
    expect(geometry).not.toHaveProperty('verticalReference')
  })

  it.each(['', ' ', 'NaN', 'Infinity', '0x10', '1e2', '2,2.2', '--2', '601', '-601', '2 cm'])(
    'rejects non-explicit floor number %j',
    (value) => {
      const { geometry, draft } = ready()
      required(draft.floors[1]).elevation = value
      expect(buildVerticalReferenceRequest(geometry, draft).ok).toBe(false)
    },
  )

  it.each(['0', '+0', '-0', '0,0', '0.0'])('accepts explicit numeric zero %j', (value) => {
    const { geometry, draft } = ready()
    required(draft.floors[0]).elevation = value
    expect(buildVerticalReferenceRequest(geometry, draft).ok).toBe(true)
  })

  it('does not force the selected zero floor to zero', () => {
    const { geometry, draft } = ready()
    draft.zeroFloorId = required(draft.floors[1]).id
    expect(buildVerticalReferenceRequest(geometry, draft).ok).toBe(false)
    expect(required(draft.floors[1]).elevation).toBe('-2')
  })

  it('omits unknown thresholds but retains explicitly entered zero', () => {
    const { geometry, draft } = ready()
    let result = buildVerticalReferenceRequest(geometry, draft)
    expect(result.ok && result.request.thresholds).toEqual([])
    required(draft.thresholds[0]).elevation = '0'
    result = buildVerticalReferenceRequest(geometry, draft)
    expect(result.ok && result.request.thresholds[0]?.elevationCm).toBe(0)
  })

  it('derives threshold side owners only from explicit wall assignments', () => {
    const { geometry, draft } = ready()
    required(draft.thresholds[0]).elevation = '3'
    required(draft.wallBases[2]).floorId = ''
    expect(buildVerticalReferenceRequest(geometry, draft).ok).toBe(false)
  })

  it('restores fresh values and IDs, adding only blank optional entries', () => {
    const { geometry, draft, ids } = ready()
    required(draft.floors[0]).ceiling = '270'
    required(draft.thresholds[0]).elevation = '3'
    const built = buildVerticalReferenceRequest(geometry, draft)
    if (!built.ok) throw new Error(built.error)
    const saved = applyPlanVerticalReference(
      geometry,
      built.request,
      'owner',
      '2026-10-11T12:00:00.000Z',
    )
    if (!saved.ok) throw new Error(saved.error)
    const restored = createVerticalReferenceDraft(saved.geometry, ids)
    expect(restored.id).toBe(draft.id)
    expect(restored.floors.map((floor) => floor.id)).toEqual(draft.floors.map((floor) => floor.id))
    expect(required(restored.floors[0]).ceilingId).toBe(required(draft.floors[0]).ceilingId)
    expect(restored.floors.map((floor) => floor.ceiling)).toEqual(['270', '', ''])
    expect(required(restored.thresholds[0]).id).toBe(required(draft.thresholds[0]).id)
    expect(required(restored.thresholds[0]).elevation).toBe('3')
  })

  it.each(['room', 'source', 'host', 'footprint'] as const)(
    'clears every approval field when %s becomes stale',
    (change) => {
      const { geometry, draft, ids } = ready()
      const built = buildVerticalReferenceRequest(geometry, draft)
      if (!built.ok) throw new Error(built.error)
      const saved = applyPlanVerticalReference(
        geometry,
        built.request,
        'owner',
        '2026-10-11T12:00:00.000Z',
      )
      if (!saved.ok) throw new Error(saved.error)
      const modified = saved.geometry
      if (change === 'room') required(modified.rooms[0]).name = 'Changed'
      if (change === 'source') required(modified.pdfCalibration).sourceSha256 = 'b'.repeat(64)
      if (change === 'host') required(modified.walls[0]).start.xCm += 1
      if (change === 'footprint') modified.footprint = required(modified.rooms[0]).polygon
      const restored = createVerticalReferenceDraft(modified, ids)
      expect(restored.id).not.toBe(draft.id)
      expect(restored.kind).toBe('')
      expect(restored.zeroFloorId).toBe('')
      expect(restored.sourceReference).toBe('')
      expect(restored.floors.every((floor) => floor.elevation === '' && floor.surface === '')).toBe(
        true,
      )
      expect(restored.wallBases.every((base) => base.floorId === '')).toBe(true)
      expect(buildVerticalReferenceRequest(modified, draft).ok).toBe(false)
    },
  )

  it('ignores inventory reordering and current local vertical measures in the review snapshot', () => {
    const { geometry, draft } = ready()
    geometry.rooms.reverse()
    geometry.walls.reverse()
    geometry.openings.reverse()
    required(geometry.walls[0]).heightCm = 280
    required(geometry.openings[0]).bottomCm = 18
    required(geometry.openings[0]).heightCm = 200
    expect(verticalReferenceDraftSnapshot(geometry)).toBe(draft.geometrySnapshot)
    expect(buildVerticalReferenceRequest(geometry, draft).ok).toBe(true)
  })

  it.each([
    'duplicate-floor',
    'extra-floor',
    'duplicate-wall',
    'duplicate-threshold',
    'extra-threshold',
    'changed-side',
  ] as const)(
    'holds changed draft inventory %s even when optional elevation is blank',
    (change) => {
      const { geometry, draft } = ready()
      if (change === 'duplicate-floor') required(draft.floors[1]).id = required(draft.floors[0]).id
      if (change === 'extra-floor') draft.floors.push(structuredClone(required(draft.floors[0])))
      if (change === 'duplicate-wall')
        draft.wallBases.push(structuredClone(required(draft.wallBases[0])))
      if (change === 'duplicate-threshold')
        draft.thresholds.push(structuredClone(required(draft.thresholds[0])))
      if (change === 'extra-threshold')
        draft.thresholds.push({ ...structuredClone(required(draft.thresholds[0])), id: 'extra' })
      if (change === 'changed-side') required(draft.thresholds[0]).bindings[0].offsetCm += 1
      expect(buildVerticalReferenceRequest(geometry, draft).ok).toBe(false)
    },
  )

  it('does not create thresholds from nearby openings without a source relation', () => {
    const { geometry, ids } = fixture()
    required(geometry.pdfCalibration).openingFacePairs = []
    expect(createVerticalReferenceDraft(geometry, ids).thresholds).toEqual([])
  })

  it('deduplicates identical source face and width proof pairs, regardless of order', () => {
    const { geometry, ids } = fixture()
    const pairs = required(required(geometry.pdfCalibration).openingFacePairs)
    const pair = required(pairs[0])
    pairs.push(structuredClone(pair))
    required(geometry.pdfCalibration).openingWidthProofs = [
      {
        ...pair.bindings[1],
        labelIndex: 1,
        sameOpeningAs: { roomSourceNumber: 1, openingId: pair.bindings[0].opening.id },
        oppositeBinding: pair.bindings[0],
      },
    ]
    expect(createVerticalReferenceDraft(geometry, ids).thresholds).toHaveLength(1)
  })

  it('holds every relation involving an opening with conflicting opposite partners', () => {
    const { geometry, ids } = fixture()
    const pairs = required(required(geometry.pdfCalibration).openingFacePairs)
    const pair = required(pairs[0])
    const third = { ...required(geometry.openings[1]), id: 'third', wallId: 'wall-1' }
    geometry.openings.push(third)
    pairs.push({
      bindings: [pair.bindings[0], { opening: third, wall: required(geometry.walls[1]) }],
      jambs: pair.jambs,
    })
    expect(createVerticalReferenceDraft(geometry, ids).thresholds).toEqual([])
  })
})

describe('room ownership reconciliation before height review', () => {
  function nameOnly() {
    const { geometry, ids } = fixture()
    geometry.rooms = [required(geometry.rooms[1])]
    const { sourceNumber: _removed, ...room } = required(geometry.rooms[0])
    geometry.rooms = [room]
    geometry.pdfCalibration = undefined
    geometry.walls = [required(geometry.walls[1])]
    geometry.openings = []
    return { geometry, ids, readings: [{ name: 'Bath', sourceNumber: 1, areaM2: 12 }] }
  }

  it('adds the server-resolved source number before reviewing, without changing the original', () => {
    const { geometry, readings, ids } = nameOnly()
    const original = structuredClone(geometry)
    const prepared = prepareVerticalReferenceGeometry(geometry, readings)
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.geometry.rooms[0]?.sourceNumber).toBe(1)
    expect(prepared.geometry.rooms[0]?.polygon).toEqual(geometry.rooms[0]?.polygon)
    expect(geometry).toEqual(original)
    const draft = createVerticalReferenceDraft(prepared.geometry, ids)
    draft.kind = 'finished-floor'
    draft.zeroFloorId = required(draft.floors[0]).id
    draft.sourceKind = 'dimensioned-drawing'
    draft.sourceReference = 'Synthetic fixture only'
    required(draft.floors[0]).surface = 'finished-floor'
    required(draft.floors[0]).elevation = '0'
    required(draft.wallBases[0]).floorId = draft.zeroFloorId
    const built = buildVerticalReferenceRequest(prepared.geometry, draft)
    if (!built.ok) throw new Error(built.error)
    const serverRooms = required(
      reconcilePlanGeometryRooms({ ...prepared.geometry, obstacles: [] }, readings),
    ).rooms
    expect(serverRooms).toEqual(prepared.geometry.rooms)
    const saved = applyPlanVerticalReference(
      { ...prepared.geometry, rooms: serverRooms },
      built.request,
      'owner',
      '2026-10-11T12:00:00.000Z',
    )
    expect(saved.ok).toBe(true)
  })

  it('does not copy old levels or approval when name-only stored owners are canonicalized', () => {
    const { geometry, readings, ids } = nameOnly()
    const draft = createVerticalReferenceDraft(geometry, ids)
    draft.kind = 'finished-floor'
    draft.zeroFloorId = required(draft.floors[0]).id
    draft.sourceKind = 'site-measurement'
    draft.sourceReference = 'Synthetic fixture only'
    required(draft.floors[0]).surface = 'finished-floor'
    required(draft.floors[0]).elevation = '0'
    required(draft.wallBases[0]).floorId = draft.zeroFloorId
    const built = buildVerticalReferenceRequest(geometry, draft)
    if (!built.ok) throw new Error(built.error)
    const saved = applyPlanVerticalReference(
      geometry,
      built.request,
      'owner',
      '2026-10-11T12:00:00.000Z',
    )
    if (!saved.ok) throw new Error(saved.error)
    const prepared = prepareVerticalReferenceGeometry(saved.geometry, readings)
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.geometry.verticalReference).toBe(saved.geometry.verticalReference)
    expect(currentPlanVerticalReference(prepared.geometry)).toBeUndefined()
    const replacement = createVerticalReferenceDraft(prepared.geometry, ids)
    expect(replacement.kind).toBe('')
    expect(replacement.zeroFloorId).toBe('')
    expect(replacement.sourceKind).toBe('')
    expect(replacement.floors[0]?.elevation).toBe('')
    expect(replacement.wallBases[0]?.floorId).toBe('')
    expect(replacement.floors[0]?.id).not.toBe(draft.floors[0]?.id)
  })

  it.each(['area', 'missing-room', 'duplicate-reading'] as const)(
    'holds %s rather than dropping a floor',
    (failure) => {
      const { geometry, readings } = nameOnly()
      if (failure === 'area') readings[0] = { ...required(readings[0]), areaM2: 30 }
      if (failure === 'missing-room') readings[0] = { ...required(readings[0]), name: 'Other' }
      if (failure === 'duplicate-reading') readings.push({ ...required(readings[0]) })
      const before = structuredClone(geometry)
      expect(prepareVerticalReferenceGeometry(geometry, readings).ok).toBe(false)
      expect(geometry).toEqual(before)
    },
  )

  it('holds an empty floor inventory', () => {
    const { geometry, readings } = nameOnly()
    geometry.rooms = []
    expect(prepareVerticalReferenceGeometry(geometry, readings).ok).toBe(false)
  })

  it('retains one physical floor with shared source labels', () => {
    const { geometry } = fixture()
    const prepared = prepareVerticalReferenceGeometry(geometry, [
      { name: 'Hall', sourceNumber: 1, areaM2: 6 },
      { name: 'Corridor', sourceNumber: 5, areaM2: 6 },
      { name: 'Bath', sourceNumber: 2, areaM2: 12 },
      { name: 'Balcony', sourceNumber: 3, areaM2: 12 },
    ])
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.geometry.rooms).toHaveLength(3)
    expect(prepared.geometry.rooms[0]?.sourceNumbers).toEqual([1, 5])
  })

  it('canonicalizes a renamed numbered owner before entry', () => {
    const { geometry, ids } = nameOnly()
    const { sourceNumbers: _sharedLabels, ...room } = required(geometry.rooms[0])
    geometry.rooms[0] = { ...room, name: 'Old room title', sourceNumber: 1 }
    const prepared = prepareVerticalReferenceGeometry(geometry, [
      { name: 'Canonical Bath', sourceNumber: 1, areaM2: 12 },
    ])
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.geometry.rooms[0]?.name).toBe('Canonical Bath')
    expect(createVerticalReferenceDraft(prepared.geometry, ids).floors[0]?.room.name).toBe(
      'Canonical Bath',
    )
    expect(geometry.rooms[0]?.name).toBe('Old room title')
  })
})
