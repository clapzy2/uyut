import type { PlanKitchenItem, PlanPoint } from '@uyut/db'

type Rect = { xCm: number; yCm: number; widthCm: number; depthCm: number }
export type ClearanceZone = {
  id: string
  ownerId: string
  door?: boolean
  label: string
  polygon: PlanPoint[]
  rect?: Rect
}

export function rectPolygon(rect: Rect): PlanPoint[] {
  return [
    { xCm: rect.xCm, yCm: rect.yCm },
    { xCm: rect.xCm + rect.widthCm, yCm: rect.yCm },
    { xCm: rect.xCm + rect.widthCm, yCm: rect.yCm + rect.depthCm },
    { xCm: rect.xCm, yCm: rect.yCm + rect.depthCm },
  ]
}

/** Only supplied opening, access and installation dimensions reserve space. */
export function kitchenClearanceZones(item: PlanKitchenItem, index: number): ClearanceZone[] {
  const zones: ClearanceZone[] = []
  const add = (suffix: string, label: string, rect: Rect) => {
    if (rect.widthCm > 0 && rect.depthCm > 0) {
      zones.push({
        id: `${item.id}-${suffix}`,
        ownerId: item.id,
        label: `Модуль ${index + 1}: ${label}`,
        rect,
        polygon: rectPolygon(rect),
      })
    }
  }
  const depth = (item.openingDepthCm ?? 0) + (item.passageCm ?? 0)
  if (item.front && depth > 0) {
    const rect = { xCm: item.xCm, yCm: item.yCm, widthCm: item.widthCm, depthCm: depth }
    if (item.front === 'top') rect.yCm -= depth
    if (item.front === 'bottom') rect.yCm += item.depthCm
    if (item.front === 'left' || item.front === 'right') {
      rect.widthCm = depth
      rect.depthCm = item.depthCm
      rect.xCm += item.front === 'left' ? -depth : item.widthCm
    }
    add('access', 'открывание и проход', rect)
  }
  const gaps = item.installationGaps
  if (gaps && Object.values(gaps).some((value) => value > 0)) {
    add('mount', 'монтажный габарит', {
      xCm: item.xCm - gaps.left,
      yCm: item.yCm - gaps.top,
      widthCm: item.widthCm + gaps.left + gaps.right,
      depthCm: item.depthCm + gaps.top + gaps.bottom,
    })
  }
  return zones
}
