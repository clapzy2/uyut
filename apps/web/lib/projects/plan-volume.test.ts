import type { PlanGeometry, PlanWallFacePair } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import { planVolume } from './plan-volume'

const geometry: PlanGeometry = {
  version: 1,
  status: 'confirmed',
  widthCm: 400,
  heightCm: 300,
  walls: [
    {
      id: 'wall-1',
      kind: 'outer',
      start: { xCm: 0, yCm: 0 },
      end: { xCm: 400, yCm: 0 },
    },
  ],
  openings: [
    { id: 'door-1', type: 'door', wallId: 'wall-1', offsetCm: 100, widthCm: 90 },
    { id: 'window-1', type: 'window', wallId: 'wall-1', offsetCm: 250, widthCm: 100 },
  ],
  rooms: [],
  footprint: [
    { xCm: 0, yCm: 0 },
    { xCm: 400, yCm: 0 },
    { xCm: 400, yCm: 300 },
    { xCm: 0, yCm: 300 },
  ],
  voids: [
    {
      id: 'shaft',
      polygon: [
        { xCm: 10, yCm: 10 },
        { xCm: 20, yCm: 10 },
        { xCm: 20, yCm: 20 },
        { xCm: 10, yCm: 20 },
      ],
    },
  ],
  warnings: [],
}

describe('planVolume', () => {
  it('keeps the floor and walls intact when opening heights are unknown', () => {
    const result = planVolume(geometry)

    expect(result?.floor).toEqual(geometry.footprint)
    expect(result?.voids).toEqual([geometry.voids?.[0]?.polygon])
    expect(result?.walls.map(({ start, end }) => [start.xCm, end.xCm])).toEqual([[0, 400]])
    expect(result?.openings.map(({ start, end }) => [start.xCm, end.xCm])).toEqual([
      [100, 190],
      [250, 350],
    ])
  })

  it('does not promote an unfinished or unverified PDF plan to wall volume', () => {
    expect(planVolume({ ...geometry, status: 'draft' })).toBeNull()
    expect(planVolume({ ...geometry, footprint: undefined })).toBeNull()
    expect(
      planVolume({
        ...geometry,
        pdfCalibration: { sourceSha256: 'source', pdfPage: 1 } as NonNullable<
          PlanGeometry['pdfCalibration']
        >,
      }),
    ).toBeNull()
  })

  it('shows only source-proven PDF face intervals and marks opening positions', () => {
    const firstWall = geometry.walls[0]
    const firstOpening = geometry.openings[0]
    const footprint = geometry.footprint
    if (!firstWall || !firstOpening || !footprint) throw new Error('Missing test geometry')
    const secondWall = {
      ...firstWall,
      id: 'wall-2',
      start: { xCm: 0, yCm: 20 },
      end: { xCm: 400, yCm: 20 },
    }
    const secondOpening = { ...firstOpening, id: 'door-2', wallId: secondWall.id }
    const room = { name: 'Комната', polygon: footprint }
    const segment = { operationIndex: 1, subpathIndex: 1, segmentIndex: 1 }
    const pair: PlanWallFacePair = {
      faces: [
        {
          wall: structuredClone(firstWall),
          start: { xCm: 50, yCm: 0 },
          end: { xCm: 350, yCm: 0 },
          nativeSegment: segment,
        },
        {
          wall: structuredClone(secondWall),
          start: { xCm: 50, yCm: 20 },
          end: { xCm: 350, yCm: 20 },
          nativeSegment: segment,
        },
      ],
      openings: [structuredClone(firstOpening), structuredClone(secondOpening)],
    }
    const pdfGeometry: PlanGeometry = {
      ...geometry,
      walls: [firstWall, secondWall],
      openings: [firstOpening, secondOpening],
      rooms: [room],
      pdfCalibration: {
        sourceSha256: 'source',
        pdfPage: 1,
        exteriorBoundaryRole: 'floor',
        cmPerPoint: 1,
        origin: { x: 0, y: 0 },
        anchorRoomNumbers: [],
        labelIndexes: [],
        derivedOpeningIds: [],
        sourceWallFacePairs: [pair],
        wallFaceRoomPolygons: [room.polygon],
      },
    }

    const result = planVolume(pdfGeometry)
    expect(result?.wallSource).toBe('pdf-faces')
    expect(result?.walls.map(({ start, end }) => [start.xCm, end.xCm])).toEqual([
      [50, 350],
      [50, 350],
    ])
    expect(result?.openings).toHaveLength(2)

    const editedWall = pdfGeometry.walls[0]
    const calibration = pdfGeometry.pdfCalibration
    if (!editedWall || !calibration) throw new Error('Missing PDF proof')
    editedWall.end.xCm += 1
    expect(planVolume(pdfGeometry)).toBeNull()
    editedWall.end.xCm -= 1
    calibration.exteriorBoundaryRole = 'outer-wall-envelope'
    expect(planVolume(pdfGeometry)).toBeNull()
  })
})
