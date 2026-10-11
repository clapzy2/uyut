import { verticalReferenceReviewKey } from '@uyut/catalog/plan-vertical-floor-geometry'
import type { PlanGeometry, PlanWallFacePair } from '@uyut/db'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import PlanDeliveryVolume from '@/components/plan-delivery-volume'
import {
  deliveryBoxFaces,
  deliveryVolumeScene,
  projectDeliveryVolume,
} from './plan-delivery-volume'
import {
  type FurnitureDeliveryResult,
  inspectFurnitureDeliveryViaStairs,
} from './plan-furniture-delivery'
import type { FurnitureDeliveryReportRequest } from './plan-furniture-delivery-report'
import { furnitureStairGeometryKey } from './plan-furniture-stair-transfer'
import { applyPlanVerticalReference } from './plan-vertical-reference'
import { volumeProjector } from './plan-volume-camera'

const box = (left: number, top: number, right: number, bottom: number) => [
  { xCm: left, yCm: top },
  { xCm: right, yCm: top },
  { xCm: right, yCm: bottom },
  { xCm: left, yCm: bottom },
]

function fixture() {
  const rooms = [
    { name: 'Lower', polygon: box(0, 0, 200, 200) },
    { name: 'Upper', polygon: box(400, 0, 600, 200) },
  ]
  const raw: PlanGeometry = {
    version: 1,
    status: 'confirmed',
    widthCm: 600,
    heightCm: 200,
    walls: [],
    openings: [],
    rooms,
    warnings: [],
    footprint: box(0, 0, 600, 200),
    voids: [{ id: 'void', polygon: box(30, 30, 50, 50) }],
  }
  const accepted = applyPlanVerticalReference(
    raw,
    {
      version: 1,
      id: 'reference',
      kind: 'finished-floor',
      zeroFloorId: 'lower',
      acknowledged: true,
      floors: rooms.map((room, index) => ({
        id: index ? 'upper' : 'lower',
        room,
        surface: 'finished-floor',
        elevationCm: index ? 100 : 0,
      })),
      ceilings: [
        { id: 'lower-ceiling', floorId: 'lower', elevationCm: 300 },
        { id: 'upper-ceiling', floorId: 'upper', elevationCm: 400 },
      ],
      wallBases: [],
      thresholds: [],
      source: {
        kind: 'site-measurement',
        reference: 'Synthetic rendering fixture, not a checked physical delivery',
      },
    },
    'test',
    '2026-10-11T12:00:00.000Z',
  )
  if (!accepted.ok) throw new Error(accepted.error)
  const geometry = accepted.geometry
  if (!geometry.verticalReference) throw new Error('Missing signed reference')
  const request: FurnitureDeliveryReportRequest = {
    survey: {
      version: 1,
      referenceKey: verticalReferenceReviewKey(geometry.verticalReference),
      geometryKey: furnitureStairGeometryKey(geometry),
      source: { kind: 'site-measurement', reference: 'Rendering only' },
      lowerFloorId: 'lower',
      upperFloorId: 'upper',
      direction: 'x',
      startCm: 0,
      crossStartCm: 0,
      widthCm: 200,
      lowerLandingLengthCm: 200,
      upperLandingLengthCm: 200,
      lowerLandingCeilingCm: 300,
      upperLandingCeilingCm: 400,
      treads: [{ runCm: 200, elevationCm: 50, ceilingElevationCm: 350 }],
      travelDirection: 'up',
      carryClearanceCm: 0,
      tilt: 'none',
      acknowledged: true,
    },
    profile: { widthCm: 20, depthCm: 20, heightCm: 40, clearanceCm: 1, orientation: 0 },
    targetRoomId: '1',
  }
  const from = { xCm: 220, yCm: 100, zCm: 51 }
  const to = { xCm: 380, yCm: 100, zCm: 51 }
  const result: FurnitureDeliveryResult = {
    points: [from, to],
    targetRoomId: '1',
    checkedNodes: 3,
    segments: {
      entry: [{ xCm: 100, yCm: 100, zCm: 0 }, from],
      stairs: [from, to],
      exit: [to, { xCm: 450, yCm: 100, zCm: 100 }],
    },
    stairs: {
      referenceId: 'reference',
      travelDirection: 'up',
      tilt: 'none',
      angleDeg: 0,
      carried: { widthCm: 20, depthCm: 20, heightCm: 40 },
      sweepHeightCm: 40,
      points: [from, to],
      regions: [
        {
          kind: 'tread',
          index: 0,
          polygon: box(200, 0, 400, 200),
          elevationCm: 50,
          ceilingElevationCm: 350,
        },
      ],
      stages: [
        {
          kind: 'translate',
          from,
          to,
          bounds: {
            leftCm: 209,
            topCm: 89,
            rightCm: 391,
            bottomCm: 111,
            bottomElevationCm: 51,
            topElevationCm: 91,
          },
        },
      ],
    },
  }
  return { geometry, request, result }
}

describe('measured delivery volume scene', () => {
  it('renders a fresh complete result from the real delivery checker, not an imported certificate', () => {
    const { geometry: original, request } = fixture()
    const geometry = structuredClone(original)
    delete geometry.verticalReference
    delete geometry.voids
    geometry.walls = [
      { id: 'inner', kind: 'outer', start: { xCm: 0, yCm: 0 }, end: { xCm: 200, yCm: 0 } },
      { id: 'outer', kind: 'outer', start: { xCm: 0, yCm: -20 }, end: { xCm: 200, yCm: -20 } },
    ]
    const door: PlanGeometry['openings'][number] = {
      id: 'door',
      wallId: 'inner',
      type: 'door',
      offsetCm: 50,
      widthCm: 100,
      bottomCm: 0,
      heightCm: 220,
      clearance: { side: 'left', depthCm: 150, shape: 'rectangle' },
    }
    geometry.openings = [door]
    geometry.routeStartOpeningId = 'door'
    const wall = geometry.walls[0]
    if (!wall) throw new Error('Missing door wall')
    geometry.pdfCalibration = {
      sourceSha256: 'b'.repeat(64),
      pdfPage: 1,
      cmPerPoint: 1,
      origin: { x: 0, y: 0 },
      anchorRoomNumbers: [],
      labelIndexes: [],
      derivedOpeningIds: [],
      wallFaceRoomPolygons: geometry.rooms.map((room) => room.polygon),
      sourceWallFacePairs: [
        {
          faces: geometry.walls.map((face, index) => ({
            wall: face,
            start: face.start,
            end: face.end,
            nativeSegment: { operationIndex: 1, subpathIndex: 0, segmentIndex: index },
          })) as PlanWallFacePair['faces'],
          openings: [door],
        },
      ],
      openingWidthProofs: [
        {
          opening: door,
          wall,
          cut: [
            { xCm: 50, yCm: 0 },
            { xCm: 150, yCm: 0 },
          ],
          labelIndex: 0,
        },
      ],
    }
    const accepted = applyPlanVerticalReference(
      geometry,
      {
        version: 1,
        id: 'reference',
        kind: 'finished-floor',
        zeroFloorId: 'lower',
        acknowledged: true,
        floors: geometry.rooms.map((room, index) => ({
          id: index ? 'upper' : 'lower',
          room,
          surface: 'finished-floor',
          elevationCm: index ? 100 : 0,
        })),
        ceilings: [
          { id: 'lower-ceiling', floorId: 'lower', elevationCm: 300 },
          { id: 'upper-ceiling', floorId: 'upper', elevationCm: 400 },
        ],
        wallBases: geometry.walls.map((item) => ({ wall: item, floorId: 'lower' })),
        thresholds: [],
        source: { kind: 'site-measurement', reference: 'Synthetic rendering integration' },
      },
      'test',
      '2026-10-11T12:00:00.000Z',
    )
    if (!accepted.ok || !accepted.geometry.verticalReference)
      throw new Error('Invalid integration reference')
    request.survey = {
      ...(request.survey as object),
      geometryKey: furnitureStairGeometryKey(accepted.geometry),
      referenceKey: verticalReferenceReviewKey(accepted.geometry.verticalReference),
    }
    const fresh = inspectFurnitureDeliveryViaStairs(
      accepted.geometry,
      request.survey,
      request.profile,
      request.targetRoomId,
    )
    expect(fresh.error).toBeUndefined()
    if (!fresh.result) throw new Error(fresh.error)
    const html = renderToStaticMarkup(
      createElement(PlanDeliveryVolume, {
        geometry: accepted.geometry,
        request,
        result: fresh.result,
      }),
    )
    expect(html).toContain('Маршрут заноса в 3D')
    expect(html).toContain('<polyline')
    expect(html).not.toContain('недоступен')
  })
  it('keeps room floor levels, holes, measured steps and complete absolute route', () => {
    const { geometry, request, result } = fixture()
    const scene = deliveryVolumeScene(geometry, request, result)
    expect(scene?.surfaces.find((surface) => surface.title === 'Lower')?.rings).toHaveLength(2)
    expect(scene?.surfaces.find((surface) => surface.title === 'Upper')?.rings[0]?.[0]?.zCm).toBe(
      100,
    )
    expect(scene?.surfaces.find((surface) => surface.kind === 'stair')?.rings[0]?.[0]?.zCm).toBe(50)
    expect(scene?.routes.find((route) => route.id === 'exit')?.points.at(-1)?.zCm).toBe(100)
    expect(scene?.stages[0]?.bounds).toEqual(result.stairs.stages[0]?.bounds)
  })
  it('projects recorded checked bounds directly, not a guessed tilted pose', () => {
    const { geometry, request, result } = fixture()
    const scene = deliveryVolumeScene(geometry, request, result)
    if (!scene) throw new Error('No scene')
    const bounds = result.stairs.stages[0]?.bounds
    if (!bounds) throw new Error('No stage')
    const projector = volumeProjector(90, 35)
    const drawing = projectDeliveryVolume(scene, 0, 90, 35, 1)
    expect(drawing.sweep).toEqual(
      deliveryBoxFaces(bounds).map((face) => face.map((point) => projector(point, point.zCm))),
    )
    expect(drawing.viewBox.split(' ').map(Number).every(Number.isFinite)).toBe(true)
    expect(
      deliveryBoxFaces(bounds)
        .flat()
        .map((point) => point.zCm),
    ).toEqual(expect.arrayContaining([51, 91]))
  })
  it('fits negative exterior positions and measured ceilings without recentering when the stage changes', () => {
    const { geometry, request, result } = fixture()
    const scene = deliveryVolumeScene(geometry, request, result)
    if (!scene?.stages[0]) throw new Error('No scene')
    scene.routes.push({ id: 'exterior', points: [{ xCm: -300, yCm: -200, zCm: -50 }] })
    scene.stages.push({
      ...scene.stages[0],
      bounds: { ...scene.stages[0].bounds, topElevationCm: 110 },
    })
    const first = projectDeliveryVolume(scene, 0, 0, 35, 1)
    const second = projectDeliveryVolume(scene, 1, 0, 35, 1)
    expect(first.viewBox).toBe(second.viewBox)
    const [x = 0, y = 0, width = 0, height = 0] = first.viewBox.split(' ').map(Number)
    const projector = volumeProjector(0, 35)
    for (const point of [
      ...scene.routes.flatMap((route) => route.points),
      ...scene.ceilingPoints,
    ]) {
      const projected = projector(point, point.zCm)
      expect(projected.x).toBeGreaterThanOrEqual(x)
      expect(projected.x).toBeLessThanOrEqual(x + width)
      expect(projected.y).toBeGreaterThanOrEqual(y)
      expect(projected.y).toBeLessThanOrEqual(y + height)
    }
  })
  it.each([
    'unknown-floor',
    'stale-survey',
    'bad-point',
    'bad-bounds',
    'wrong-reference',
    'missing-stages',
  ])('holds %s without a zero fallback', (mutation) => {
    const { geometry, request, result } = fixture()
    if (mutation === 'unknown-floor') delete geometry.verticalReference
    if (mutation === 'stale-survey')
      request.survey = { ...(request.survey as object), geometryKey: 'stale' }
    if (mutation === 'bad-point') result.points[0] = { xCm: Number.NaN, yCm: 0, zCm: 0 }
    if (mutation === 'bad-bounds') {
      const stage = result.stairs.stages[0]
      if (stage) stage.bounds.topElevationCm = Number.POSITIVE_INFINITY
    }
    if (mutation === 'wrong-reference') result.stairs.referenceId = 'other'
    if (mutation === 'missing-stages') result.stairs.stages = []
    expect(deliveryVolumeScene(geometry, request, result)).toBeNull()
  })
  it('does not draw an unchecked exterior segment or invent an exterior floor', () => {
    const { geometry, request, result } = fixture()
    result.segments.exterior = [{ xCm: -100, yCm: -100, zCm: -10 }]
    expect(
      deliveryVolumeScene(geometry, request, result)?.routes.map((route) => route.id),
    ).not.toContain('exterior')
    expect(
      deliveryVolumeScene(geometry, request, result)?.surfaces.some(
        (surface) => surface.kind === 'exterior',
      ),
    ).toBe(false)
    result.exteriorChecked = true
    expect(deliveryVolumeScene(geometry, request, result)).toBeNull()
  })
})
