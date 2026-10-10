import type { PlanGeometry } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import {
  applyPlanVerticalReference,
  currentPlanVerticalReference,
  inspectPlanVerticalReference,
  openingOnVerticalFloorBoundary,
  referenceTransferIssue,
  wallFloorElevation,
} from './plan-vertical-reference'

const verifiedAt = '2026-10-10T09:00:00.000Z'
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing synthetic fixture element')
  return value
}
function fixture(relation: 'faces' | 'width' = 'faces') {
  const polygon = (y: number) => [
    { xCm: 0, yCm: y },
    { xCm: 400, yCm: y },
    { xCm: 400, yCm: y + 300 },
    { xCm: 0, yCm: y + 300 },
  ]
  const geometry: PlanGeometry = {
    version: 1,
    status: 'confirmed',
    widthCm: 400,
    heightCm: 1000,
    warnings: [],
    rooms: [
      { name: 'Interior', polygon: polygon(0), sourceNumbers: [1, 5] },
      { name: 'Bath', polygon: polygon(350), sourceNumber: 2 },
      { name: 'Balcony', polygon: polygon(700), sourceNumber: 3, spaceKind: 'balcony' },
    ],
    walls: [0, 350, 700].map((y, index) => ({
      id: `wall-${index}`,
      kind: 'outer',
      start: { xCm: 0, yCm: y },
      end: { xCm: 400, yCm: y },
      heightCm: 270,
    })),
    openings: [
      {
        id: 'inside',
        type: 'balcony',
        wallId: 'wall-0',
        offsetCm: 100,
        widthCm: 90,
        bottomCm: 2,
        heightCm: 210,
      },
      {
        id: 'outside',
        type: 'balcony',
        wallId: 'wall-2',
        offsetCm: 100,
        widthCm: 90,
        bottomCm: 17,
        heightCm: 210,
      },
    ],
    footprint: [
      { xCm: 0, yCm: 0 },
      { xCm: 400, yCm: 0 },
      { xCm: 400, yCm: 1000 },
      { xCm: 0, yCm: 1000 },
    ],
  }
  const first = {
    opening: structuredClone(required(geometry.openings[0])),
    wall: structuredClone(required(geometry.walls[0])),
  }
  const second = {
    opening: structuredClone(required(geometry.openings[1])),
    wall: structuredClone(required(geometry.walls[2])),
  }
  geometry.pdfCalibration = {
    sourceSha256: 'a'.repeat(64),
    pdfPage: 1,
    cmPerPoint: 1,
    origin: { x: 0, y: 0 },
    anchorRoomNumbers: [1],
    labelIndexes: [],
    derivedOpeningIds: [],
    wallFaceRoomPolygons: structuredClone(geometry.rooms.map((value) => value.polygon)),
    ...(relation === 'faces'
      ? {
          openingFacePairs: [
            {
              bindings: [first, second],
              jambs: [
                { operationIndex: 1, subpathIndex: 0, segmentIndex: 0 },
                { operationIndex: 1, subpathIndex: 0, segmentIndex: 1 },
              ],
            },
          ],
        }
      : {
          openingWidthProofs: [
            {
              ...first,
              labelIndex: 1,
              sameOpeningAs: { roomSourceNumber: 3, openingId: 'outside' },
              oppositeBinding: second,
            },
          ],
        }),
  }
  const request = {
    version: 1,
    id: 'survey-zero',
    kind: 'finished-floor',
    zeroFloorId: 'floor-0',
    acknowledged: true,
    floors: geometry.rooms.map((room, index) => ({
      id: `floor-${index}`,
      surface: 'finished-floor',
      room: structuredClone(room),
      elevationCm: required([0, -2, -15][index]),
    })),
    ceilings: [{ id: 'ceiling-0', floorId: 'floor-0', elevationCm: 270 }],
    wallBases: geometry.walls.map(({ id, kind, start, end }, index) => ({
      wall: structuredClone({ id, kind, start, end }),
      floorId: `floor-${index}`,
    })),
    thresholds: [
      {
        id: 'balcony-threshold',
        elevationCm: 3,
        bindings: geometry.openings.map(({ id, type, wallId, offsetCm, widthCm }, index) => ({
          opening: { id, type, wallId, offsetCm, widthCm },
          floorId: index ? 'floor-2' : 'floor-0',
        })),
      },
    ],
    source: { kind: 'site-measurement', reference: 'Synthetic test, not user measurements' },
  }
  return { geometry, request }
}
function accepted() {
  const { geometry, request } = fixture()
  const result = applyPlanVerticalReference(geometry, request, 'owner', verifiedAt)
  if (!result.ok) throw new Error(result.error)
  return result.geometry
}

describe('explicit common vertical reference', () => {
  it('holds a threshold when one source side also claims a different aperture partner', () => {
    const geometry = accepted()
    const original = required(required(geometry.pdfCalibration).openingFacePairs?.[0])
    const host = required(geometry.walls[1])
    const competing = {
      ...structuredClone(required(geometry.openings[1])),
      id: 'competing',
      wallId: host.id,
    }
    geometry.openings.push(competing)
    required(geometry.pdfCalibration).openingFacePairs?.push({
      bindings: [
        structuredClone(original.bindings[0]),
        { opening: competing, wall: structuredClone(host) },
      ],
      jambs: structuredClone(original.jambs),
    })
    expect(inspectPlanVerticalReference(geometry)[0]?.message).toContain(
      'двух подтверждённых сторон',
    )
    expect(currentPlanVerticalReference(geometry)).toBeUndefined()
    expect(applyPlanVerticalReference(geometry, undefined, 'owner', verifiedAt).ok).toBe(false)
  })
  it('holds both owner assignments when source faces coincide on two floor boundaries', () => {
    const { geometry, request } = fixture()
    const inside = required(geometry.rooms[0])
    const bath = required(geometry.rooms[1])
    const outside = required(geometry.rooms[2])
    bath.polygon = bath.polygon.map((point) => ({ ...point, yCm: point.yCm + 300 }))
    outside.polygon = outside.polygon.map((point) => ({ ...point, yCm: point.yCm - 400 }))
    expect(required(inside.polygon[2]).yCm).toBe(required(outside.polygon[0]).yCm)
    for (const index of [0, 2]) {
      const host = required(geometry.walls[index])
      host.start.yCm = 300
      host.end.yCm = 300
    }
    const bathWall = required(geometry.walls[1])
    bathWall.start.yCm = 650
    bathWall.end.yCm = 650
    for (const [index, floor] of request.floors.entries()) {
      floor.room = structuredClone(required(geometry.rooms[index]))
      floor.elevationCm = 0
    }
    for (const [index, base] of request.wallBases.entries()) {
      const { id, kind, start, end } = required(geometry.walls[index])
      base.wall = structuredClone({ id, kind, start, end })
    }
    const pdf = required(geometry.pdfCalibration)
    pdf.wallFaceRoomPolygons = structuredClone(geometry.rooms.map((room) => room.polygon))
    const pair = required(required(pdf.openingFacePairs)[0])
    pair.bindings[0].wall = structuredClone(required(geometry.walls[0]))
    pair.bindings[1].wall = structuredClone(required(geometry.walls[2]))

    expect(applyPlanVerticalReference(geometry, request, 'owner', verifiedAt).ok).toBe(false)
    required(request.wallBases[0]).floorId = 'floor-2'
    required(request.wallBases[2]).floorId = 'floor-0'
    const threshold = required(request.thresholds[0])
    required(threshold.bindings[0]).floorId = 'floor-2'
    required(threshold.bindings[1]).floorId = 'floor-0'
    expect(applyPlanVerticalReference(geometry, request, 'owner', verifiedAt).ok).toBe(false)
  })

  it.each([null, false, 0, ''])(
    'malformed falsy reference %s cannot bypass transfer gates',
    (verticalReference) => {
      const { geometry } = fixture()
      const malformed = { ...geometry, verticalReference } as unknown as PlanGeometry
      expect(referenceTransferIssue(malformed)?.id).toBe('vertical-reference')
    },
  )
  it('declared wall bases alone cannot supply aperture-floor ownership', () => {
    const { geometry, request } = fixture()
    request.thresholds = []
    required(request.wallBases[0]).floorId = 'floor-1'
    const result = applyPlanVerticalReference(geometry, request, 'owner', verifiedAt)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(openingOnVerticalFloorBoundary(result.geometry, 'inside', 'floor-1')).toBe(false)
    expect(openingOnVerticalFloorBoundary(result.geometry, 'outside', 'floor-2')).toBe(true)
  })
  it('uses exact preserved source cuts rather than rounded offsets', () => {
    const { geometry, request } = fixture()
    const room = required(geometry.rooms[0])
    room.polygon = [
      { xCm: 100.04, yCm: 0 },
      { xCm: 190.04, yCm: 0 },
      { xCm: 190.04, yCm: 300 },
      { xCm: 100.04, yCm: 300 },
    ]
    required(request.floors[0]).room = structuredClone(room)
    const pdf = required(geometry.pdfCalibration)
    pdf.wallFaceRoomPolygons = structuredClone(geometry.rooms.map((value) => value.polygon))
    const pair = required(required(pdf.openingFacePairs)[0])
    pair.bindings[0].cut = [
      { xCm: 100.04, yCm: 0 },
      { xCm: 190.04, yCm: 0 },
    ]
    const result = applyPlanVerticalReference(geometry, request, 'owner', verifiedAt)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(openingOnVerticalFloorBoundary(result.geometry, 'inside', 'floor-0')).toBe(true)
    const duplicate = structuredClone(pair)
    duplicate.bindings[0].cut = [
      { xCm: 100.05, yCm: 0 },
      { xCm: 190.04, yCm: 0 },
    ]
    required(pdf.openingFacePairs).push(duplicate)
    expect(openingOnVerticalFloorBoundary(result.geometry, 'inside', 'floor-0')).toBe(false)
    expect(inspectPlanVerticalReference(result.geometry).length).toBeGreaterThan(0)
  })
  it.each(['rooms', 'walls', 'openings'] as const)(
    'bounds current %s inventory before owner comparisons',
    (kind) => {
      const geometry = accepted()
      while (geometry[kind].length <= 200) {
        if (kind === 'rooms') geometry.rooms.push(structuredClone(required(geometry.rooms[0])))
        if (kind === 'walls') geometry.walls.push(structuredClone(required(geometry.walls[0])))
        if (kind === 'openings')
          geometry.openings.push(structuredClone(required(geometry.openings[0])))
      }
      expect(inspectPlanVerticalReference(geometry).length).toBeGreaterThan(0)
    },
  )
  it('holds duplicated physical polygons even under different names and winding', () => {
    const { geometry, request } = fixture()
    required(geometry.rooms[1]).polygon = [...required(geometry.rooms[0]).polygon].reverse()
    required(request.floors[1]).room = structuredClone(required(geometry.rooms[1]))
    request.thresholds = []
    expect(applyPlanVerticalReference(geometry, request, 'owner', verifiedAt).ok).toBe(false)
  })
  it('requires nondegenerate physical floors', () => {
    const { geometry, request } = fixture()
    required(geometry.rooms[1]).polygon = [0, 1, 2].map((xCm) => ({ xCm, yCm: 1 }))
    required(request.floors[1]).room = structuredClone(required(geometry.rooms[1]))
    request.thresholds = []
    expect(applyPlanVerticalReference(geometry, request, 'owner', verifiedAt).ok).toBe(false)
  })
  it('captures image calibration on the server and invalidates changed image source', () => {
    const { geometry, request } = fixture()
    geometry.imageCalibration = {
      sourceSha256: 'c'.repeat(64),
      pdfPage: 1,
      imageWidthPx: 1000,
      imageHeightPx: 1000,
      pixelStart: { x: 0, y: 0 },
      pixelEnd: { x: 100, y: 0 },
      worldStart: { xCm: 0, yCm: 0 },
      lengthCm: 100,
      direction: 'right',
    }
    const result = applyPlanVerticalReference(geometry, request, 'owner', verifiedAt)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    required(result.geometry.imageCalibration).sourceSha256 = 'd'.repeat(64)
    expect(inspectPlanVerticalReference(result.geometry).length).toBeGreaterThan(0)
    expect(result.geometry.verticalReference?.contextSnapshot.imageCalibration?.sourceSha256).toBe(
      'c'.repeat(64),
    )
  })
  it('does not equate existing and finished zero surfaces', () => {
    const { geometry, request } = fixture()
    expect(
      applyPlanVerticalReference(
        geometry,
        { ...request, kind: 'existing-floor' },
        'owner',
        verifiedAt,
      ).ok,
    ).toBe(false)
    request.floors.forEach((floor) => {
      floor.surface = 'existing-floor'
    })
    expect(
      applyPlanVerticalReference(
        geometry,
        { ...request, kind: 'existing-floor' },
        'owner',
        verifiedAt,
      ).ok,
    ).toBe(true)
  })
  it('requires an explicit modeled surface on every floor', () => {
    const { geometry, request } = fixture()
    const { surface: _surface, ...floor } = required(request.floors[1])
    expect(
      applyPlanVerticalReference(
        geometry,
        { ...request, floors: [request.floors[0], floor, request.floors[2]] },
        'owner',
        verifiedAt,
      ).ok,
    ).toBe(false)
  })
  it.each(['faces', 'width'] as const)(
    'stores signed floors and separately bound threshold using %s evidence',
    (relation) => {
      const { geometry, request } = fixture(relation)
      const before = structuredClone(geometry)
      const result = applyPlanVerticalReference(geometry, request, 'owner', verifiedAt)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(geometry).toEqual(before)
      expect(inspectPlanVerticalReference(result.geometry)).toEqual([])
      expect(result.geometry.verticalReference?.floors.map((floor) => floor.elevationCm)).toEqual([
        0, -2, -15,
      ])
      expect(result.geometry.openings.map((value) => value.bottomCm)).toEqual([2, 17])
      expect(wallFloorElevation(result.geometry, 'wall-2')).toBe(-15)
      expect(result.geometry.verticalReference?.verifiedBy).toBe('owner')
      expect(result.geometry.verticalReference?.verifiedAt).toBe(verifiedAt)
      expect(referenceTransferIssue(result.geometry)).toBeUndefined()
    },
  )
  it('leaves legacy models untouched without pretending they share a zero', () => {
    const { geometry } = fixture()
    expect(applyPlanVerticalReference(geometry, undefined, 'owner', verifiedAt)).toEqual({
      ok: true,
      geometry,
    })
    expect(currentPlanVerticalReference(geometry)).toBeUndefined()
    expect(wallFloorElevation(geometry, 'wall-0')).toBeUndefined()
    expect(referenceTransferIssue(geometry)).toBeUndefined()
  })
  it('preserves fresh stored metadata, and clears explicitly', () => {
    const geometry = accepted()
    expect(applyPlanVerticalReference(geometry, undefined, 'new-owner', 'not-a-date')).toEqual({
      ok: true,
      geometry,
    })
    const result = applyPlanVerticalReference(geometry, null, 'owner', verifiedAt)
    expect(result.ok && result.geometry.verticalReference).toBeUndefined()
    expect(geometry.verticalReference).toBeDefined()
  })
  it.each(['verifiedAt', 'verifiedBy', 'contextSnapshot', 'sourceSnapshot', 'mayTransfer2D3D'])(
    'rejects browser authority field %s',
    (key) => {
      const { geometry, request } = fixture()
      expect(
        applyPlanVerticalReference(geometry, { ...request, [key]: true }, 'owner', verifiedAt).ok,
      ).toBe(false)
    },
  )
  it.each([false, undefined, 'true', 1])('requires explicit acknowledgement %s', (acknowledged) => {
    const { geometry, request } = fixture()
    expect(
      applyPlanVerticalReference(geometry, { ...request, acknowledged }, 'owner', verifiedAt).ok,
    ).toBe(false)
  })
  it.each([NaN, Infinity, -Infinity, -600.01, 600.01])(
    'rejects invalid signed elevation %s',
    (value) => {
      const { geometry, request } = fixture()
      required(request.floors[1]).elevationCm = value
      expect(applyPlanVerticalReference(geometry, request, 'owner', verifiedAt).ok).toBe(false)
    },
  )
  it.each([
    (request: ReturnType<typeof fixture>['request']) => {
      required(request.floors[0]).elevationCm = 1
    },
    (request: ReturnType<typeof fixture>['request']) => {
      request.zeroFloorId = 'missing'
    },
    (request: ReturnType<typeof fixture>['request']) => {
      request.floors.pop()
    },
    (request: ReturnType<typeof fixture>['request']) => {
      required(request.floors[1]).id = 'floor-0'
    },
    (request: ReturnType<typeof fixture>['request']) => {
      required(request.floors[1]).room = structuredClone(required(request.floors[0]).room)
    },
    (request: ReturnType<typeof fixture>['request']) => {
      request.wallBases.pop()
    },
    (request: ReturnType<typeof fixture>['request']) => {
      required(request.wallBases[1]).floorId = 'missing'
    },
    (request: ReturnType<typeof fixture>['request']) => {
      required(request.wallBases[1]).wall.start.xCm = 1
    },
    (request: ReturnType<typeof fixture>['request']) => {
      required(request.ceilings[0]).elevationCm = 0
    },
    (request: ReturnType<typeof fixture>['request']) => {
      required(request.thresholds[0]).elevationCm = -1
    },
    (request: ReturnType<typeof fixture>['request']) => {
      required(required(request.thresholds[0]).bindings[1]).floorId = 'floor-0'
    },
    (request: ReturnType<typeof fixture>['request']) => {
      required(required(request.thresholds[0]).bindings[1]).opening.offsetCm = 101
    },
  ])('holds incomplete, contradictory or stale owners %#', (mutate) => {
    const { geometry, request } = fixture()
    mutate(request)
    expect(applyPlanVerticalReference(geometry, request, 'owner', verifiedAt).ok).toBe(false)
  })
  it.each([
    (geometry: PlanGeometry) => {
      required(required(geometry.rooms[0]).polygon[0]).xCm = 1
    },
    (geometry: PlanGeometry) => {
      required(geometry.rooms[0]).sourceNumbers = [1, 6]
    },
    (geometry: PlanGeometry) => {
      required(geometry.walls[0]).end.xCm = 399
    },
    (geometry: PlanGeometry) => {
      required(required(geometry.footprint)[0]).xCm = 1
    },
    (geometry: PlanGeometry) => {
      geometry.voids = [{ id: 'shaft', polygon: required(geometry.rooms[1]).polygon }]
    },
    (geometry: PlanGeometry) => {
      required(geometry.pdfCalibration).sourceSha256 = 'b'.repeat(64)
    },
    (geometry: PlanGeometry) => {
      required(geometry.pdfCalibration).pdfPage = 2
    },
    (geometry: PlanGeometry) => {
      required(geometry.pdfCalibration).cmPerPoint = 2
    },
    (geometry: PlanGeometry) => {
      required(geometry.pdfCalibration).origin.x = 1
    },
    (geometry: PlanGeometry) => {
      delete required(geometry.pdfCalibration).openingFacePairs
    },
    (geometry: PlanGeometry) => {
      required(geometry.openings[0]).type = 'window'
    },
  ])('stale approval never supplies elevations or survives omission %#', (mutate) => {
    const geometry = accepted()
    mutate(geometry)
    expect(inspectPlanVerticalReference(geometry).length).toBeGreaterThan(0)
    expect(currentPlanVerticalReference(geometry)).toBeUndefined()
    expect(wallFloorElevation(geometry, 'wall-0')).toBeUndefined()
    expect(applyPlanVerticalReference(geometry, undefined, 'owner', verifiedAt).ok).toBe(false)
    expect(referenceTransferIssue(geometry)?.id).toBe('vertical-reference')
  })
  it('cannot claim arbitrary source faces belong to unrelated floors', () => {
    const { geometry, request } = fixture()
    required(request.wallBases[0]).floorId = 'floor-1'
    required(required(request.thresholds[0]).bindings[0]).floorId = 'floor-1'
    expect(applyPlanVerticalReference(geometry, request, 'owner', verifiedAt).ok).toBe(false)
  })
  it('does not accept invented correspondence when no current source pair exists', () => {
    const { geometry, request } = fixture()
    delete geometry.pdfCalibration
    expect(applyPlanVerticalReference(geometry, request, 'owner', verifiedAt).ok).toBe(false)
    request.thresholds = []
    expect(applyPlanVerticalReference(geometry, request, 'owner', verifiedAt).ok).toBe(true)
  })
  it('keeps local heights and clearances independent of reference snapshots', () => {
    const geometry = accepted()
    required(geometry.openings[0]).bottomCm = 4
    required(geometry.openings[0]).clearance = {
      side: 'left',
      depthCm: 90,
      shape: 'swing',
      hinge: 'start',
    }
    required(geometry.walls[0]).heightCm = 280
    expect(inspectPlanVerticalReference(geometry)).toEqual([])
  })
})
