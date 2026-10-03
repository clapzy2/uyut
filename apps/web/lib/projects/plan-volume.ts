import type { PlanGeometry, PlanPoint } from '@uyut/db'
import { currentWallFacePairs } from './plan-opening-face-pairs'
import { inspectPlanVerticalDimensions } from './plan-vertical-dimensions'
import { wallElevationPanels } from './wall-elevation'

export type WallSpan = {
  id: string
  start: PlanPoint
  end: PlanPoint
  kind: 'outer' | 'inner'
  bottomCm: number
  topCm?: number
}

export type OpeningSpan = {
  id: string
  type: 'door' | 'window' | 'balcony'
  start: PlanPoint
  end: PlanPoint
  bottomCm?: number
  heightCm?: number
  cut: boolean
}

export type PlanVolume = {
  floor: PlanPoint[]
  voids: PlanPoint[][]
  walls: WallSpan[]
  openings: OpeningSpan[]
  wallSource: 'centerline' | 'pdf-faces'
}

function interpolate(start: PlanPoint, end: PlanPoint, ratio: number): PlanPoint {
  return {
    xCm: start.xCm + (end.xCm - start.xCm) * ratio,
    yCm: start.yCm + (end.yCm - start.yCm) * ratio,
  }
}

/** Only complete vertical measurements can remove part of a wall surface. */
function addWallInterval(
  walls: WallSpan[],
  openings: OpeningSpan[],
  wall: PlanGeometry['walls'][number],
  intervalStart: PlanPoint,
  intervalEnd: PlanPoint,
  sourceOpenings: PlanGeometry['openings'],
) {
  const length = Math.hypot(wall.end.xCm - wall.start.xCm, wall.end.yCm - wall.start.yCm)
  if (length <= 0) return

  const distance = (point: PlanPoint) =>
    ((point.xCm - wall.start.xCm) * (wall.end.xCm - wall.start.xCm) +
      (point.yCm - wall.start.yCm) * (wall.end.yCm - wall.start.yCm)) /
    length
  const startDistance = Math.max(0, Math.min(length, distance(intervalStart)))
  const endDistance = Math.max(0, Math.min(length, distance(intervalEnd)))
  const low = Math.min(startDistance, endDistance)
  const high = Math.max(startDistance, endDistance)
  if (high - low < 0.001) return

  const pointAt = (distanceCm: number) => interpolate(wall.start, wall.end, distanceCm / length)
  const spans = sourceOpenings
    .filter((opening) => opening.wallId === wall.id && opening.widthCm > 0)
    .map((opening) => ({
      opening,
      start: Math.max(low, opening.offsetCm),
      end: Math.min(high, opening.offsetCm + opening.widthCm),
    }))
    .filter((cut) => cut.end > cut.start)

  const measuredCuts = spans.flatMap(({ opening, start, end }) =>
    opening.bottomCm !== undefined && opening.heightCm !== undefined
      ? [
          {
            startCm: start - low,
            endCm: end - low,
            bottomCm: opening.bottomCm,
            heightCm: opening.heightCm,
          },
        ]
      : [],
  )
  const panels =
    wall.heightCm === undefined
      ? [{ startCm: 0, endCm: high - low, bottomCm: 0, topCm: undefined }]
      : wallElevationPanels(high - low, wall.heightCm, measuredCuts)
  if (!panels) return
  for (const panel of panels) {
    walls.push({
      id: `${wall.id}-${low}-${high}-${panel.startCm}-${panel.bottomCm}`,
      start: pointAt(low + panel.startCm),
      end: pointAt(low + panel.endCm),
      kind: wall.kind,
      bottomCm: panel.bottomCm,
      topCm: panel.topCm,
    })
  }

  for (const cut of spans) {
    openings.push({
      id: `${cut.opening.id}-${low}`,
      type: cut.opening.type,
      start: pointAt(cut.start),
      end: pointAt(cut.end),
      bottomCm: cut.opening.bottomCm,
      heightCm: cut.opening.heightCm,
      cut:
        wall.heightCm !== undefined &&
        cut.opening.bottomCm !== undefined &&
        cut.opening.heightCm !== undefined,
    })
  }
}

/** Build a viewing model only from confirmed 2D coordinates and current source relations. */
export function planVolume(geometry: PlanGeometry): PlanVolume | null {
  if (geometry.status !== 'confirmed' || !geometry.footprint || geometry.footprint.length < 3) {
    return null
  }
  if (inspectPlanVerticalDimensions(geometry).length > 0) return null

  const walls: WallSpan[] = []
  const openings: OpeningSpan[] = []

  if (geometry.pdfCalibration) {
    if (geometry.pdfCalibration.exteriorBoundaryRole !== 'floor') return null
    const sourcePairs = geometry.pdfCalibration.sourceWallFacePairs ?? []
    const currentPairs = currentWallFacePairs(geometry)
    if (sourcePairs.length === 0 || currentPairs.length !== sourcePairs.length) return null

    for (const pair of currentPairs) {
      for (const face of pair.faces) {
        const wall = geometry.walls.find((item) => item.id === face.wall.id)
        if (!wall) return null
        const currentOpenings = geometry.openings.filter((item) =>
          pair.openings.some((o) => o.id === item.id),
        )
        addWallInterval(walls, openings, wall, face.start, face.end, currentOpenings)
      }
    }
  } else {
    for (const wall of geometry.walls) {
      addWallInterval(walls, openings, wall, wall.start, wall.end, geometry.openings)
    }
  }

  return {
    floor: geometry.footprint,
    voids: (geometry.voids ?? []).map((item) => item.polygon),
    walls,
    openings,
    wallSource: geometry.pdfCalibration ? 'pdf-faces' : 'centerline',
  }
}
