import { describe, expect, it } from 'vitest'
import { exactNativePointKey } from './plan-native-exact-intersections'
import { nativeFaceRationalPredicates } from './plan-native-face-rational'
import { nativePaintedFloorBoundarySupports } from './plan-native-painted-floor-boundaries'
import { floorHeightFixture } from './plan-native-reviewed-floor-heights.fixture'
import { nativeVisiblePaintRegions } from './plan-native-visible-paint'
import type { PdfVectorPath } from './plan-pdf-linework'

const rectangle = (left: number, top: number, right: number, bottom: number) => [
  { x: left, y: top },
  { x: right, y: top },
  { x: right, y: bottom },
  { x: left, y: bottom },
]
function input() {
  const fixture = floorHeightFixture()
  return { ...fixture, reviewed: fixture.reviewedFloors }
}
function mask(
  fixture: ReturnType<typeof input>,
  operationIndex: number,
  points: PdfVectorPath['points'],
) {
  fixture.work.paths.push({ operationIndex, subpathIndex: 0, paint: 'fill', closed: true, points })
}
function refreshSelection(fixture: ReturnType<typeof input>) {
  const piece = nativeVisiblePaintRegions(fixture).regions.find(
    (region) => region.candidateId === 'native-fill-10:0',
  )?.pieces[0]
  const selected = fixture.reviewed.floors[0]
  if (!piece || !selected) throw new Error('Missing selected source piece')
  selected.polygon = structuredClone(piece.polygon)
  selected.holes = structuredClone(piece.holes)
  selected.boundaryRoles = piece.polygon.map((_, edgeIndex) => ({ edgeIndex, kind: 'unresolved' }))
}

describe('fresh exact source paint boundary coverage, not physical walls', () => {
  it('checks later ordinary paint separately from exact boundary coverage when explicitly requested', () => {
    const fixture = input()
    fixture.work.paintBounds = {
      complete: true,
      refusalReason: null,
      events: [
        {
          operationIndex: 10,
          kind: 'vector',
          subpathCount: 1,
          bounds: { left: 100, top: 100, right: 300, bottom: 300 },
          reason: null,
        },
        {
          operationIndex: 1000,
          kind: 'image',
          bounds: { left: 90, top: 90, right: 310, bottom: 310 },
          reason: null,
        },
      ],
    }
    const legacy = nativePaintedFloorBoundarySupports(fixture)
    const result = nativePaintedFloorBoundarySupports({ ...fixture, includeSpanVisibility: true })
    expect(legacy.boundaryInspection.floors[0]?.edges[0]?.contacts[0]).not.toHaveProperty(
      'visibility',
    )
    for (const row of result.boundaryInspection.floors[0]?.edges ?? []) {
      expect(row).toMatchObject({ status: 'linked', coverage: 'complete', omittedInkCount: 0 })
      expect(row.contacts[0]?.visibility).toMatchObject({
        status: 'held',
        reason: 'later-paint-may-cover-source-span',
        blockerOperations: [1000],
      })
    }
    expect(result.floors).toEqual(legacy.floors)
    expect(result.physicalBoundariesAccepted).toBe(false)
  })
  it('links fill-only boundaries without changing the legacy stroked-edge contract', () => {
    const fixture = input()
    const firstRole = fixture.reviewed.floors[0]?.boundaryRoles[0]
    if (!firstRole) throw new Error('Missing reviewed edge')
    firstRole.kind = 'wall-face'
    const before = structuredClone(fixture)
    const result = nativePaintedFloorBoundarySupports(fixture)
    expect(result.boundaryInspection).toMatchObject({ status: 'checked', reason: null })
    expect(result.boundaryInspection.floors[0]?.edges).toHaveLength(4)
    for (const edge of result.boundaryInspection.floors[0]?.edges ?? []) {
      expect(edge).toMatchObject({
        status: 'linked',
        coverage: 'complete',
        sourceRegionSide: 'left',
        omittedInkCount: 0,
      })
      expect(edge.contacts).toHaveLength(1)
      expect(edge.contacts[0]).toMatchObject({ operationIndex: 10, paintSide: 'selected-region' })
    }
    expect(result.boundaryInspection.floors[0]?.edges[0]?.declaredRole).toBe('wall-face')
    expect(result.boundaryInspection.floors[0]?.edges[1]?.declaredRole).toBe('unresolved')
    expect(result).toMatchObject({
      physicalBoundariesAccepted: false,
      readyFor2D: false,
      readyFor3D: false,
      measurementsConfirmed: false,
    })
    expect(fixture).toEqual(before)
  })

  it('keeps rational perimeter cuts and hole-edge provenance through JSON roundtrip', () => {
    const fixture = input()
    mask(fixture, 20, rectangle(200, 200, 230, 230))
    mask(fixture, 30, [
      { x: 251, y: 80 },
      { x: 310, y: 111 },
      { x: 270, y: 141 },
    ])
    refreshSelection(fixture)
    const result = nativePaintedFloorBoundarySupports(fixture)
    expect(result.boundaryInspection.status).toBe('checked')
    expect(
      nativePaintedFloorBoundarySupports(JSON.parse(JSON.stringify(fixture))).boundaryInspection,
    ).toEqual(result.boundaryInspection)
    const floor = result.floors[0]
    const edges = result.boundaryInspection.floors[0]?.edges
    expect(
      edges
        ?.filter((edge) => edge.ringIndex > 0)
        .every((edge) => edge.declaredRole === 'unresolved'),
    ).toBe(true)
    if (!floor || !edges) throw new Error('Missing boundary inspection')
    expect(
      floor.polygon.some(
        (point, index) => exactNativePointKey(point) !== floor.exactPointKeys[index],
      ),
    ).toBe(true)
    expect(edges).toHaveLength(floor.polygon.length + 4)
    expect(edges.every((edge) => edge.coverage === 'complete')).toBe(true)
    expect(edges.filter((edge) => edge.ringIndex === 1)).toHaveLength(4)
    for (const edge of edges.filter((edge) => edge.ringIndex === 1)) {
      expect(edge.contacts[0]).toMatchObject({ operationIndex: 20, paintSide: 'opposite-region' })
      expect(edge.sourceRegionSide).toBe('right')
    }
    expect(
      edges.some(
        (edge) =>
          edge.ringIndex === 0 &&
          edge.contacts.some(
            (contact) => contact.operationIndex === 30 && contact.paintSide === 'opposite-region',
          ),
      ),
    ).toBe(true)
  })

  it.each(['outer', 'hole', 'cut'] as const)(
    'retains adjacent source semantics when the %s command reverses',
    (kind) => {
      const fixture = input()
      mask(fixture, 20, rectangle(200, 200, 230, 230))
      mask(fixture, 30, [
        { x: 251, y: 80 },
        { x: 310, y: 111 },
        { x: 270, y: 141 },
      ])
      const index = kind === 'outer' ? 0 : kind === 'hole' ? 1 : 2
      fixture.work.paths[index]?.points.reverse()
      refreshSelection(fixture)
      const result = nativePaintedFloorBoundarySupports(fixture)
      expect(result.boundaryInspection.status).toBe('checked')
      expect(
        result.boundaryInspection.floors[0]?.edges.every((edge) => edge.status === 'linked'),
      ).toBe(true)
      expect(
        result.boundaryInspection.floors[0]?.edges
          .filter((edge) => edge.ringIndex === 1)
          .every((edge) =>
            edge.contacts.every((contact) => contact.paintSide === 'opposite-region'),
          ),
      ).toBe(true)
    },
  )

  it('does not turn a wall-face declaration into source or physical acceptance', () => {
    const fixture = input()
    for (const role of fixture.reviewed.floors[0]?.boundaryRoles ?? []) role.kind = 'wall-face'
    const result = nativePaintedFloorBoundarySupports(fixture)
    expect(result.physicalBoundariesAccepted).toBe(false)
    expect(
      result.boundaryInspection.floors[0]?.edges.every((edge) =>
        edge.contacts.every((contact) => contact.paintSide === 'selected-region'),
      ),
    ).toBe(true)
  })

  it.each(['source', 'frame', 'stale', 'truncated'] as const)(
    'refuses %s rather than retaining stale bound edges',
    (kind) => {
      const fixture = input()
      if (kind === 'source') fixture.reviewed.source.sha256 = 'c'.repeat(64)
      if (kind === 'frame') fixture.lineworkSource = { ...fixture.lineworkSource, width: 900 }
      if (kind === 'stale') {
        const point = fixture.work.paths[0]?.points[0]
        if (!point) throw new Error('Missing source point')
        point.x += 0.001
      }
      if (kind === 'truncated') fixture.work.truncated = true
      const result = nativePaintedFloorBoundarySupports(fixture)
      expect(result.boundaryInspection.status).toBe('held')
      expect(result.boundaryInspection.floors).toEqual([])
      expect(result.physicalBoundariesAccepted).toBe(false)
    },
  )

  it('retains possible omitted ink without confusing source coverage with final visibility', () => {
    const fixture = input()
    fixture.work.skippedCurves = 1
    Object.assign(fixture.work, {
      skippedCurveBounds: [
        { operationIndex: 1000, paint: 'stroke', bounds: { left: 0, top: 0, right: 1, bottom: 1 } },
      ],
    })
    const result = nativePaintedFloorBoundarySupports(fixture)
    expect(result.boundaryInspection.status).toBe('checked')
    expect(
      result.boundaryInspection.floors[0]?.edges.every(
        (edge) => edge.status === 'linked' && edge.omittedInkCount === 1,
      ),
    ).toBe(true)
    expect(result.physicalBoundariesAccepted).toBe(false)
  })

  it.each(['text', 'image'] as const)(
    'cannot exclude omitted vector ink through a %s paint event',
    (kind) => {
      const fixture = input()
      fixture.work.skippedCurves = 1
      Object.assign(fixture.work, {
        skippedCurveBounds: [
          {
            operationIndex: 1000,
            paint: 'stroke',
            bounds: { left: 0, top: 0, right: 1, bottom: 1 },
          },
        ],
        paintBounds: {
          complete: true,
          refusalReason: null,
          events: [
            {
              operationIndex: 10,
              kind: 'vector',
              bounds: { left: 100, top: 100, right: 300, bottom: 300 },
              reason: null,
            },
            {
              operationIndex: 1000,
              kind,
              bounds: kind === 'text' ? null : { left: 0, top: 0, right: 1, bottom: 1 },
              reason: kind === 'text' ? 'empty-source-text-paint' : null,
            },
          ],
        },
      })
      const result = nativePaintedFloorBoundarySupports(fixture)
      expect(result.boundaryInspection.status).toBe('checked')
      expect(
        result.boundaryInspection.floors[0]?.edges.every((edge) => edge.omittedInkCount === 1),
      ).toBe(true)
    },
  )

  it('exhausts inspection atomically without discarding the verified source snapshot', () => {
    const fixture = input()
    for (let i = 0; i < 20; i++)
      mask(
        fixture,
        20 + i,
        rectangle(
          200 + (i % 4) * 10,
          200 + Math.floor(i / 4) * 10,
          204 + (i % 4) * 10,
          204 + Math.floor(i / 4) * 10,
        ),
      )
    refreshSelection(fixture)
    fixture.work.skippedCurves = 6000
    Object.assign(fixture.work, {
      skippedCurveBounds: Array.from({ length: 6000 }, (_, index) => ({
        operationIndex: 1000 + index,
        paint: 'stroke',
        bounds: { left: 0, top: 0, right: 1, bottom: 1 },
      })),
    })
    const result = nativePaintedFloorBoundarySupports(fixture)
    expect(result.refusalReason).toBeNull()
    expect(result.floors).toHaveLength(1)
    expect(result.floors[0]?.holes).toHaveLength(20)
    expect(result.boundaryInspection).toEqual({
      status: 'held',
      reason: 'source-boundary-work-limit',
      floors: [],
    })
  })

  it('accounts for all canonical ring edges rather than their approximate display coordinates', () => {
    const fixture = input()
    mask(fixture, 30, [
      { x: 251, y: 80 },
      { x: 310, y: 111 },
      { x: 270, y: 141 },
    ])
    refreshSelection(fixture)
    const result = nativePaintedFloorBoundarySupports(fixture)
    const exact = nativeFaceRationalPredicates()
    const floor = result.floors[0]
    if (!floor) throw new Error('Missing floor')
    for (const edge of result.boundaryInspection.floors[0]?.edges ?? []) {
      expect(
        exact.coversSpan(
          floor.exactPointKeys[edge.edgeIndex] as string,
          floor.exactPointKeys[(edge.edgeIndex + 1) % floor.exactPointKeys.length] as string,
          edge.contacts,
        ),
      ).toBe(true)
    }
  })

  it('holds source references outside the wire range without losing selected paint', () => {
    const fixture = input()
    const path = fixture.work.paths[0]
    const selected = fixture.reviewed.floors[0]
    if (!path || !selected) throw new Error('Missing source fixture')
    path.operationIndex = 100_000
    selected.candidateId = 'native-fill-100000:0'
    const result = nativePaintedFloorBoundarySupports(fixture)
    expect(result.refusalReason).toBeNull()
    expect(result.floors).toHaveLength(1)
    expect(result.boundaryInspection).toEqual({
      status: 'held',
      reason: 'source-boundary-ref-limit',
      floors: [],
    })
  })
})
