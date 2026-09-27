import { type LayoutItem, layoutRoom, WALKWAY_CM } from '@uyut/catalog'
import {
  rectBlocksFloorReservation,
  rectInsideFloor,
  rectOverlapsPolygon,
} from '@uyut/catalog/layout'
import type { PlanGeometry, PlanPageContours, PlanReading, RoomKind } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import nativeLabels from '../../../../docs/qa/fixtures/apartment-74-77-native-labels.json'
import dimensions from '../../../../docs/qa/fixtures/apartment-74-77-page-contours.json'
import features from '../../../../docs/qa/fixtures/apartment-74-77-page-features.json'
import { inspectManualPlanCompleteness } from './plan-geometry-inspection'
import { planPageMetricDraft } from './plan-page-metric-draft'
import type { PdfLinework, PdfVectorPath } from './plan-pdf-linework'
import { roomLayoutInputFromGeometry } from './room-geometry-layout'

const roomKinds = ['living', 'bedroom', 'kid', 'kitchen'] as const
const names: Record<(typeof roomKinds)[number], string> = {
  living: 'Контрольная гостиная',
  bedroom: 'Контрольная спальня',
  kid: 'Контрольная детская',
  kitchen: 'Контрольная кухня',
}
function requiredFixture<T>(value: T | undefined): T {
  if (!value) throw new Error('Missing original room 4 fixture')
  return value
}
const bedroom = requiredFixture(dimensions.rooms.find((room) => room.roomSourceNumber === 4))
const nativeRoom = requiredFixture(features.rooms.find((room) => room.roomSourceNumber === 4))
const door = requiredFixture(nativeRoom.openings[0])

const textItems = Array.from({ length: nativeLabels.originalTextItemCount }, () => ({
  text: '',
  x: 0,
  y: 0,
  rotation: 0,
}))
for (const { index, ...item } of nativeLabels.items) textItems[index] = item
for (const { index, ...item } of features.labels) textItems[index] = item

// The room and printed dimensions are original. This interior column and the room-kind
// variants are deliberately synthetic: they test propagation, not apartment recognition.
const column = [
  { x: 750, y: 180 },
  { x: 775, y: 180 },
  { x: 775, y: 200 },
  { x: 750, y: 200 },
]
const source = {
  sha256: features.source.sha256,
  pdfPage: features.source.pdfPage,
  state: 'existing' as const,
}

function scenario(kind: (typeof roomKinds)[number], obstacle = column, includeWindow = false) {
  const contours: PlanPageContours = {
    source,
    coordinateSystem: 'page-0-1000',
    review: 'manual-source-review',
    pageWidth: features.pageWidth,
    pageHeight: features.pageHeight,
    rooms: [
      {
        roomSourceNumber: 4,
        polygon: nativeRoom.polygon,
        openings: [
          {
            id: door.id,
            kind: 'door',
            wallEdgeIndex: door.wallEdgeIndex,
            start: door.start,
            end: door.end,
          },
          ...(includeWindow
            ? [
                {
                  id: 'original-room-4-window',
                  kind: 'window' as const,
                  wallEdgeIndex: 0,
                  start: { x: 706.752, y: 82.328 },
                  end: { x: 797.246, y: 82.328 },
                },
              ]
            : []),
        ],
        obstacles: [{ id: 'controlled-column', kind: 'column', polygon: obstacle }],
      },
    ],
  }
  const linework: PdfLinework = {
    coordinateSystem: 'page-0-1000',
    pageWidth: features.pageWidth,
    pageHeight: features.pageHeight,
    paths: [
      ...new Map(
        [
          ...dimensions.dimensionPaths,
          ...features.wallPaths,
          ...features.dimensionPaths,
          {
            operationIndex: 10000,
            subpathIndex: 0,
            closed: true,
            paint: 'stroke',
            points: obstacle,
          },
        ].map((path) => [`${path.operationIndex}:${path.subpathIndex}`, path]),
      ).values(),
    ] as PdfVectorPath[],
    skippedCurves: 0,
    unsupportedContexts: 0,
    unsupportedPaths: 0,
    clippedPaths: 0,
    truncated: false,
  }
  const reading: PlanReading = {
    planState: 'existing',
    sourcePage: source.pdfPage,
    readAt: '2026-09-27T18:00:00.000Z',
    rooms: [
      {
        name: names[kind],
        kind,
        sourceNumber: 4,
        widthCm: bedroom.widthMm / 10,
        depthCm: bedroom.depthMm / 10,
        measurementEvidence: {
          width: {
            kind: 'horizontal-chain',
            scope: 'room',
            sourceNumber: 4,
            complete: true,
            segmentsMm: bedroom.widthLabels.map((index) => Number(textItems[index]?.text)),
            textItemIndexes: bedroom.widthLabels,
          },
          depth: {
            kind: 'vertical-chain',
            scope: 'room',
            sourceNumber: 4,
            complete: true,
            segmentsMm: bedroom.depthLabels.map((index) => Number(textItems[index]?.text)),
            textItemIndexes: bedroom.depthLabels,
          },
        },
      },
    ],
  }
  const context = { source, linework, planText: JSON.stringify(textItems), contours }
  const result = planPageMetricDraft(reading, context, [4])
  if (!result.ok) throw new Error(result.error)
  return result.geometry
}

function confirmed(geometry: PlanGeometry, withDoorClearance = true): PlanGeometry {
  // Controlled adapter input only. The actual save/confirm action must still enforce
  // completeness, wall classification and the owner's separate confirmation.
  const result = structuredClone(geometry)
  result.status = 'confirmed'
  result.confirmedAt = '2026-09-27T18:05:00.000Z'
  if (withDoorClearance) {
    for (const opening of result.openings) {
      if (opening.type === 'door') {
        opening.clearance = { side: 'left', depthCm: 90, shape: 'rectangle' }
      }
    }
  }
  return result
}

function roomInput(geometry: PlanGeometry, kind: (typeof roomKinds)[number]) {
  const input = roomLayoutInputFromGeometry(geometry, names[kind], null)
  if (!input?.floorPolygon) throw new Error('Confirmed native room was not passed to layout')
  return { ...input, floorPolygon: input.floorPolygon, roomKind: kind, roomName: names[kind] }
}

function furniture(kind: RoomKind): LayoutItem {
  if (kind === 'living') {
    return {
      id: 'sofa',
      title: 'Контрольный диван',
      category: 'sofa',
      dimensions: { width: 110, depth: 65, height: 80 },
      operationClearance: { front: 70 },
      quantity: 1,
    }
  }
  if (kind === 'kitchen') {
    return {
      id: 'kitchen-run',
      title: 'Контрольный кухонный гарнитур',
      category: 'storage',
      dimensions: { width: 120, depth: 60, height: 90 },
      operationClearance: { front: 90 },
      quantity: 1,
    }
  }
  return {
    id: 'bed',
    title: kind === 'kid' ? 'Контрольная детская кровать' : 'Контрольная кровать',
    category: 'bed',
    dimensions: { width: 90, depth: 200, height: 75 },
    operationClearance: { side: 35 },
    quantity: 1,
  }
}

describe('native page → metric draft → room layout safety', () => {
  it('requires wall classification before the imported draft can pass manual confirmation', () => {
    const draft = scenario('bedroom')
    expect(draft.source).toBe('manual')
    expect(draft.walls.every((wall) => wall.kind === 'inner')).toBe(true)
    expect(inspectManualPlanCompleteness(draft)).toContainEqual(
      expect.objectContaining({ id: 'manual-missing-outer-walls', severity: 'error' }),
    )
  })
  it.each(roomKinds)('keeps the %s draft out of confirmed furniture placement', (kind) => {
    const draft = scenario(kind)
    expect(draft.status).toBe('draft')
    expect(draft).not.toHaveProperty('confirmedAt')
    expect(roomLayoutInputFromGeometry(draft, names[kind], null)).toBeNull()
    expect(draft.openings[0]).not.toHaveProperty('clearance')
    expect(draft.openings[0]).not.toHaveProperty('sillHeightCm')
  })

  it.each(roomKinds)('reserves the native door and controlled column for %s furniture', (kind) => {
    const input = roomInput(confirmed(scenario(kind)), kind)
    expect(input.widthCm).toBeCloseTo(298.5, 0)
    expect(input.depthCm).toBeCloseTo(515.6, 0)
    expect(input.floorReservations).toHaveLength(1)
    const entry = requiredFixture(input.floorReservations[0])
    expect(
      Math.hypot(entry.end.xCm - entry.start.xCm, entry.end.yCm - entry.start.yCm),
    ).toBeCloseTo(89.6, 1)
    expect(input.keepClearZones.map((zone) => zone.kind).sort()).toEqual(['door', 'obstacle'])
    const layout = layoutRoom(input, [furniture(kind)])
    expect(layout.placed).toHaveLength(1)
    for (const placement of layout.placed) {
      expect(rectInsideFloor(placement, input.floorPolygon)).toBe(true)
      for (const reservation of input.floorReservations) {
        expect(rectBlocksFloorReservation(placement, reservation)).toBe(false)
      }
      for (const zone of input.keepClearZones) {
        expect(rectOverlapsPolygon(placement, zone.polygon)).toBe(false)
      }
    }
  })

  it.each(roomKinds)('rejects fixed %s furniture inside the preserved column', (kind) => {
    const input = roomInput(confirmed(scenario(kind)), kind)
    const zone = input.keepClearZones.find((item) => item.kind === 'obstacle')
    if (!zone) throw new Error('Missing native obstacle')
    const xCm = Math.max(0, Math.min(...zone.polygon.map((point) => point.xCm)) - 40)
    const yCm = Math.min(...zone.polygon.map((point) => point.yCm))
    const layout = layoutRoom(input, [
      { ...furniture(kind), placement: { xCm, yCm, rotation: 0, frontDirection: 'up' } },
    ])
    expect(layout.placed).toEqual([])
    expect(layout.problems).toContainEqual(
      expect.objectContaining({ kind: 'invalidPlacement', reason: 'blocked' }),
    )
    expect(layout.safetySummary.status).toBe('blocked')
  })

  it.each(roomKinds)('keeps unknown opening clearance visible after %s confirmation', (kind) => {
    const input = roomInput(confirmed(scenario(kind), false), kind)
    expect(input.floorReservations).toHaveLength(1)
    expect(input.missingSafetyData.join(' ')).toContain('зону открывания')
    const layout = layoutRoom(input, [furniture(kind)])
    expect(layout.safetySummary.status).not.toBe('checked')
  })

  it.each(roomKinds)('does not call the %s room accessible when the entry is blocked', (kind) => {
    const blockedEntry = [
      { x: 643.528, y: 285 },
      { x: 725, y: 285 },
      { x: 725, y: 327.76 },
      { x: 643.528, y: 327.76 },
    ]
    const input = roomInput(confirmed(scenario(kind, blockedEntry)), kind)
    const layout = layoutRoom(input, [])
    expect(layout.walkwayCm).toBeLessThan(WALKWAY_CM)
    expect(layout.safetySummary.status).toBe('blocked')
  })

  it('preserves the printed window width but does not invent its sill or approve furniture below it', () => {
    const geometry = confirmed(scenario('living', column, true))
    const window = geometry.openings.find((opening) => opening.type === 'window')
    expect(window?.widthCm).toBeCloseTo(134.4, 1)
    expect(window).not.toHaveProperty('sillHeightCm')
    const input = roomInput(geometry, 'living')
    expect(input.missingSafetyData.join(' ')).toContain('высоту подоконника')
    const reservation = input.floorReservations.find((opening) => opening.kind === 'window')
    if (!reservation) throw new Error('Printed window was not passed to layout')
    const layout = layoutRoom(input, [
      {
        id: 'window-cabinet',
        title: 'Контрольная тумба под окном',
        category: 'storage',
        subcategory: 'cabinet',
        dimensions: { width: 60, depth: 40, height: 60 },
        operationClearance: { front: 45 },
        placement: {
          xCm: Math.min(reservation.start.xCm, reservation.end.xCm),
          yCm: 0,
          rotation: 0,
          frontDirection: 'down',
        },
        quantity: 1,
      },
    ])
    expect(layout.placed).toEqual([])
    expect(layout.safetySummary.status).not.toBe('checked')
  })
})
