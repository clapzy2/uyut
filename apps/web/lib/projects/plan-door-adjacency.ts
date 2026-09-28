import type { PlanGeometry, PlanPoint, PlanWall } from '@uyut/db'
import { currentOpeningFacePairs } from './plan-opening-face-pairs'

export type DoorAdjacency = {
  roomIndexes: [number, number]
  openingIds: [string, string]
}

export type DoorAdjacencyReview = {
  /** Only source-backed door pairs with one unambiguous owner on each face. */
  links: DoorAdjacency[]
  /** Rooms grouped by proven links. Separate groups do not prove impassability. */
  provenGroups: number[][]
  /** Stored face pairs rejected or invalidated; unpaired doors are not counted. */
  unresolvedFacePairCount: number
}

function samePoint(first: PlanPoint, second: PlanPoint): boolean {
  return first.xCm === second.xCm && first.yCm === second.yCm
}

function wallBelongsToRoom(wall: PlanWall, polygon: readonly PlanPoint[]): boolean {
  return polygon.some((start, index) => {
    const end = polygon[(index + 1) % polygon.length]
    return (
      end !== undefined &&
      ((samePoint(wall.start, start) && samePoint(wall.end, end)) ||
        (samePoint(wall.start, end) && samePoint(wall.end, start)))
    )
  })
}

/** Door-face evidence proves adjacency, not a collision-free path through either room. */
export function inspectDoorAdjacency(
  geometry: Pick<PlanGeometry, 'walls' | 'openings' | 'rooms' | 'pdfCalibration'>,
): DoorAdjacencyReview {
  const links: DoorAdjacency[] = []
  const currentPairs = currentOpeningFacePairs(geometry)
  let unresolvedFacePairCount =
    (geometry.pdfCalibration?.openingFacePairs?.length ?? 0) - currentPairs.length

  for (const pair of currentPairs) {
    const [first, second] = pair.bindings
    if (
      first.opening.type !== 'door' ||
      second.opening.type !== 'door' ||
      first.opening.id === second.opening.id
    ) {
      unresolvedFacePairCount += 1
      continue
    }

    const owners = [first, second].map(({ wall }) =>
      geometry.rooms.flatMap((room, index) =>
        wallBelongsToRoom(wall, room.polygon) ? [index] : [],
      ),
    )
    const firstOwner = owners[0]?.[0]
    const secondOwner = owners[1]?.[0]
    if (
      owners[0]?.length !== 1 ||
      owners[1]?.length !== 1 ||
      firstOwner === undefined ||
      secondOwner === undefined ||
      firstOwner === secondOwner
    ) {
      unresolvedFacePairCount += 1
      continue
    }

    links.push({
      roomIndexes: [firstOwner, secondOwner],
      openingIds: [first.opening.id, second.opening.id],
    })
  }

  const provenGroups: number[][] = []
  const visited = new Set<number>()
  for (const roomIndex of geometry.rooms.keys()) {
    if (visited.has(roomIndex)) continue
    const group: number[] = []
    const pending = [roomIndex]
    visited.add(roomIndex)
    while (pending.length > 0) {
      const current = pending.pop()
      if (current === undefined) continue
      group.push(current)
      for (const link of links) {
        const neighbour =
          link.roomIndexes[0] === current
            ? link.roomIndexes[1]
            : link.roomIndexes[1] === current
              ? link.roomIndexes[0]
              : undefined
        if (neighbour === undefined || visited.has(neighbour)) continue
        visited.add(neighbour)
        pending.push(neighbour)
      }
    }
    provenGroups.push(group.sort((first, second) => first - second))
  }

  return { links, provenGroups, unresolvedFacePairCount }
}
