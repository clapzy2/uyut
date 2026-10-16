import type { PlanPageContours, PlanReading } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import {
  contourDraftsFromSaved,
  pageContourRoomsForSave,
  pageExteriorForSave,
  pageFloorForSave,
} from '@/components/plan-page-contour-editor-model'
import nativeLabels from '../../../../docs/qa/fixtures/apartment-74-77-native-labels.json'
import archive from '../../../../docs/qa/fixtures/apartment-74-77-page-contours.json'
import features from '../../../../docs/qa/fixtures/apartment-74-77-page-features.json'
import { planPageMetricDraft } from './plan-page-metric-draft'
import type { PagePoint, PdfLinework, PdfVectorPath } from './plan-pdf-linework'
import { nativePageSegments } from './plan-pdf-opening-endpoint'
import { planVolume } from './plan-volume'
import { roomLayoutInputFromGeometry } from './room-geometry-layout'

function synthetic() {
  const source = { sha256: 'a'.repeat(64), pdfPage: 6, state: 'existing' as const }
  const polygon = [
    { x: 10, y: 10 },
    { x: 310, y: 10 },
    { x: 310, y: 410 },
    { x: 10, y: 410 },
  ]
  const contours: PlanPageContours = {
    source: { ...source },
    coordinateSystem: 'page-0-1000',
    review: 'manual-source-review',
    pageWidth: 1000,
    pageHeight: 1000,
    rooms: [
      {
        roomSourceNumber: 4,
        polygon,
        openings: [
          {
            id: 'door',
            kind: 'door',
            wallEdgeIndex: 2,
            start: { x: 100, y: 410 },
            end: { x: 190, y: 410 },
          },
        ],
      },
    ],
  }
  let operation = 0
  const path = (
    points: PagePoint[],
    closed = false,
    paint: PdfVectorPath['paint'] = 'stroke',
  ): PdfVectorPath => ({ operationIndex: operation++, subpathIndex: 0, points, closed, paint })
  const dimension = (start: PagePoint, end: PagePoint, vertical = false) => {
    const move = (point: PagePoint, along: number, across = 0) =>
      vertical
        ? { x: point.x + across, y: point.y + along }
        : { x: point.x + along, y: point.y + across }
    return [
      path([move(start, 4), move(end, -4)]),
      path([start, move(start, 4, -0.5), move(start, 4, 0.5)], true, 'fill'),
      path([end, move(end, -4, -0.5), move(end, -4, 0.5)], true, 'fill'),
    ]
  }
  const work: PdfLinework = {
    coordinateSystem: 'page-0-1000',
    pageWidth: 1000,
    pageHeight: 1000,
    paths: [
      path(polygon, true),
      path([
        { x: 100, y: 410 },
        { x: 190, y: 410 },
      ]),
      ...dimension({ x: 10, y: 40 }, { x: 310, y: 40 }),
      ...dimension({ x: 280, y: 10 }, { x: 280, y: 410 }, true),
      ...dimension({ x: 100, y: 390 }, { x: 190, y: 390 }),
    ],
    skippedCurves: 0,
    unsupportedPaths: 0,
    unsupportedContexts: 0,
    clippedPaths: 0,
    truncated: false,
  }
  const labels = [
    { text: '3000', x: 150, y: 38, rotation: 0 },
    { text: '4000', x: 278, y: 200, rotation: 90 },
    { text: '900', x: 140, y: 388, rotation: 0 },
  ]
  const reading: PlanReading = {
    readAt: '2026-09-27',
    sourcePage: 6,
    planState: 'existing',
    rooms: [
      {
        name: 'Спальня',
        sourceNumber: 4,
        kind: 'bedroom',
        widthCm: 300,
        depthCm: 400,
        measurementEvidence: {
          width: {
            kind: 'horizontal-chain',
            scope: 'room',
            sourceNumber: 4,
            complete: true,
            segmentsMm: [3000],
            textItemIndexes: [0],
          },
          depth: {
            kind: 'vertical-chain',
            scope: 'room',
            sourceNumber: 4,
            complete: true,
            segmentsMm: [4000],
            textItemIndexes: [1],
          },
        },
      },
    ],
  }
  return {
    reading,
    context: { source, linework: work, planText: JSON.stringify(labels), contours },
    labels,
    path,
    dimension,
  }
}

function realSheet() {
  const source = { ...archive.source, state: 'existing' as const }
  const contours: PlanPageContours = {
    source,
    coordinateSystem: 'page-0-1000',
    review: 'manual-source-review',
    pageWidth: archive.pageWidth,
    pageHeight: archive.pageHeight,
    rooms: archive.rooms
      .filter((room) => room.roomSourceNumber !== 6)
      .map((room) => ({
        roomSourceNumber: room.roomSourceNumber,
        polygon: room.polygon,
        openings: features.rooms
          .find((feature) => feature.roomSourceNumber === room.roomSourceNumber)
          ?.openings.map(({ id, wallEdgeIndex, start, end }) => ({
            id,
            kind: 'door' as const,
            wallEdgeIndex,
            start,
            end,
          })),
      })),
  }
  const combined = [...features.wallPaths, ...archive.dimensionPaths, ...features.dimensionPaths]
  const paths = combined.filter(
    (path, index) =>
      combined.findIndex(
        (other) =>
          other.operationIndex === path.operationIndex && other.subpathIndex === path.subpathIndex,
      ) === index,
  ) as PdfVectorPath[]
  const linework: PdfLinework = {
    coordinateSystem: 'page-0-1000',
    pageWidth: archive.pageWidth,
    pageHeight: archive.pageHeight,
    paths,
    skippedCurves: 0,
    unsupportedContexts: 0,
    unsupportedPaths: 0,
    clippedPaths: 0,
    truncated: false,
  }
  const labels = Array.from({ length: 192 }, () => ({ text: '', x: 0, y: 0, rotation: 0 }))
  for (const { index, ...label } of [...nativeLabels.items, ...features.labels])
    labels[index] = label
  const reading: PlanReading = {
    readAt: '2026-09-27',
    sourcePage: 6,
    planState: 'existing',
    rooms: archive.rooms.map((room) => ({
      name: `Комната ${room.roomSourceNumber}`,
      kind: 'bedroom',
      sourceNumber: room.roomSourceNumber,
      widthCm: room.widthMm / 10,
      depthCm: room.depthMm / 10,
      measurementEvidence: {
        width: {
          kind: 'horizontal-chain',
          scope: 'room',
          sourceNumber: room.roomSourceNumber,
          complete: true,
          segmentsMm: room.widthLabels.map((index) => Number(labels[index]?.text)),
          textItemIndexes: room.widthLabels,
        },
        depth: {
          kind: 'vertical-chain',
          scope: 'room',
          sourceNumber: room.roomSourceNumber,
          complete: true,
          segmentsMm: room.depthLabels.map((index) => Number(labels[index]?.text)),
          textItemIndexes: room.depthLabels,
        },
      },
    })),
  }
  return { reading, context: { source, contours, linework, planText: JSON.stringify(labels) } }
}

describe('native PDF page to metric draft', () => {
  it('imports a proved room beside an unclassified source area without promoting that area or a page-wide floor', () => {
    const { reading, context } = synthetic()
    const sourcePolygon = [
      { x: 400, y: 10 },
      { x: 500, y: 10 },
      { x: 500, y: 110 },
      { x: 400, y: 110 },
    ]
    context.contours.rooms.push({
      roomSourceNumber: 8,
      polygon: sourcePolygon,
      sourceTopology: {
        kind: 'unclassified-source-paint',
        floorId: 'source-floor-8',
        exactPointKeys: ['400/1:10/1', '500/1:10/1', '500/1:110/1', '400/1:110/1'],
        holes: [],
        holeExactPointKeys: [],
      },
    })
    const envelope = [
      { x: 0, y: 0 },
      { x: 520, y: 0 },
      { x: 520, y: 430 },
      { x: 0, y: 430 },
    ]
    const floor = [
      { x: 5, y: 5 },
      { x: 515, y: 5 },
      { x: 515, y: 425 },
      { x: 5, y: 425 },
    ]
    context.contours.exterior = { boundaryRole: 'outer-wall-envelope', polygon: envelope }
    context.contours.floor = { polygon: floor }
    reading.rooms.push({ name: 'Балкон', kind: 'living', sourceNumber: 8 })
    const result = planPageMetricDraft(reading, { ...context, calibrationRoomNumbers: [4] }, [4])
    expect(result.ok, result.ok ? '' : result.error).toBe(true)
    if (!result.ok) return
    expect(result.geometry.rooms.map((room) => room.sourceNumber)).toEqual([4])
    expect(result.geometry.footprint).toBeUndefined()
    expect(result.geometry.voids).toBeUndefined()
    expect(result.geometry.walls.every((wall) => wall.kind !== 'outer')).toBe(true)
    expect(result.geometry.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('Непроверенных исходных областей: 1')]),
    )
    expect(planPageMetricDraft(reading, context, [8]).ok).toBe(false)
    expect(planPageMetricDraft(reading, { ...context, calibrationRoomNumbers: [8] }, [4]).ok).toBe(
      false,
    )
    const sourceOnly = context.contours.rooms[1]
    if (!sourceOnly?.sourceTopology) throw new Error('Missing source topology')
    sourceOnly.sourceTopology.exactPointKeys.pop()
    expect(planPageMetricDraft(reading, context, [4]).ok).toBe(false)
  })

  it('transfers a source subroom without renumbering it or inventing its height', () => {
    const { reading, context } = synthetic()
    const room = reading.rooms[0]
    if (!room?.measurementEvidence?.width || !room.measurementEvidence.depth)
      throw new Error('Missing synthetic measurement owner')
    room.sourceNumber = 3.1
    room.measurementEvidence.width.sourceNumber = 3.1
    room.measurementEvidence.depth.sourceNumber = 3.1
    const contour = context.contours.rooms[0]
    if (!contour) throw new Error('Missing synthetic source contour')
    contour.roomSourceNumber = 3.1
    const result = planPageMetricDraft(
      reading,
      { ...context, calibrationRoomNumbers: [3.1] },
      [3.1],
    )
    expect(result.ok, result.ok ? '' : result.error).toBe(true)
    if (!result.ok) return
    expect(result.geometry.rooms[0]).toMatchObject({ name: room.name, sourceNumber: 3.1 })
    expect(result.geometry.rooms[0]).not.toHaveProperty('ceilingCm')
    expect(result.geometry.pdfCalibration?.anchorRoomNumbers).toEqual([3.1])
    expect(planPageMetricDraft(reading, context, [3]).ok).toBe(false)
    expect(planPageMetricDraft(reading, context, [3.1001]).ok).toBe(false)
  })
  it('retains a reviewed wall strip and proved exterior through metric layout and volume when omitted paint is disjoint', () => {
    // Entirely synthetic source control: the dimensions are printed chains, and
    // the contours are explicitly reviewed. This does not certify a real plan.
    const { reading, context, path } = synthetic()
    const adjacentFloor = [
      { x: 330, y: 10 },
      { x: 630, y: 10 },
      { x: 630, y: 410 },
      { x: 330, y: 410 },
    ]
    const footprint = [
      { x: 1, y: 1 },
      { x: 640, y: 0 },
      { x: 640, y: 420 },
      { x: 0, y: 420 },
    ]
    const wallBody = path(
      [
        { x: 310, y: 10 },
        { x: 330, y: 10 },
        { x: 330, y: 410 },
        { x: 310, y: 410 },
      ],
      true,
    )
    context.contours.rooms.push({ roomSourceNumber: 5, polygon: adjacentFloor })
    const crossingPaths = [
      path([
        { x: 0, y: 1 },
        { x: 2, y: 1 },
      ]),
      path([
        { x: 1, y: 0 },
        { x: 1, y: 2 },
      ]),
    ]
    const crossingSegments = nativePageSegments({ ...context.linework, paths: crossingPaths })
    const first = crossingSegments[0]
    const second = crossingSegments[1]
    if (!first || !second) throw new Error('Missing bounded exterior crossing')
    context.contours.exterior = {
      boundaryRole: 'floor',
      polygon: footprint,
      vertexProofs: [
        {
          kind: 'bounded-native-rational-crossing',
          vertexIndex: 0,
          segments: [structuredClone(first), structuredClone(second)],
          exactPointKey: '1/1:1/1',
        },
      ],
    }
    // The corner is a proved crossing, not a native command endpoint. Keeping
    // it must not discard independent wall strips farther inside the apartment.
    context.linework.paths.push(
      path(adjacentFloor, true),
      path(footprint.slice(1)),
      wallBody,
      ...crossingPaths,
    )
    reading.rooms.push({ name: 'Смежная спальня', sourceNumber: 5, kind: 'bedroom' })
    const calibratedContext = { ...context, calibrationRoomNumbers: [4] }
    const baseline = planPageMetricDraft(reading, calibratedContext, [4, 5])
    expect(baseline.ok, baseline.ok ? '' : baseline.error).toBe(true)
    if (!baseline.ok) throw new Error(baseline.error)
    const pairs = baseline.geometry.pdfCalibration?.sourceWallFacePairs
    expect(pairs).toHaveLength(1)
    expect(pairs?.[0]?.faces.map(({ start, end }) => [start, end])).toEqual([
      [
        { xCm: 310, yCm: 10 },
        { xCm: 310, yCm: 410 },
      ],
      [
        { xCm: 330, yCm: 10 },
        { xCm: 330, yCm: 410 },
      ],
    ])

    context.linework.skippedCurves = 1
    context.linework.skippedCurveBounds = [
      {
        operationIndex: 99,
        paint: 'stroke',
        bounds: { left: 500, top: 100, right: 510, bottom: 150 },
      },
    ]
    const paintEvent = {
      operationIndex: 99,
      kind: 'vector' as const,
      bounds: { left: 490, top: 90, right: 520, bottom: 160 },
      reason: null,
    }
    context.linework.paintBounds = {
      complete: true,
      refusalReason: null,
      events: [paintEvent],
    }
    const before = structuredClone({ reading, context })
    const remote = planPageMetricDraft(reading, calibratedContext, [4, 5])
    expect(remote).toEqual(baseline)
    if (!remote.ok) throw new Error(remote.error)
    expect(remote.geometry.status).toBe('draft')
    expect(remote.geometry.confirmedAt).toBeUndefined()
    expect(planVolume(remote.geometry)).toBeNull()
    expect(roomLayoutInputFromGeometry(remote.geometry, 'Спальня', null)).toBeNull()

    // Adapter control only: confirmation remains a separate owner action.
    const confirmed = { ...remote.geometry, status: 'confirmed' as const }
    const layout = roomLayoutInputFromGeometry(confirmed, 'Спальня', null)
    expect(layout?.floorPolygon).toEqual([
      { xCm: 0, yCm: 0 },
      { xCm: 300, yCm: 0 },
      { xCm: 300, yCm: 400 },
      { xCm: 0, yCm: 400 },
    ])
    expect(layout?.widthCm).toBe(300)
    expect(layout?.depthCm).toBe(400)
    const volume = planVolume(confirmed)
    expect(volume?.wallSource).toBe('pdf-faces')
    // 3D follows each owning room's edge orientation, without shifting either
    // source face to an inferred wall centreline.
    expect(volume?.walls.map(({ start, end }) => [start, end])).toEqual([
      [
        { xCm: 310, yCm: 10 },
        { xCm: 310, yCm: 410 },
      ],
      [
        { xCm: 330, yCm: 410 },
        { xCm: 330, yCm: 10 },
      ],
    ])
    expect(volume?.walls.every((wall) => wall.topCm === undefined && !wall.solid)).toBe(true)
    expect({ reading, context }).toEqual(before)

    // The raw curve hull is still remote, but the pen envelope now reaches the
    // wall strip. Unknown pen coverage must also prevent a 3D wall claim.
    for (const bounds of [{ left: 329, top: 90, right: 520, bottom: 160 }, null]) {
      context.linework.paintBounds.events[0] = { ...paintEvent, bounds }
      const held = planPageMetricDraft(reading, calibratedContext, [4, 5])
      expect(held.ok, held.ok ? '' : held.error).toBe(true)
      if (!held.ok) throw new Error(held.error)
      expect(held.geometry.pdfCalibration?.sourceWallFacePairs).toEqual([])
      expect(held.geometry.rooms).toEqual(baseline.geometry.rooms)
      expect(held.geometry.status).toBe('draft')
      expect(planVolume({ ...held.geometry, status: 'confirmed' })).toBeNull()
    }

    context.linework.skippedCurves = 0
    context.linework.skippedCurveBounds = undefined
    const laterFill = path(
      [
        { x: 309, y: 100 },
        { x: 331, y: 100 },
        { x: 331, y: 300 },
        { x: 309, y: 300 },
      ],
      true,
      'fill',
    )
    context.linework.paths.push(laterFill)
    context.linework.paintBounds = {
      complete: true,
      refusalReason: null,
      events: [
        {
          operationIndex: wallBody.operationIndex,
          kind: 'vector',
          bounds: { left: 310, top: 10, right: 330, bottom: 410 },
          reason: null,
        },
        {
          operationIndex: laterFill.operationIndex,
          kind: 'vector',
          bounds: { left: 309, top: 100, right: 331, bottom: 300 },
          reason: null,
        },
      ],
    }
    const overpainted = planPageMetricDraft(reading, calibratedContext, [4, 5])
    expect(overpainted.ok, overpainted.ok ? '' : overpainted.error).toBe(true)
    if (!overpainted.ok) throw new Error(overpainted.error)
    expect(overpainted.geometry.pdfCalibration?.sourceWallFacePairs).toEqual([])
    expect(planVolume({ ...overpainted.geometry, status: 'confirmed' })).toBeNull()
  })

  it('transfers a reviewed floor with fresh bounded-crossing proofs, never guessed corners', () => {
    const at = <T>(items: readonly T[], index = 0): T => {
      const value = items[index]
      if (value === undefined) throw new Error('Missing source fixture element')
      return value
    }
    const { reading, context, path } = synthetic()
    const envelope = [
      { x: 0, y: 0 },
      { x: 330, y: 0 },
      { x: 330, y: 430 },
      { x: 0, y: 430 },
    ]
    const polygon = [
      { x: 5, y: 5 },
      { x: 320, y: 5 },
      { x: 320, y: 420 },
      { x: 5, y: 420 },
    ]
    const sides = [
      path([
        { x: 0, y: 5 },
        { x: 325, y: 5 },
      ]),
      path([
        { x: 320, y: 0 },
        { x: 320, y: 425 },
      ]),
      path([
        { x: 0, y: 420 },
        { x: 325, y: 420 },
      ]),
      path([
        { x: 5, y: 0 },
        { x: 5, y: 425 },
      ]),
    ]
    const snapshot = (side: PdfVectorPath) => ({
      operationIndex: side.operationIndex,
      subpathIndex: side.subpathIndex,
      segmentIndex: 0,
      start: { ...at(side.points) },
      end: { ...at(side.points, 1) },
    })
    context.contours.exterior = { boundaryRole: 'outer-wall-envelope', polygon: envelope }
    context.contours.floor = {
      polygon,
      vertexProofs: polygon.map((_, vertexIndex) => ({
        vertexIndex,
        kind: 'bounded-native-crossing',
        segments: [snapshot(at(sides, vertexIndex)), snapshot(at(sides, (vertexIndex + 3) % 4))],
      })),
    }
    context.linework.paths.push(path(envelope, true), ...sides)
    const before = structuredClone(context)
    const nodes = context.linework.paths.flatMap((path) => path.points)
    const segments = nativePageSegments(context.linework)
    const resavedRooms = pageContourRoomsForSave(
      contourDraftsFromSaved(context.contours.rooms),
      nodes,
      segments,
    )
    const resavedFloor = pageFloorForSave(
      structuredClone(context.contours.floor),
      true,
      nodes,
      segments,
    )
    const resavedExterior = pageExteriorForSave(
      structuredClone(context.contours.exterior),
      true,
      nodes,
      segments,
    )
    if (!resavedRooms || !resavedFloor || !resavedExterior)
      throw new Error('Source review lost during editor round-trip')
    expect(resavedFloor).toEqual(context.contours.floor)
    const roundTrip = {
      ...context,
      contours: {
        ...context.contours,
        rooms: resavedRooms,
        floor: resavedFloor,
        exterior: resavedExterior,
      },
    }
    const result = planPageMetricDraft(reading, { ...context, calibrationRoomNumbers: [4] }, [4])
    expect(result.ok, result.ok ? '' : result.error).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.geometry.footprint).toEqual(polygon.map(({ x, y }) => ({ xCm: x, yCm: y })))
    const resaved = planPageMetricDraft(reading, { ...roundTrip, calibrationRoomNumbers: [4] }, [4])
    expect(resaved).toEqual(result)
    expect(result.geometry.status).toBe('draft')
    expect(planVolume(result.geometry)).toBeNull()
    expect(context).toEqual(before)
    delete context.contours.floor.vertexProofs
    expect(planPageMetricDraft(reading, { ...context, calibrationRoomNumbers: [4] }, [4]).ok).toBe(
      false,
    )
  })
  it('retains a decimal-exact diagonal floor crossing without confirming the metric draft', () => {
    const { reading, context, path } = synthetic()
    const envelope = [
      { x: 0, y: 0 },
      { x: 330, y: 0 },
      { x: 330, y: 430 },
      { x: 0, y: 430 },
    ]
    const polygon = [
      { x: 5, y: 5 },
      { x: 315, y: 5 },
      { x: 320, y: 10 },
      { x: 320, y: 420 },
      { x: 5, y: 420 },
    ]
    const diagonalPaths = [
      path([
        { x: 305, y: 0 },
        { x: 325, y: 10 },
      ]),
      path([
        { x: 305, y: 10 },
        { x: 325, y: 0 },
      ]),
    ]
    context.linework.paths.push(
      path(envelope, true),
      path([
        { x: 5, y: 5 },
        { x: 5, y: 420 },
        { x: 320, y: 420 },
        { x: 320, y: 10 },
      ]),
      ...diagonalPaths,
    )
    const segments = nativePageSegments({ ...context.linework, paths: diagonalPaths })
    const first = segments[0]
    const second = segments[1]
    if (!first || !second) throw new Error('Missing diagonal source segments')
    context.contours.exterior = { boundaryRole: 'outer-wall-envelope', polygon: envelope }
    context.contours.floor = {
      polygon,
      vertexProofs: [
        {
          vertexIndex: 1,
          kind: 'bounded-native-rational-crossing',
          exactPointKey: '315/1:5/1',
          segments: [first, second],
        },
      ],
    }
    const before = structuredClone(context)
    const nodes = context.linework.paths.flatMap((item) => item.points)
    const resavedFloor = pageFloorForSave(
      context.contours.floor,
      true,
      nodes,
      nativePageSegments(context.linework),
    )
    expect(resavedFloor).toEqual(context.contours.floor)
    const result = planPageMetricDraft(reading, { ...context, calibrationRoomNumbers: [4] }, [4])
    expect(result.ok, result.ok ? '' : result.error).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.geometry.footprint).toEqual(polygon.map(({ x, y }) => ({ xCm: x, yCm: y })))
    expect(result.geometry.status).toBe('draft')
    expect(result.geometry.confirmedAt).toBeUndefined()
    expect(planVolume(result.geometry)).toBeNull()
    expect(roomLayoutInputFromGeometry(result.geometry, 'Спальня', null)).toBeNull()
    expect(context).toEqual(before)
    const proof = context.contours.floor.vertexProofs?.[0]
    if (proof?.kind !== 'bounded-native-rational-crossing') throw new Error('Missing floor proof')
    proof.exactPointKey = '321/1:5/1'
    expect(planPageMetricDraft(reading, { ...context, calibrationRoomNumbers: [4] }, [4]).ok).toBe(
      false,
    )
  })

  it('transfers a separately reviewed floor without creating walls from its boundary', () => {
    const { reading, context, path } = synthetic()
    const envelope = [
      { x: 0, y: 0 },
      { x: 330, y: 0 },
      { x: 330, y: 430 },
      { x: 0, y: 430 },
    ]
    const floor = [
      { x: 5, y: 5 },
      { x: 320, y: 5 },
      { x: 320, y: 420 },
      { x: 5, y: 420 },
    ]
    context.contours.exterior = { boundaryRole: 'outer-wall-envelope', polygon: envelope }
    context.linework.paths.push(path(envelope, true), path(floor, true))
    const globalContext = { ...context, calibrationRoomNumbers: [4] }
    const envelopeOnly = planPageMetricDraft(reading, globalContext, [4])
    expect(envelopeOnly.ok, envelopeOnly.ok ? '' : envelopeOnly.error).toBe(true)
    if (!envelopeOnly.ok) return
    expect(envelopeOnly.geometry.footprint).toBeUndefined()
    expect(envelopeOnly.geometry.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('не является границей пола')]),
    )

    context.contours.floor = { polygon: floor }
    const before = structuredClone(context)
    const result = planPageMetricDraft(reading, globalContext, [4])
    expect(result.ok, result.ok ? '' : result.error).toBe(true)
    if (!result.ok) return
    expect(result.geometry.footprint).toEqual(floor.map(({ x, y }) => ({ xCm: x, yCm: y })))
    expect(result.geometry).toMatchObject({ widthCm: 330, heightCm: 430 })
    expect(result.geometry.pdfCalibration?.origin).toEqual({ x: 0, y: 0 })
    expect(result.geometry.pdfCalibration?.exteriorBoundaryRole).toBe('outer-wall-envelope')
    expect(result.geometry.walls).toEqual(envelopeOnly.geometry.walls)
    expect(result.geometry.walls).toHaveLength(8)
    expect(result.geometry.rooms).toEqual(envelopeOnly.geometry.rooms)
    expect(result.geometry.openings).toEqual(envelopeOnly.geometry.openings)
    expect(
      result.geometry.warnings.some((warning) => warning.includes('не является границей пола')),
    ).toBe(false)
    expect(context).toEqual(before)
  })

  it.each([undefined, 'floor'] as const)('preserves the legacy exterior floor role %s', (role) => {
    const { reading, context, path } = synthetic()
    const polygon = [
      { x: 0, y: 0 },
      { x: 330, y: 0 },
      { x: 330, y: 430 },
      { x: 0, y: 430 },
    ]
    context.contours.exterior = { polygon, ...(role ? { boundaryRole: role } : {}) }
    context.linework.paths.push(path(polygon, true))
    const result = planPageMetricDraft(reading, { ...context, calibrationRoomNumbers: [4] }, [4])
    expect(result.ok, result.ok ? '' : result.error).toBe(true)
    if (!result.ok) return
    expect(result.geometry.footprint).toEqual(polygon.map(({ x, y }) => ({ xCm: x, yCm: y })))
    expect(result.geometry.walls).toHaveLength(8)
  })

  it('refuses a non-native floor and proposed-sheet transfer without assigning a substitute', () => {
    const { reading, context, path } = synthetic()
    const envelope = [
      { x: 0, y: 0 },
      { x: 330, y: 0 },
      { x: 330, y: 430 },
      { x: 0, y: 430 },
    ]
    const floor = [
      { x: 5, y: 5 },
      { x: 320, y: 5 },
      { x: 320, y: 420 },
      { x: 5, y: 420 },
    ]
    context.contours.exterior = { boundaryRole: 'outer-wall-envelope', polygon: envelope }
    context.contours.floor = { polygon: floor }
    context.linework.paths.push(path(envelope, true))
    const globalContext = { ...context, calibrationRoomNumbers: [4] }
    expect(planPageMetricDraft(reading, globalContext, [4]).ok).toBe(false)
    context.linework.paths.push(path(floor, true))
    expect(planPageMetricDraft(reading, globalContext, [4]).ok).toBe(true)
    expect(
      planPageMetricDraft(
        { ...reading, planState: 'proposed' },
        {
          ...globalContext,
          source: { ...context.source, state: 'proposed' },
          contours: {
            ...context.contours,
            source: { ...context.source, state: 'proposed' },
          },
        },
        [4],
      ).ok,
    ).toBe(false)
  })

  it('keeps an open-zone divider in the room polygon without creating a physical wall', () => {
    const { reading, context } = synthetic()
    const room = context.contours.rooms[0]
    if (!room) throw new Error('Synthetic room is missing.')
    room.conditionalEdges = [{ wallEdgeIndex: 0 }]
    const result = planPageMetricDraft(reading, { ...context, calibrationRoomNumbers: [4] }, [4])
    expect(result.ok, result.ok ? '' : result.error).toBe(true)
    if (!result.ok) return
    expect(result.geometry.rooms[0]?.polygon).toHaveLength(4)
    expect(result.geometry.walls).toHaveLength(3)
    expect(result.geometry.pdfCalibration?.sourceOpenZoneBoundaries).toEqual([
      {
        polygon: result.geometry.rooms[0]?.polygon,
        edgeIndex: 0,
        sourceEdge: [room.polygon[0], room.polygon[1]],
      },
    ])
    expect(result.geometry.walls.some((wall) => wall.start.yCm === 0 && wall.end.yCm === 0)).toBe(
      false,
    )
    expect(result.geometry.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('Условные границы открытых зон')]),
    )
  })

  it('uses two perpendicular native chains and preserves door position in a draft', () => {
    const { reading, context } = synthetic()
    const before = structuredClone({ reading, context })
    const result = planPageMetricDraft(reading, context, [4])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.geometry).toMatchObject({
      source: 'manual',
      status: 'draft',
      widthCm: 300,
      heightCm: 400,
    })
    expect(result.geometry).not.toHaveProperty('confirmedAt')
    expect(result.geometry.rooms[0]?.polygon).toEqual([
      { xCm: 0, yCm: 0 },
      { xCm: 300, yCm: 0 },
      { xCm: 300, yCm: 400 },
      { xCm: 0, yCm: 400 },
    ])
    expect(result.geometry.openings[0]).toMatchObject({ type: 'door', offsetCm: 120, widthCm: 90 })
    expect(result.geometry.openings[0]).not.toHaveProperty('clearance')
    expect(
      result.geometry.walls.every(
        (wall) =>
          /^manual_[a-f0-9]{24}$/.test(wall.id) &&
          wall.kind === 'inner' &&
          !('thicknessCm' in wall),
      ),
    ).toBe(true)
    expect(planPageMetricDraft(reading, context, [4])).toEqual(result)
    expect({ reading, context }).toEqual(before)
  })

  it.each([false, true])('preserves an area disagreement with global calibration %s', (global) => {
    const { reading, context } = synthetic()
    const calibratedContext = global ? { ...context, calibrationRoomNumbers: [4] } : context
    const room = reading.rooms[0]
    if (!room) throw new Error('Synthetic room is missing.')
    room.areaM2 = 11.5

    const result = planPageMetricDraft(reading, calibratedContext, [4])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.geometry.rooms[0]?.polygon).toEqual([
      { xCm: 0, yCm: 0 },
      { xCm: 300, yCm: 0 },
      { xCm: 300, yCm: 400 },
      { xCm: 0, yCm: 400 },
    ])
    expect(result.geometry.warnings).toContain(
      'Спальня: площадь по контуру 12.00 м², на плане 11.50 м². Сверьте границы помещения.',
    )

    room.areaM2 = 12
    const matching = planPageMetricDraft(reading, calibratedContext, [4])
    expect(matching.ok).toBe(true)
    if (!matching.ok) return
    expect(
      matching.geometry.warnings.some((warning) => warning.includes('площадь по контуру')),
    ).toBe(false)
  })

  it('derives a real original bedroom draft and existing door without asserting AI accuracy', () => {
    const { reading, context } = realSheet()
    const result = planPageMetricDraft(reading, context, [4])
    expect(result.ok, result.ok ? '' : result.error).toBe(true)
    if (!result.ok) return
    expect(result.geometry.rooms[0]?.sourceNumber).toBe(4)
    expect(result.geometry.widthCm).toBe(299)
    expect(result.geometry.heightCm).toBe(516)
    expect(result.geometry.openings[0]?.widthCm).toBeCloseTo(89.6, 1)
  })

  it('preserves a kitchen notch and living diagonal rather than replacing them with boxes', () => {
    const { reading, context } = realSheet()
    const result = planPageMetricDraft(reading, context, [2, 3, 4])
    expect(result.ok, result.ok ? '' : result.error).toBe(true)
    if (!result.ok) return
    expect(result.geometry.rooms.map((room) => room.polygon.length)).toEqual([6, 5, 4])
    const diagonal = result.geometry.rooms[1]?.polygon
    expect(diagonal?.[3]?.xCm).not.toBe(diagonal?.[4]?.xCm)
    expect(diagonal?.[3]?.yCm).not.toBe(diagonal?.[4]?.yCm)
  })

  it.each(['depth', 'width'] as const)(
    'refuses missing %s evidence instead of guessing from area',
    (side) => {
      const { reading, context } = synthetic()
      delete reading.rooms[0]?.measurementEvidence?.[side]
      expect(planPageMetricDraft(reading, context, [4]).ok).toBe(false)
    },
  )
  it('refuses different directional scales without warping a room', () => {
    const { reading, context, labels } = synthetic()
    const room = reading.rooms[0]
    if (!room?.measurementEvidence?.depth) throw new Error('Missing synthetic room')
    room.depthCm = 410
    room.measurementEvidence.depth.segmentsMm = [4100]
    labels[1] = { text: '4100', x: 278, y: 200, rotation: 90 }
    context.planText = JSON.stringify(labels)
    expect(planPageMetricDraft(reading, context, [4])).toMatchObject({
      ok: false,
      error: expect.stringContaining('единый масштаб'),
    })
  })
  it('refuses an unproved door instead of silently dropping it', () => {
    const { reading, context } = synthetic()
    context.planText = JSON.stringify([
      { text: '3000', x: 150, y: 38, rotation: 0 },
      { text: '4000', x: 278, y: 200, rotation: 90 },
    ])
    expect(planPageMetricDraft(reading, context, [4]).ok).toBe(false)
  })
  it('requires each segment to confirm the scale, not only a plausible total', () => {
    const { reading, context, labels, dimension } = synthetic()
    context.linework.paths = context.linework.paths.filter(
      (path) => ![2, 3, 4].includes(path.operationIndex),
    )
    context.linework.paths.push(
      ...dimension({ x: 10, y: 40 }, { x: 160, y: 40 }),
      ...dimension({ x: 160, y: 40 }, { x: 310, y: 40 }),
    )
    labels[0] = { text: '2000', x: 100, y: 38, rotation: 0 }
    labels.push({ text: '1000', x: 230, y: 38, rotation: 0 })
    context.planText = JSON.stringify(labels)
    const evidence = reading.rooms[0]?.measurementEvidence?.width
    if (!evidence) throw new Error('Missing synthetic evidence')
    evidence.segmentsMm = [2000, 1000]
    evidence.textItemIndexes = [0, 3]
    expect(planPageMetricDraft(reading, context, [4])).toMatchObject({
      ok: false,
      error: expect.stringContaining('единый масштаб'),
    })
  })
  it('bounds competing native arrow pairs before the legacy chain allocates spans', () => {
    const { reading, context } = synthetic()
    const left = context.linework.paths[3]
    const right = context.linework.paths[4]
    if (!left || !right) throw new Error('Missing synthetic arrows')
    for (let index = 0; index < 46; index++) {
      context.linework.paths.push(
        { ...left, operationIndex: 1000 + index },
        { ...right, operationIndex: 2000 + index },
      )
    }
    expect(planPageMetricDraft(reading, context, [4])).toMatchObject({
      ok: false,
      error: expect.stringContaining('конкурирующих стрелок'),
    })
  })
  it('refuses room overlap even when no openings or obstacles were annotated', () => {
    const { reading, context, path } = synthetic()
    const first = context.contours.rooms[0]
    const room = reading.rooms[0]
    if (!first || !room) throw new Error('Missing synthetic room')
    delete first.openings
    const polygon = [
      { x: 30, y: 50 },
      { x: 330, y: 50 },
      { x: 330, y: 450 },
      { x: 30, y: 450 },
    ]
    context.contours.rooms.push({ roomSourceNumber: 5, polygon })
    context.linework.paths.push(path(polygon, true))
    reading.rooms.push({ ...room, sourceNumber: 5, name: 'Гостиная' })
    expect(planPageMetricDraft(reading, context, [4, 5])).toMatchObject({
      ok: false,
      error: expect.stringContaining('вершины не совпали'),
    })
  })
  it('refuses non-native coordinates, stale sources, unknown state and duplicate selection', () => {
    for (const change of [
      (fixture: ReturnType<typeof synthetic>) => {
        fixture.context.source.sha256 = 'b'.repeat(64)
      },
      (fixture: ReturnType<typeof synthetic>) => {
        fixture.reading.planState = 'unknown'
      },
      (fixture: ReturnType<typeof synthetic>) => {
        const point = fixture.context.contours.rooms[0]?.polygon[0]
        if (point) point.x += 0.01
      },
    ]) {
      const fixture = synthetic()
      change(fixture)
      expect(planPageMetricDraft(fixture.reading, fixture.context, [4]).ok).toBe(false)
    }
    const { reading, context } = synthetic()
    expect(planPageMetricDraft(reading, context, [4, 4]).ok).toBe(false)
    expect(planPageMetricDraft(reading, context, [5]).ok).toBe(false)
  })
  it('translates a native rectangle obstacle, but never turns a triangle into a box', () => {
    const { reading, context, path } = synthetic()
    const room = context.contours.rooms[0]
    if (!room) throw new Error('Missing synthetic room')
    const polygon = [
      { x: 30, y: 50 },
      { x: 50, y: 50 },
      { x: 50, y: 70 },
      { x: 30, y: 70 },
    ]
    room.obstacles = [{ id: 'column', kind: 'column', polygon }]
    context.linework.paths.push(path(polygon, true))
    const result = planPageMetricDraft(reading, context, [4])
    expect(result.ok).toBe(true)
    if (result.ok)
      expect(result.geometry.obstacles?.[0]).toMatchObject({
        kind: 'column',
        xCm: 20,
        yCm: 40,
        widthCm: 20,
        depthCm: 20,
      })
    room.obstacles[0]?.polygon.pop()
    expect(planPageMetricDraft(reading, context, [4])).toMatchObject({
      ok: false,
      error: expect.stringContaining('многоугольной'),
    })
  })
})
