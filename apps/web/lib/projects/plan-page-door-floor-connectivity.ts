import type { PlanPageContours } from '@uyut/db'
import { difference, type MultiPolygon, type Polygon } from 'polygon-clipping'
import type { PagePoint } from './plan-pdf-linework'
import { pdfContourKey, pdfPointInside } from './plan-pdf-room-binding'

type DoorLocation = { openingId: string; freeComponents: number[] }

export type DoorFloorConnectivity = {
  contourKey: string
  freeComponentCount: number
  doors: DoorLocation[]
  status: 'connected-centerline' | 'disconnected' | 'unresolved' | 'not-applicable'
}

function onRing(point: PagePoint, ring: number[][]): boolean {
  return ring.slice(0, -1).some((start, index) => {
    const end = ring[index + 1]
    if (!end) return false
    const [x = 0, y = 0] = start
    const [endX = 0, endY = 0] = end
    const cross = (endX - x) * (point.y - y) - (endY - y) * (point.x - x)
    return (
      cross === 0 &&
      point.x >= Math.min(x, endX) &&
      point.x <= Math.max(x, endX) &&
      point.y >= Math.min(y, endY) &&
      point.y <= Math.max(y, endY)
    )
  })
}

function inRing(point: PagePoint, ring: number[][]): boolean {
  return (
    onRing(point, ring) ||
    pdfPointInside(
      point,
      ring.map(([x = 0, y = 0]) => ({ x, y })),
    )
  )
}

function inFreeComponent(point: PagePoint, polygon: Polygon): boolean {
  const exterior = polygon[0]
  return (
    !!exterior && inRing(point, exterior) && polygon.slice(1).every((hole) => !inRing(point, hole))
  )
}

/** Topological point connectivity only. No width, turn radius or door-swing certificate. */
export function inspectPlanPageDoorFloorConnectivity(
  contours: PlanPageContours,
  paintedBody: MultiPolygon,
): DoorFloorConnectivity[] {
  return contours.rooms.map((room) => {
    const doors = (room.openings ?? []).filter((opening) => opening.kind === 'door')
    const floor: Polygon = [room.polygon.map((point) => [point.x, point.y])]
    const freeFloor = paintedBody.length > 0 ? difference(floor, paintedBody) : [floor]
    const doorLocations = doors.map((opening) => {
      const center = {
        x: (opening.start.x + opening.end.x) / 2,
        y: (opening.start.y + opening.end.y) / 2,
      }
      return {
        openingId: opening.id,
        freeComponents: freeFloor.flatMap((component, index) =>
          inFreeComponent(center, component) ? [index] : [],
        ),
      }
    })
    const status =
      doors.length < 2
        ? 'not-applicable'
        : doorLocations.some((door) => door.freeComponents.length !== 1)
          ? 'unresolved'
          : doorLocations.every(
                (door) => door.freeComponents[0] === doorLocations[0]?.freeComponents[0],
              )
            ? 'connected-centerline'
            : 'disconnected'
    return {
      contourKey: pdfContourKey(room),
      freeComponentCount: freeFloor.length,
      doors: doorLocations,
      status,
    }
  })
}
