import type { PlanGeometry, PlanPageContours, PlanWall } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import type { PageClearanceRoute } from './plan-page-clearance-route'
import { inspectPlanPageDoorAccess } from './plan-page-door-access'
import { planPageGeometryElementId } from './plan-page-metric-draft'

const source = { sha256: 'a'.repeat(64), pdfPage: 1, state: 'existing' as const }

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing fixture value')
  return value
}

function fixture() {
  const walls: PlanWall[] = [
    { id: 'left-face', kind: 'inner', start: { xCm: 200, yCm: 0 }, end: { xCm: 200, yCm: 200 } },
    { id: 'right-face', kind: 'inner', start: { xCm: 220, yCm: 200 }, end: { xCm: 220, yCm: 0 } },
  ]
  const rooms: PlanGeometry['rooms'] = [
    {
      name: 'Прихожая и коридор',
      sourceNumbers: [5, 1],
      polygon: [
        { xCm: 0, yCm: 0 },
        { xCm: 200, yCm: 0 },
        { xCm: 200, yCm: 200 },
        { xCm: 0, yCm: 200 },
      ],
    },
    {
      name: 'Кухня',
      sourceNumber: 2,
      polygon: [
        { xCm: 220, yCm: 0 },
        { xCm: 420, yCm: 0 },
        { xCm: 420, yCm: 200 },
        { xCm: 220, yCm: 200 },
      ],
    },
  ]
  const openings: PlanGeometry['openings'] = [
    {
      id: planPageGeometryElementId(source, '1+5', 'opening', 'hall-door'),
      type: 'door',
      wallId: 'left-face',
      offsetCm: 60,
      widthCm: 80,
    },
    {
      id: planPageGeometryElementId(source, '2', 'opening', 'kitchen-door'),
      type: 'door',
      wallId: 'right-face',
      offsetCm: 60,
      widthCm: 80,
    },
  ]
  const geometry: Pick<PlanGeometry, 'walls' | 'openings' | 'rooms' | 'pdfCalibration'> = {
    walls,
    rooms,
    openings,
    pdfCalibration: {
      sourceSha256: 'a'.repeat(64),
      pdfPage: 1,
      cmPerPoint: 1,
      origin: { x: 0, y: 0 },
      anchorRoomNumbers: [2],
      labelIndexes: [],
      derivedOpeningIds: openings.map((opening) => opening.id),
      wallFaceRoomPolygons: structuredClone(rooms.map((room) => room.polygon)),
      openingFacePairs: [
        {
          bindings: [
            {
              opening: structuredClone(required(openings[0])),
              wall: structuredClone(required(walls[0])),
            },
            {
              opening: structuredClone(required(openings[1])),
              wall: structuredClone(required(walls[1])),
            },
          ],
          jambs: [
            { operationIndex: 1, subpathIndex: 0, segmentIndex: 0 },
            { operationIndex: 2, subpathIndex: 0, segmentIndex: 0 },
          ],
        },
      ],
    },
  }
  const contours: PlanPageContours = {
    source: { sha256: 'a'.repeat(64), pdfPage: 1, state: 'existing' },
    coordinateSystem: 'page-0-1000',
    review: 'manual-source-review',
    pageWidth: 1000,
    pageHeight: 1000,
    rooms: [1, 0].map((index) => ({
      ...(index === 0 ? { roomSourceNumbers: [1, 5] } : { roomSourceNumber: 2 }),
      polygon: required(rooms[index]).polygon.map(({ xCm, yCm }) => ({ x: xCm, y: yCm })),
      openings: [
        {
          id: index === 0 ? 'hall-door' : 'kitchen-door',
          kind: 'door',
          wallEdgeIndex: index === 0 ? 1 : 3,
          start: { x: index === 0 ? 200 : 220, y: 60 },
          end: { x: index === 0 ? 200 : 220, y: 140 },
        },
      ],
    })),
  }
  const routes: PageClearanceRoute[] = [
    {
      contourKey: '1+5',
      widthCm: 70,
      status: 'constructive-route',
      doorIds: ['hall-door'],
      reachedDoorIds: ['hall-door'],
      checkedNodes: 1,
    },
    {
      contourKey: '2',
      widthCm: 70,
      status: 'entry-clearance',
      doorIds: ['kitchen-door'],
      reachedDoorIds: ['kitchen-door'],
      checkedNodes: 1,
    },
  ]
  return { geometry, contours, routes }
}

describe('both sides of source-backed door adjacency', () => {
  it('matches reordered contours and compound room identities', () => {
    const { geometry, contours, routes } = fixture()
    expect(inspectPlanPageDoorAccess(geometry, contours, routes)).toEqual([
      {
        roomIndexes: [0, 1],
        openingIds: geometry.openings.map((opening) => opening.id),
        status: 'both-entry-clear',
        sides: [
          {
            roomIndex: 0,
            openingId: required(geometry.openings[0]).id,
            sourceOpeningId: 'hall-door',
            contourKey: '1+5',
            widthCm: 70,
            status: 'constructive-route',
          },
          {
            roomIndex: 1,
            openingId: required(geometry.openings[1]).id,
            sourceOpeningId: 'kitchen-door',
            contourKey: '2',
            widthCm: 70,
            status: 'entry-clearance',
          },
        ],
      },
    ])
  })

  it('keeps the blocked side and its reason unresolved', () => {
    const { geometry, contours, routes } = fixture()
    routes[1] = {
      ...required(routes[1]),
      status: 'unresolved',
      reason: 'entry-footprint',
      reachedDoorIds: [],
    }
    expect(inspectPlanPageDoorAccess(geometry, contours, routes)[0]).toMatchObject({
      status: 'unresolved',
      sides: [
        { status: 'constructive-route' },
        { status: 'unresolved', reason: 'entry-footprint' },
      ],
    })
  })

  it.each(['missing', 'duplicate'] as const)('rejects a %s clearance result', (mode) => {
    const { geometry, contours, routes } = fixture()
    if (mode === 'missing') routes.pop()
    else routes.push(structuredClone(required(routes[1])))
    expect(inspectPlanPageDoorAccess(geometry, contours, routes)[0]?.sides[1]).toMatchObject({
      status: 'unresolved',
      reason: 'clearance-result',
    })
  })

  it('requires that the specific opening was reached', () => {
    const { geometry, contours, routes } = fixture()
    required(routes[1]).reachedDoorIds = ['another-door']
    expect(inspectPlanPageDoorAccess(geometry, contours, routes)[0]?.sides[1]).toMatchObject({
      status: 'unresolved',
      reason: 'opening-not-reached',
    })
  })

  it.each(['missing', 'duplicate', 'other-room', 'window'] as const)(
    'rejects %s opening ownership',
    (mode) => {
      const { geometry, contours, routes } = fixture()
      const first = required(contours.rooms[0])
      const opening = required(first.openings?.[0])
      if (mode === 'missing') first.openings = []
      if (mode === 'duplicate') required(first.openings).push(structuredClone(opening))
      if (mode === 'other-room')
        required(required(contours.rooms[1]).openings).push(structuredClone(opening))
      if (mode === 'window') opening.kind = 'window'
      expect(inspectPlanPageDoorAccess(geometry, contours, routes)[0]?.sides[1]).toMatchObject({
        status: 'unresolved',
        reason: 'opening-owner',
      })
    },
  )

  it('rejects missing or duplicate contour identities', () => {
    const { geometry, contours, routes } = fixture()
    contours.rooms.push(structuredClone(required(contours.rooms[0])))
    expect(inspectPlanPageDoorAccess(geometry, contours, routes)[0]?.sides[1]).toMatchObject({
      reason: 'contour-owner',
    })
    contours.rooms = contours.rooms.filter((room) => room.roomSourceNumber !== 2)
    expect(inspectPlanPageDoorAccess(geometry, contours, routes)[0]?.sides[1]).toMatchObject({
      reason: 'contour-owner',
    })
  })

  it('does not reuse a link after the source-bound opening changes', () => {
    const { geometry, contours, routes } = fixture()
    required(geometry.openings[1]).widthCm += 1
    expect(inspectPlanPageDoorAccess(geometry, contours, routes)).toEqual([])
  })

  it('does not accept an unbound plain source id as a metric opening id', () => {
    const { geometry, contours, routes } = fixture()
    required(geometry.openings[1]).id = 'kitchen-door'
    const pair = required(geometry.pdfCalibration?.openingFacePairs?.[0])
    pair.bindings[1].opening.id = 'kitchen-door'
    expect(inspectPlanPageDoorAccess(geometry, contours, routes)[0]?.sides[1]).toMatchObject({
      status: 'unresolved',
      reason: 'opening-owner',
    })
  })

  it.each(['hash', 'page', 'state'] as const)('rejects a mismatched source %s', (field) => {
    const { geometry, contours, routes } = fixture()
    if (field === 'hash') contours.source.sha256 = 'b'.repeat(64)
    if (field === 'page') contours.source.pdfPage = 2
    if (field === 'state') contours.source.state = 'proposed'
    expect(inspectPlanPageDoorAccess(geometry, contours, routes)[0]).toMatchObject({
      status: 'unresolved',
      sides: [{ reason: 'source-mismatch' }, { reason: 'source-mismatch' }],
    })
  })

  it('requires the same checked width on both sides', () => {
    const { geometry, contours, routes } = fixture()
    required(routes[1]).widthCm = 60
    expect(inspectPlanPageDoorAccess(geometry, contours, routes)[0]).toMatchObject({
      status: 'unresolved',
      sides: [{ reason: 'clearance-width' }, { reason: 'clearance-width' }],
    })
  })
})
