import type { PlanPoint } from '@uyut/db'
import polygonClipping, { type MultiPolygon, type Polygon } from 'polygon-clipping'

const { difference, intersection, union } = polygonClipping

type SourceRegion = { id: string; polygon: PlanPoint[] }
type SourceOpening = SourceRegion & {
  kind: 'door' | 'entrance' | 'window'
  /** Longitudinal axis extracted from the source rectangle, in the same centimetre system. */
  axis: [PlanPoint, PlanPoint]
}

export type SourceDoorConnection = {
  openingId: string
  kind: 'door' | 'entrance'
  roomIds: string[]
  hostWallId?: string
  widthCm: number
  status: 'connected-portal' | 'unresolved'
  reason?: 'floor-owners' | 'same-side' | 'wall-host' | 'blocked-portal'
}

function polygon(points: readonly PlanPoint[]): Polygon {
  return [points.map(({ xCm, yCm }) => [xCm, yCm])]
}

function area(body: MultiPolygon): number {
  return body.reduce(
    (total, component) =>
      total +
      component.reduce((sum, ring, index) => {
        const twice = ring.reduce((value, point, pointIndex) => {
          const next = ring[(pointIndex + 1) % ring.length]
          return next
            ? value + (point[0] ?? 0) * (next[1] ?? 0) - (next[0] ?? 0) * (point[1] ?? 0)
            : value
        }, 0)
        return sum + ((index === 0 ? 1 : -1) * Math.abs(twice)) / 2
      }, 0),
    0,
  )
}

function merge(polygons: Polygon[]): MultiPolygon {
  const [first, ...rest] = polygons
  return first ? union(first, ...rest) : []
}

function side(body: MultiPolygon, axis: SourceOpening['axis']): number {
  const [start, end] = axis
  const offsets = body.flatMap((component) =>
    (component[0] ?? []).map(
      ([x = 0, y = 0]) =>
        (end.xCm - start.xCm) * (y - start.yCm) - (end.yCm - start.yCm) * (x - start.xCm),
    ),
  )
  if (offsets.length === 0) return 0
  if (offsets.every((value) => value > 0)) return 1
  if (offsets.every((value) => value < 0)) return -1
  return 0
}

/** Topology of validated source polygons. No snapping, door swing or minimum-width certificate. */
export function inspectSourceDoorConnectivity(input: {
  rooms: SourceRegion[]
  walls: SourceRegion[]
  openings: SourceOpening[]
  voids: SourceRegion[]
}) {
  const rooms = input.rooms.map((room) => ({ ...room, body: polygon(room.polygon) }))
  const walls = input.walls.map((wall) => ({ ...wall, body: polygon(wall.polygon) }))
  const portals = input.openings
    .filter((opening) => opening.kind !== 'window')
    .map((opening) => {
      const body = polygon(opening.polygon)
      const owners = rooms.flatMap((room) => {
        const overlap = intersection(body, room.body)
        return area(overlap) > 0
          ? [{ id: room.id, overlap, side: side(overlap, opening.axis) }]
          : []
      })
      const hosts = walls.filter((wall) => area(intersection(body, wall.body)) > 0)
      const base = {
        openingId: opening.id,
        kind: opening.kind as 'door' | 'entrance',
        roomIds: owners.map((owner) => owner.id),
        widthCm: Math.hypot(
          opening.axis[1].xCm - opening.axis[0].xCm,
          opening.axis[1].yCm - opening.axis[0].yCm,
        ),
      }
      const reason: SourceDoorConnection['reason'] =
        owners.length !== (opening.kind === 'entrance' ? 1 : 2)
          ? 'floor-owners'
          : owners.some((owner) => owner.side === 0) ||
              (owners.length === 2 && owners[0]?.side === owners[1]?.side)
            ? 'same-side'
            : hosts.length !== 1
              ? 'wall-host'
              : undefined
      const connection: SourceDoorConnection = {
        ...base,
        ...(hosts[0] ? { hostWallId: hosts[0].id } : {}),
        status: 'unresolved',
        ...(reason ? { reason } : {}),
      }
      return { body, owners, connection }
    })

  const candidates = portals.filter((portal) => !portal.connection.reason)
  const remainingWalls = walls.flatMap((wall) => {
    const cuts = candidates
      .filter((portal) => portal.connection.hostWallId === wall.id)
      .map((portal) => portal.body)
    return cuts.length ? difference(wall.body, ...cuts) : [wall.body]
  })
  const floorAndPortals = merge([
    ...rooms.map((room) => room.body),
    ...candidates.map((portal) => portal.body),
  ])
  const obstacles = [...remainingWalls, ...input.voids.map((region) => polygon(region.polygon))]
  const freeFloor = obstacles.length ? difference(floorAndPortals, ...obstacles) : floorAndPortals

  for (const portal of candidates) {
    const freePortal = intersection(portal.body, freeFloor)
    const ownerComponents = portal.owners.map((owner) =>
      freePortal.flatMap((component, index) =>
        area(intersection(component, owner.overlap)) > 0 ? [index] : [],
      ),
    )
    const common = ownerComponents[0]?.filter((index) =>
      ownerComponents.every((components) => components.includes(index)),
    )
    // One interior owner cannot reveal a blocked exterior half of an entrance.
    const entranceClear =
      portal.connection.kind !== 'entrance' || area(difference(portal.body, freeFloor)) <= 1e-7
    if (entranceClear && freePortal.length === 1 && common?.length === 1)
      portal.connection.status = 'connected-portal'
    else portal.connection.reason = 'blocked-portal'
  }

  const roomComponents = rooms.map((room) => ({
    roomId: room.id,
    freeComponents: freeFloor.flatMap((component, index) =>
      area(intersection(component, room.body)) > 0 ? [index] : [],
    ),
  }))
  const entrances = portals.filter(
    (portal) =>
      portal.connection.kind === 'entrance' && portal.connection.status === 'connected-portal',
  )
  const reached = new Set<string>()
  if (entrances.length === 1) {
    const entranceRoom = entrances[0]?.connection.roomIds[0]
    if (entranceRoom) reached.add(entranceRoom)
    let changed = true
    while (changed) {
      changed = false
      for (const { connection } of portals) {
        if (
          connection.status !== 'connected-portal' ||
          !connection.roomIds.some((id) => reached.has(id))
        )
          continue
        for (const id of connection.roomIds) {
          if (!reached.has(id)) {
            reached.add(id)
            changed = true
          }
        }
      }
    }
  }
  const connected =
    entrances.length === 1 &&
    reached.size === rooms.length &&
    portals.length > 0 &&
    portals.every((portal) => portal.connection.status === 'connected-portal') &&
    roomComponents.length > 0 &&
    roomComponents.every(
      (room) =>
        room.freeComponents.length === 1 &&
        room.freeComponents[0] === roomComponents[0]?.freeComponents[0],
    )
  return {
    status: connected ? ('connected-topology' as const) : ('unresolved' as const),
    freeComponentCount: freeFloor.length,
    freeFloor,
    reachedRoomIds: [...reached],
    roomComponents,
    doors: portals.map((portal) => portal.connection),
  }
}
