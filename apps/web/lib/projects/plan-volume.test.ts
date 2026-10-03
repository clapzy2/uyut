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

  it('строит оконный вырез с подоконной частью и перемычкой только при всех мерках', () => {
    const window = geometry.openings[1]
    if (!window) throw new Error('Missing test window')
    const measured = {
      ...geometry,
      walls: geometry.walls.map((wall) => ({ ...wall, heightCm: 200 })),
      openings: [{ ...window, bottomCm: 50, heightCm: 100 }],
    }
    const result = planVolume(measured)
    expect(
      result?.walls.map((wall) => [wall.start.xCm, wall.end.xCm, wall.bottomCm, wall.topCm]),
    ).toEqual([
      [0, 250, 0, 200],
      [250, 350, 0, 50],
      [250, 350, 150, 200],
      [350, 400, 0, 200],
    ])
    expect(result?.openings[0]?.cut).toBe(true)

    const incomplete = { ...measured, openings: [{ ...window, heightCm: 100, sillHeightCm: 50 }] }
    expect(planVolume(incomplete)?.walls).toHaveLength(1)
    expect(planVolume(incomplete)?.openings[0]?.cut).toBe(false)
    expect(planVolume({ ...measured, walls: geometry.walls })?.openings[0]?.cut).toBe(false)
    expect(
      planVolume({ ...measured, openings: [{ ...window, heightCm: 100, bottomCm: 150 }] }),
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

    // Vertical user measurements do not alter the source-proven horizontal face relation.
    pdfGeometry.walls = pdfGeometry.walls.map((wall) => ({ ...wall, heightCm: 270 }))
    pdfGeometry.openings = pdfGeometry.openings.map((opening) => ({
      ...opening,
      bottomCm: 0,
      heightCm: 210,
    }))
    const vertical = planVolume(pdfGeometry)
    expect(vertical?.openings.every((opening) => opening.cut)).toBe(true)
    expect(vertical?.walls.filter((wall) => wall.bottomCm === 210)).toHaveLength(2)

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
