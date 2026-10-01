import type { PlanGeometry, PlanPageContours } from '@uyut/db'
import { type DoorAdjacency, inspectDoorAdjacency } from './plan-door-adjacency'
import type { PageClearanceRoute } from './plan-page-clearance-route'
import { planPageGeometryElementId } from './plan-page-metric-draft'
import { pdfContourKey } from './plan-pdf-room-binding'

export type PageDoorAccessSide = {
  roomIndex: number
  openingId: string
  sourceOpeningId?: string
  contourKey?: string
  widthCm?: number
  status: PageClearanceRoute['status']
  reason?:
    | PageClearanceRoute['reason']
    | 'room-identity'
    | 'contour-owner'
    | 'opening-owner'
    | 'clearance-result'
    | 'opening-not-reached'
    | 'source-mismatch'
    | 'clearance-width'
}

export type PageDoorAccess = DoorAdjacency & {
  status: 'both-entry-clear' | 'unresolved'
  sides: [PageDoorAccessSide, PageDoorAccessSide]
}

function roomKey(numbers: readonly (number | undefined)[]): string | undefined {
  if (
    numbers.length === 0 ||
    numbers.some((number) => number === undefined || !Number.isInteger(number) || number <= 0) ||
    new Set(numbers).size !== numbers.length
  )
    return undefined
  return [...(numbers as number[])].sort((a, b) => a - b).join('+')
}

/** Fresh clearanceRoutes must come from these contours; checks entries, not threshold travel. */
export function inspectPlanPageDoorAccess(
  geometry: Pick<PlanGeometry, 'walls' | 'openings' | 'rooms' | 'pdfCalibration'>,
  contours: PlanPageContours,
  clearanceRoutes: readonly PageClearanceRoute[],
): PageDoorAccess[] {
  const sourceMatches =
    geometry.pdfCalibration?.sourceSha256 === contours.source.sha256 &&
    geometry.pdfCalibration.pdfPage === contours.source.pdfPage &&
    contours.source.state === 'existing'
  const geometryKeys = geometry.rooms.map((room) =>
    roomKey(room.sourceNumbers ?? [room.sourceNumber]),
  )
  const contourKeys = contours.rooms.map((room) =>
    roomKey(room.roomSourceNumbers ?? [room.roomSourceNumber]),
  )

  function inspectSide(roomIndex: number, openingId: string): PageDoorAccessSide {
    const base = { roomIndex, openingId, status: 'unresolved' as const }
    if (!sourceMatches) return { ...base, reason: 'source-mismatch' }
    const key = geometryKeys[roomIndex]
    if (key === undefined || geometryKeys.filter((value) => value === key).length !== 1)
      return { ...base, reason: 'room-identity' }
    const owners = contours.rooms.filter((_, index) => contourKeys[index] === key)
    if (owners.length !== 1) return { ...base, contourKey: key, reason: 'contour-owner' }
    const contour = owners[0]
    if (!contour) return { ...base, contourKey: key, reason: 'contour-owner' }
    const matches = (contour.openings ?? []).filter(
      (opening) =>
        planPageGeometryElementId(contours.source, key, 'opening', opening.id) === openingId,
    )
    const sourceOpening = matches[0]
    const otherOwner = contours.rooms.some(
      (room) =>
        room !== contour &&
        (room.openings ?? []).some((opening) => opening.id === sourceOpening?.id),
    )
    if (matches.length !== 1 || sourceOpening?.kind !== 'door' || otherOwner)
      return { ...base, contourKey: key, reason: 'opening-owner' }
    const sourceBase = { ...base, contourKey: key, sourceOpeningId: sourceOpening.id }
    const routes = clearanceRoutes.filter((route) => route.contourKey === pdfContourKey(contour))
    if (routes.length !== 1) return { ...sourceBase, reason: 'clearance-result' }
    const route = routes[0]
    if (!route) return { ...sourceBase, reason: 'clearance-result' }
    if (!Number.isFinite(route.widthCm) || route.widthCm <= 0)
      return { ...sourceBase, reason: 'clearance-width' }
    if (
      !route.doorIds.includes(sourceOpening.id) ||
      !route.reachedDoorIds.includes(sourceOpening.id)
    )
      return { ...sourceBase, reason: route.reason ?? 'opening-not-reached' }
    return {
      roomIndex,
      openingId,
      sourceOpeningId: sourceOpening.id,
      contourKey: key,
      widthCm: route.widthCm,
      status: route.status,
      ...(route.reason ? { reason: route.reason } : {}),
    }
  }

  return inspectDoorAdjacency(geometry).links.map((link) => {
    const sides: PageDoorAccess['sides'] = [
      inspectSide(link.roomIndexes[0], link.openingIds[0]),
      inspectSide(link.roomIndexes[1], link.openingIds[1]),
    ]
    const clear = sides.every(
      (side) => side.status === 'entry-clearance' || side.status === 'constructive-route',
    )
    if (clear && sides[0].widthCm !== sides[1].widthCm) {
      for (const side of sides) {
        side.status = 'unresolved'
        side.reason = 'clearance-width'
      }
      return { ...link, sides, status: 'unresolved' }
    }
    return { ...link, sides, status: clear ? 'both-entry-clear' : 'unresolved' }
  })
}
