import type { PlanGeometry, PlanPoint } from '@uyut/db'

export type WallSpan = {
  id: string
  start: PlanPoint
  end: PlanPoint
  kind: 'outer' | 'inner'
}

export type OpeningSpan = {
  id: string
  type: 'door' | 'window' | 'balcony'
  start: PlanPoint
  end: PlanPoint
}

function interpolate(start: PlanPoint, end: PlanPoint, ratio: number): PlanPoint {
  return {
    xCm: start.xCm + (end.xCm - start.xCm) * ratio,
    yCm: start.yCm + (end.yCm - start.yCm) * ratio,
  }
}

/** Split centreline walls at openings. PDF boundary faces are not centrelines. */
export function planVolume(geometry: PlanGeometry): {
  floor: PlanPoint[]
  voids: PlanPoint[][]
  walls: WallSpan[]
  openings: OpeningSpan[]
} | null {
  if (
    geometry.status !== 'confirmed' ||
    geometry.pdfCalibration ||
    !geometry.footprint ||
    geometry.footprint.length < 3
  ) {
    return null
  }

  const walls: WallSpan[] = []
  const openings: OpeningSpan[] = []

  for (const wall of geometry.walls) {
    const length = Math.hypot(wall.end.xCm - wall.start.xCm, wall.end.yCm - wall.start.yCm)
    if (length <= 0) continue

    const cuts = geometry.openings
      .filter((opening) => opening.wallId === wall.id && opening.widthCm > 0)
      .map((opening) => ({
        opening,
        start: Math.max(0, opening.offsetCm),
        end: Math.min(length, opening.offsetCm + opening.widthCm),
      }))
      .filter((cut) => cut.end > cut.start)
      .sort((a, b) => a.start - b.start)

    let cursor = 0
    for (const cut of cuts) {
      if (cut.start > cursor) {
        walls.push({
          id: `${wall.id}-${cursor}`,
          start: interpolate(wall.start, wall.end, cursor / length),
          end: interpolate(wall.start, wall.end, cut.start / length),
          kind: wall.kind,
        })
      }
      openings.push({
        id: cut.opening.id,
        type: cut.opening.type,
        start: interpolate(wall.start, wall.end, cut.start / length),
        end: interpolate(wall.start, wall.end, cut.end / length),
      })
      cursor = Math.max(cursor, cut.end)
    }
    if (cursor < length) {
      walls.push({
        id: `${wall.id}-${cursor}`,
        start: interpolate(wall.start, wall.end, cursor / length),
        end: wall.end,
        kind: wall.kind,
      })
    }
  }

  return {
    floor: geometry.footprint,
    voids: (geometry.voids ?? []).map((item) => item.polygon),
    walls,
    openings,
  }
}
