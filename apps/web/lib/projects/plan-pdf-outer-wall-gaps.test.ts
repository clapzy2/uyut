import type { PlanGeometry, PlanPageContours, PlanWall, PlanWallFacePair } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import { sourceOuterWallGaps } from './plan-pdf-outer-wall-gaps'

const source = { sha256: 'a'.repeat(64), pdfPage: 4, state: 'existing' as const }
const polygon = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
]
const contours: PlanPageContours = {
  source,
  coordinateSystem: 'page-0-1000',
  review: 'manual-source-review',
  pageWidth: 1000,
  pageHeight: 1000,
  exterior: { boundaryRole: 'outer-wall-envelope', polygon },
  rooms: [],
}
const walls: PlanWall[] = polygon.map((start, index) => {
  const end = polygon[(index + 1) % polygon.length] as (typeof polygon)[number]
  return {
    id: `outer-${index}`,
    kind: 'outer',
    start: { xCm: start.x, yCm: start.y },
    end: { xCm: end.x, yCm: end.y },
  }
})
const geometry: PlanGeometry = {
  version: 1,
  source: 'manual',
  status: 'draft',
  widthCm: 100,
  heightCm: 100,
  warnings: [],
  rooms: [],
  walls,
  openings: [],
  pdfCalibration: {
    sourceSha256: source.sha256,
    pdfPage: source.pdfPage,
    cmPerPoint: 1,
    origin: { x: 0, y: 0 },
    anchorRoomNumbers: [],
    labelIndexes: [],
    derivedOpeningIds: [],
  },
}
const pair: PlanWallFacePair = {
  faces: [
    {
      wall: walls[0] as PlanWall,
      start: { xCm: 0, yCm: 0 },
      end: { xCm: 40, yCm: 0 },
      nativeSegment: { operationIndex: 1, subpathIndex: 0, segmentIndex: 0 },
    },
    {
      wall: { ...walls[0], id: 'inner', kind: 'inner' } as PlanWall,
      start: { xCm: 0, yCm: 10 },
      end: { xCm: 40, yCm: 10 },
      nativeSegment: { operationIndex: 2, subpathIndex: 0, segmentIndex: 0 },
    },
  ],
  openings: [],
}

describe('read-only PDF outer wall gap hints', () => {
  it('projects only the unpaired part of a matching saved exterior edge', () => {
    const gaps = sourceOuterWallGaps(geometry, contours, [pair])
    expect(gaps[0]).toEqual({
      edgeIndex: 0,
      wallId: 'outer-0',
      start: { x: 40, y: 0 },
      end: { x: 100, y: 0 },
    })
    expect(gaps).toHaveLength(4)
  })

  it('refuses a stale source or an edited metric wall instead of misplacing a hint', () => {
    const firstWall = walls[0]
    if (!firstWall) throw new Error('Missing first exterior wall')
    expect(
      sourceOuterWallGaps(geometry, { ...contours, source: { ...source, pdfPage: 3 } }, [pair]),
    ).toEqual([])
    expect(
      sourceOuterWallGaps(
        geometry,
        {
          ...contours,
          exterior: { ...contours.exterior, boundaryRole: 'floor' },
        } as PlanPageContours,
        [pair],
      ),
    ).toEqual([])
    expect(
      sourceOuterWallGaps(
        { ...geometry, walls: [{ ...firstWall, end: { xCm: 90, yCm: 0 } }, ...walls.slice(1)] },
        contours,
        [pair],
      ),
    ).toEqual([])
  })
})
