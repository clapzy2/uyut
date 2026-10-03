import {
  doorClearanceZone,
  kitchenClearanceZones,
  openingDisplayLabel,
  rectPolygon,
} from '@uyut/catalog/geometry'
import { rectInsideFloor } from '@uyut/catalog/layout'
import type { PlanGeometry, PlanKitchenItem, PlanPoint } from '@uyut/db'
import { z } from 'zod'

export {
  type ClearanceZone,
  doorClearanceZone,
  kitchenClearanceZones,
  rectPolygon,
} from '@uyut/catalog/geometry'

export const openingClearancesSchema = z
  .array(
    z.object({
      id: z.string(),
      clearance: z
        .object({
          side: z.enum(['left', 'right']),
          depthCm: z.number().finite().positive().max(600),
          shape: z.enum(['rectangle', 'swing']).optional(),
          hinge: z.enum(['start', 'end']).optional(),
        })
        .optional(),
      sillHeightCm: z.number().finite().positive().max(600).optional(),
    }),
  )
  .max(200)

const eps = 1e-7

/** SAT for convex zones: touching edges is allowed, positive overlap is not. */
export function polygonsOverlap(a: PlanPoint[], b: PlanPoint[]) {
  for (const polygon of [a, b]) {
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i]
      const q = polygon[(i + 1) % polygon.length]
      if (!p || !q) return false
      const length = Math.hypot(q.xCm - p.xCm, q.yCm - p.yCm)
      if (length < eps) continue
      const nx = -(q.yCm - p.yCm) / length
      const ny = (q.xCm - p.xCm) / length
      const pa = a.map((v) => v.xCm * nx + v.yCm * ny)
      const pb = b.map((v) => v.xCm * nx + v.yCm * ny)
      if (Math.max(...pa) <= Math.min(...pb) + eps || Math.max(...pb) <= Math.min(...pa) + eps)
        return false
    }
  }
  return a.length >= 3 && b.length >= 2
}

export function inspectClearances(items: PlanKitchenItem[], geometry: PlanGeometry) {
  const issues: string[] = []
  const missing: string[] = []
  const zones = items.flatMap(kitchenClearanceZones)
  for (const [index, item] of items.entries()) {
    if (!item.front || item.openingDepthCm === undefined || item.passageCm === undefined)
      missing.push(`Модуль ${index + 1}: уточните фасад, вылет дверцы и проход.`)
    if (!item.installationGaps) missing.push(`Модуль ${index + 1}: монтажные зазоры не заданы.`)
  }
  for (const opening of geometry.openings.filter((o) => o.type !== 'window')) {
    const zone = doorClearanceZone(opening, geometry)
    if (zone) zones.push(zone)
    else missing.push(`${openingDisplayLabel(opening, geometry)}: свободная зона не задана.`)
  }
  for (const zone of zones) {
    for (const [index, item] of items.entries()) {
      if (zone.door || item.id !== zone.ownerId) {
        if (polygonsOverlap(zone.polygon, rectPolygon(item)))
          issues.push(`${zone.label} занята модулем ${index + 1}.`)
      }
    }
    const rect = zone.rect
    if (rect && !geometry.rooms.some((r) => rectInsideFloor(rect, r.polygon)))
      issues.push(`${zone.label} выходит за контур комнаты.`)
    if (
      zone.polygon.some(
        (p) => p.xCm < 0 || p.yCm < 0 || p.xCm > geometry.widthCm || p.yCm > geometry.heightCm,
      )
    )
      issues.push(`${zone.label} выходит за границы плана: проверьте сторону и размеры.`)
    for (const wall of geometry.walls) {
      if (polygonsOverlap(zone.polygon, [wall.start, wall.end]))
        issues.push(`${zone.label} пересекает линию стены ${wall.id}.`)
    }
  }
  return { zones, issues, missing }
}

export function rotateKitchenItem(item: PlanKitchenItem): PlanKitchenItem {
  const directions = { top: 'right', right: 'bottom', bottom: 'left', left: 'top' } as const
  const g = item.installationGaps
  return {
    ...item,
    widthCm: item.depthCm,
    depthCm: item.widthCm,
    ...(item.front ? { front: directions[item.front] } : {}),
    ...(g
      ? { installationGaps: { top: g.left, right: g.top, bottom: g.right, left: g.bottom } }
      : {}),
  }
}
