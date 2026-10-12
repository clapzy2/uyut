import type { PlanReading } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import { floorHeightFixture } from './plan-native-reviewed-floor-heights.fixture'
import { nativeVisiblePaintRegions } from './plan-native-visible-paint'
import { planPageSourceFloors } from './plan-page-source-floors'

function sourceFloorFixture() {
  const evidence = floorHeightFixture()
  const reading: PlanReading = {
    sourcePage: 3,
    planState: 'existing',
    readAt: '2026-10-12',
    rooms: [{ name: 'Спальня', kind: 'bedroom', sourceNumber: 3.1 }],
    paintedFloorReview: {
      version: 1,
      savedAt: '2026-10-12',
      draftJson: JSON.stringify(evidence.reviewedFloors),
    },
  }
  return {
    source: evidence.reviewedFloors.source,
    sourceRevision: 'c'.repeat(64),
    pageWidth: evidence.work.pageWidth,
    pageHeight: evidence.work.pageHeight,
    evidence,
    reading,
  }
}

describe('fresh raw source floor reference for the contour editor', () => {
  it('preserves source coordinates and subnumbers without changing reading or confirming physical geometry', () => {
    const input = sourceFloorFixture()
    const before = structuredClone(input)
    const result = planPageSourceFloors(input)
    expect(result).toMatchObject({
      status: 'checked',
      coordinateSystem: 'page-0-1000',
      readOnly: true,
      physicalBoundariesAccepted: false,
    })
    expect(result.floors[0]?.sourceRoomKey).toBe('3.1')
    expect(result.floors[0]?.polygon).toEqual(input.evidence.reviewedFloors.floors[0]?.polygon)
    expect(result.floors[0]?.nonDecimalVertices).toBe(0)
    expect(result).not.toHaveProperty('geometry')
    expect(input).toEqual(before)
  })
  it('retains an enclosed hole and exact diagonal intersections in the source reference', () => {
    const input = sourceFloorFixture()
    input.evidence.work.paths.push(
      {
        operationIndex: 20,
        subpathIndex: 0,
        paint: 'fill',
        closed: true,
        points: [
          { x: 200, y: 200 },
          { x: 230, y: 200 },
          { x: 230, y: 230 },
          { x: 200, y: 230 },
        ],
      },
      {
        operationIndex: 30,
        subpathIndex: 0,
        paint: 'fill',
        closed: true,
        points: [
          { x: 251, y: 80 },
          { x: 310, y: 111 },
          { x: 270, y: 141 },
        ],
      },
    )
    const piece = nativeVisiblePaintRegions(input.evidence).regions.find(
      (region) => region.candidateId === 'native-fill-10:0',
    )?.pieces[0]
    const floor = input.evidence.reviewedFloors.floors[0]
    if (!piece || !floor || !input.reading.paintedFloorReview)
      throw new Error('Missing source fixture')
    Object.assign(floor, {
      polygon: piece.polygon,
      holes: piece.holes,
      boundaryRoles: piece.polygon.map((_, edgeIndex) => ({ edgeIndex, kind: 'unresolved' })),
    })
    input.reading.paintedFloorReview.draftJson = JSON.stringify(input.evidence.reviewedFloors)
    const result = planPageSourceFloors(input)
    expect(result.status).toBe('checked')
    expect(result.floors[0]?.holes).toEqual(piece.holes)
    expect(result.floors[0]?.holeExactPointKeys).toHaveLength(1)
    expect(result.floors[0]?.nonDecimalVertices).toBeGreaterThan(0)
    expect(result.physicalBoundariesAccepted).toBe(false)
  })
  it.each(['hash', 'page', 'state', 'format', 'json', 'stale-point', 'missing-evidence'])(
    'holds %s evidence without returning an old region',
    (fault) => {
      const input = sourceFloorFixture()
      if (fault === 'hash') input.source = { ...input.source, sha256: 'd'.repeat(64) }
      if (fault === 'page') input.source = { ...input.source, pdfPage: 4 }
      if (fault === 'state') input.reading.planState = 'proposed'
      if (fault === 'format') input.pageHeight = 800
      if (fault === 'json' && input.reading.paintedFloorReview)
        input.reading.paintedFloorReview.draftJson = '{}'
      if (fault === 'stale-point') {
        const point = input.evidence.work.paths[0]?.points[0]
        if (!point) throw new Error('Missing source vertex')
        point.x += 0.001
      }
      const result = planPageSourceFloors(
        fault === 'missing-evidence' ? { ...input, evidence: undefined } : input,
      )
      expect(result.status).toBe('held')
      expect(result.floors).toEqual([])
    },
  )
  it('returns not-saved when there is no selected source region, never inferring one', () => {
    const input = sourceFloorFixture()
    delete input.reading.paintedFloorReview
    expect(planPageSourceFloors(input)).toMatchObject({ status: 'not-saved', floors: [] })
  })
})
