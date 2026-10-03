import type { PlanSolidFace } from './plan-volume'

type Point = PlanSolidFace['points'][number]

/** A viewing cut, not a change to measured geometry. No heights are compressed. */
export function volumeSection(points: readonly Point[], heightCm: number): Point[] {
  const result: Point[] = []
  for (const [index, start] of points.entries()) {
    const end = points[(index + 1) % points.length]
    if (!end) continue
    const startInside = start.zCm <= heightCm
    const endInside = end.zCm <= heightCm
    if (startInside) result.push(start)
    if (startInside !== endInside && start.zCm !== heightCm && end.zCm !== heightCm) {
      const ratio = (heightCm - start.zCm) / (end.zCm - start.zCm)
      result.push({
        xCm: start.xCm + (end.xCm - start.xCm) * ratio,
        yCm: start.yCm + (end.yCm - start.yCm) * ratio,
        zCm: heightCm,
      })
    }
  }
  return result
}
