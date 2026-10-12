import { describe, expect, it } from 'vitest'
import { exactNativePointKey } from './plan-native-exact-intersections'
import { nativeFaceRationalPredicates } from './plan-native-face-rational'
import { nativeFilledPanelJambContacts } from './plan-native-filled-panel-jambs'
import { floorHeightFixture } from './plan-native-reviewed-floor-heights.fixture'
import { nativeSourceOpeningContacts } from './plan-native-source-opening-contacts'
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
type Input = ReturnType<typeof input>
function paint(fixture: Input, operationIndex: number, points: PdfVectorPath['points']) {
  fixture.work.paths.push({ operationIndex, subpathIndex: 0, paint: 'fill', closed: true, points })
}
function frame(fixture: Input, left = 120, right = 220, top = 90, bottom = 100, operation = 100) {
  const stroke = (operationIndex: number, points: PdfVectorPath['points']) =>
    fixture.work.paths.push({
      operationIndex,
      subpathIndex: 0,
      paint: 'stroke',
      closed: true,
      points,
    })
  stroke(operation, rectangle(left, top, right, bottom))
  stroke(operation + 1, [
    { x: left - 20, y: top - 10 },
    { x: left, y: top - 10 },
    { x: left, y: bottom + 10 },
    { x: left - 20, y: bottom + 10 },
    { x: left - 25, y: bottom + 5 },
    { x: left - 25, y: top - 5 },
  ])
  stroke(operation + 2, [
    { x: right, y: top - 10 },
    { x: right + 20, y: top - 10 },
    { x: right + 25, y: top - 5 },
    { x: right + 25, y: bottom + 5 },
    { x: right + 20, y: bottom + 10 },
    { x: right, y: bottom + 10 },
  ])
}
function refresh(fixture: Input) {
  const piece = nativeVisiblePaintRegions(fixture).regions.find(
    (region) => region.candidateId === 'native-fill-10:0',
  )?.pieces[0]
  const selected = fixture.reviewed.floors[0]
  if (!piece || !selected) throw new Error('Missing fresh source piece')
  selected.polygon = structuredClone(piece.polygon)
  selected.holes = structuredClone(piece.holes)
  selected.boundaryRoles = piece.polygon.map((_, edgeIndex) => ({ edgeIndex, kind: 'unresolved' }))
}
function selectedSide(result: ReturnType<typeof nativeSourceOpeningContacts>, segmentIndex = 2) {
  const target = result.openingInspection.targets.find(
    (target) => target.kind === 'frame-side' && target.sourceRef.segmentIndex === segmentIndex,
  )
  if (!target) throw new Error('Missing freshly derived frame side')
  return target
}
function expectNoPhysicalAuthority(result: ReturnType<typeof nativeSourceOpeningContacts>) {
  expect(result).toMatchObject({
    physicalBoundariesAccepted: false,
    readyFor2D: false,
    readyFor3D: false,
  })
  expect(result.openingInspection).toMatchObject({
    completeOpeningInventory: false,
    physicalJambAccepted: false,
    physicalPassageAccepted: false,
    finalPaintVisibilityProved: false,
  })
}

describe('fresh source rings and logical opening contacts', () => {
  it('links an opposed outer side without changing source inputs or accepting a passage', () => {
    const fixture = input()
    frame(fixture)
    const before = structuredClone(fixture)
    const result = nativeSourceOpeningContacts(fixture)
    expect(result.openingInspection.status).toBe('checked')
    expect(selectedSide(result)).toMatchObject({
      status: 'matched',
      coverage: 'complete',
      frameInteriorSide: 'left',
    })
    expect(selectedSide(result).contacts).toMatchObject([{ ringIndex: 0, regionSide: 'right' }])
    expect(selectedSide(result, 0).status).toBe('unobserved')
    expect(
      result.openingInspection.targets
        .filter((target) => target.kind === 'frame-jamb')
        .every((target) => target.contacts.length === 0),
    ).toBe(true)
    expect(fixture).toEqual(before)
    expectNoPhysicalAuthority(result)
    const sameInterior = input()
    frame(sameInterior, 120, 220, 100, 110)
    const inside = selectedSide(nativeSourceOpeningContacts(sameInterior), 0)
    expect(inside).toMatchObject({ status: 'unresolved', coverage: 'complete' })
    expect(
      inside.contacts.every((contact) => contact.regionSide === inside.frameInteriorSide),
    ).toBe(true)
  })

  it('keeps a rational clipped outer contact partial through JSON roundtrip', () => {
    const fixture = input()
    paint(fixture, 30, [
      { x: 251, y: 80 },
      { x: 310, y: 111 },
      { x: 270, y: 141 },
    ])
    frame(fixture, 250, 280)
    refresh(fixture)
    const result = nativeSourceOpeningContacts(fixture)
    expect(result.openingInspection.status).toBe('checked')
    const side = selectedSide(result)
    expect(side).toMatchObject({ status: 'partial', coverage: 'partial' })
    const exact = nativeFaceRationalPredicates()
    expect(exact.coversSpan(side.startKey, side.endKey, side.contacts)).toBe(false)
    expect(
      side.contacts.some((contact) => {
        const floor = result.floors.find((floor) => floor.id === contact.floorId)
        if (!floor) throw new Error('Missing selected floor')
        return floor.polygon.some(
          (point, index) => exactNativePointKey(point) !== floor.exactPointKeys[index],
        )
      }),
    ).toBe(true)
    expect(
      nativeSourceOpeningContacts(JSON.parse(JSON.stringify(fixture))).openingInspection,
    ).toEqual(result.openingInspection)
    expectNoPhysicalAuthority(result)
  })

  it('links hole sides with the selected region outside the logical strip', () => {
    const fixture = input()
    paint(fixture, 30, rectangle(200, 200, 260, 210))
    frame(fixture, 200, 260, 200, 210)
    refresh(fixture)
    const result = nativeSourceOpeningContacts(fixture)
    const sides = result.openingInspection.targets.filter((target) => target.kind === 'frame-side')
    expect(sides).toHaveLength(2)
    expect(sides.every((side) => side.status === 'matched' && side.coverage === 'complete')).toBe(
      true,
    )
    expect(
      sides.every((side) =>
        side.contacts.every(
          (contact) => contact.ringIndex === 1 && contact.regionSide !== side.frameInteriorSide,
        ),
      ),
    ).toBe(true)
    expectNoPhysicalAuthority(result)
  })

  it('preserves hole correspondence when source commands reverse', () => {
    const fixture = input()
    paint(fixture, 30, rectangle(200, 200, 260, 210))
    frame(fixture, 200, 260, 200, 210)
    for (const path of fixture.work.paths) path.points.reverse()
    refresh(fixture)
    const result = nativeSourceOpeningContacts(fixture)
    expect(result.openingInspection.status).toBe('checked')
    const sides = result.openingInspection.targets.filter((target) => target.kind === 'frame-side')
    expect(sides).toHaveLength(2)
    expect(
      sides.every(
        (side) =>
          side.status === 'matched' &&
          side.contacts.every(
            (contact) => contact.ringIndex === 1 && contact.regionSide !== side.frameInteriorSide,
          ),
      ),
    ).toBe(true)
  })

  it.each(['endpoint', 'extension', 'off-line'] as const)(
    'does not link a %s near the source floor',
    (kind) => {
      const fixture = input()
      if (kind === 'endpoint') frame(fixture, 300, 400)
      // The left jamb's independent host extends to y=109 on the floor's x=100 edge,
      // but the actual logical jamb ends at y=99 and cannot inherit that contact.
      if (kind === 'extension') frame(fixture, 100, 200, 89, 99)
      if (kind === 'off-line') frame(fixture, 120, 220, 89.999999999, 99.999999999)
      const result = nativeSourceOpeningContacts(fixture)
      expect(result.openingInspection.status).toBe('checked')
      expect(selectedSide(result).contacts).toEqual([])
      expect(result.openingInspection.targets.every((target) => target.contacts.length === 0)).toBe(
        true,
      )
      expect(selectedSide(result)).toMatchObject({ status: 'unobserved', coverage: 'unproved' })
    },
  )

  it('does not promote an ambiguous panel end when a floor boundary matches it', () => {
    const fixture = input()
    paint(fixture, 1, rectangle(300, 200, 400, 210))
    paint(fixture, 2, rectangle(295, 195, 305, 215))
    paint(fixture, 3, rectangle(395, 195, 405, 215))
    fixture.work.paths.push({
      operationIndex: 5,
      subpathIndex: 0,
      paint: 'stroke',
      closed: false,
      points: [
        { x: 300, y: 190 },
        { x: 300, y: 220 },
      ],
    })
    refresh(fixture)
    const ends = nativeFilledPanelJambContacts(fixture)
    expect(ends.panels).toHaveLength(1)
    const result = nativeSourceOpeningContacts(fixture)
    const target = result.openingInspection.targets.find(
      (target) => target.kind === 'panel-end' && target.contacts.length > 0,
    )
    expect(target).toMatchObject({
      sourceEndStatus: 'ambiguous',
      status: 'ambiguous',
      coverage: 'complete',
    })
    expectNoPhysicalAuthority(result)
  })

  it.each(['source', 'frame', 'stale', 'truncated'] as const)(
    'holds a %s inventory atomically',
    (kind) => {
      const fixture = input()
      frame(fixture)
      if (kind === 'source') fixture.reviewed.source.sha256 = 'c'.repeat(64)
      if (kind === 'frame') fixture.lineworkSource = { ...fixture.lineworkSource, width: 900 }
      if (kind === 'stale') {
        const point = fixture.work.paths[0]?.points[0]
        if (!point) throw new Error('Missing original source vertex')
        point.x += 0.001
      }
      if (kind === 'truncated') fixture.work.truncated = true
      const result = nativeSourceOpeningContacts(fixture)
      expect(result.openingInspection.status).toBe('held')
      expect(result.openingInspection.targets).toEqual([])
      expectNoPhysicalAuthority(result)
    },
  )

  it('holds out-of-wire target provenance without discarding selected source snapshots', () => {
    const fixture = input()
    frame(fixture, 120, 220, 90, 100, 100_000)
    const result = nativeSourceOpeningContacts(fixture)
    expect(result.refusalReason).toBeNull()
    expect(result.floors).toHaveLength(1)
    expect(result.boundaryInspection.status).toBe('checked')
    expect(result.openingInspection).toMatchObject({ status: 'held', targets: [] })
  })

  it('holds unsupported source precision instead of rounding a target into contact', () => {
    const fixture = input()
    frame(fixture)
    const point = fixture.work.paths.at(-1)?.points[0]
    if (!point) throw new Error('Missing original target vertex')
    point.x = 1e-19
    const result = nativeSourceOpeningContacts(fixture)
    expect(result.openingInspection.status).toBe('held')
    expect(result.openingInspection.targets).toEqual([])
    expectNoPhysicalAuthority(result)
  })

  it('preserves snapshots when the prerequisite inspection exhausts its work budget', () => {
    const fixture = input()
    for (let i = 0; i < 20; i++)
      paint(
        fixture,
        20 + i,
        rectangle(
          200 + (i % 4) * 10,
          200 + Math.floor(i / 4) * 10,
          204 + (i % 4) * 10,
          204 + Math.floor(i / 4) * 10,
        ),
      )
    refresh(fixture)
    fixture.work.skippedCurves = 6000
    fixture.work.skippedCurveBounds = Array.from({ length: 6000 }, (_, index) => ({
      operationIndex: 1000 + index,
      paint: 'stroke',
      bounds: { left: 0, top: 0, right: 1, bottom: 1 },
    }))
    const result = nativeSourceOpeningContacts(fixture)
    expect(result.refusalReason).toBeNull()
    expect(result.floors[0]?.holes).toHaveLength(20)
    expect(result.openingInspection).toMatchObject({
      status: 'held',
      reason: 'source-boundary-inspection-unavailable',
      targets: [],
    })
  })
})
