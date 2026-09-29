import type { PlanGeometry, PlanOpening, PlanPoint, PlanWall } from '@uyut/db'
import { currentOpeningFacePairs, currentOpeningWidthProofs } from './plan-opening-face-pairs'

export type DoorAdjacency = {
  roomIndexes: [number, number]
  openingIds: [string, string]
}

export type DoorAdjacencyReview = {
  /** Source-backed door faces or a proven common threshold with distinct room owners. */
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

function uniqueRoomOwner(wall: PlanWall, rooms: PlanGeometry['rooms']): number | undefined {
  const owners = rooms.flatMap((room, index) =>
    wallBelongsToRoom(wall, room.polygon) ? [index] : [],
  )
  return owners.length === 1 ? owners[0] : undefined
}

function openingCut(opening: PlanOpening, wall: PlanWall): [PlanPoint, PlanPoint] | undefined {
  const length = Math.hypot(wall.end.xCm - wall.start.xCm, wall.end.yCm - wall.start.yCm)
  if (
    length === 0 ||
    opening.widthCm <= 0 ||
    opening.offsetCm < 0 ||
    opening.offsetCm + opening.widthCm > length + 0.1
  )
    return undefined
  const pointAt = (distance: number): PlanPoint => ({
    xCm:
      Math.round((wall.start.xCm + ((wall.end.xCm - wall.start.xCm) * distance) / length) * 10) /
      10,
    yCm:
      Math.round((wall.start.yCm + ((wall.end.yCm - wall.start.yCm) * distance) / length) * 10) /
      10,
  })
  return [pointAt(opening.offsetCm), pointAt(opening.offsetCm + opening.widthCm)]
}

function sameCut(first: [PlanPoint, PlanPoint], second: [PlanPoint, PlanPoint]): boolean {
  return (
    (samePoint(first[0], second[0]) && samePoint(first[1], second[1])) ||
    (samePoint(first[0], second[1]) && samePoint(first[1], second[0]))
  )
}

/** Source-backed door evidence proves adjacency, not a clear path through either room. */
export function inspectDoorAdjacency(
  geometry: Pick<PlanGeometry, 'walls' | 'openings' | 'rooms' | 'pdfCalibration'>,
): DoorAdjacencyReview {
  const links: DoorAdjacency[] = []
  const linkedOpeningIds = new Set<string>()
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

    const firstOwner = uniqueRoomOwner(first.wall, geometry.rooms)
    const secondOwner = uniqueRoomOwner(second.wall, geometry.rooms)
    if (firstOwner === undefined || secondOwner === undefined || firstOwner === secondOwner) {
      unresolvedFacePairCount += 1
      continue
    }

    links.push({
      roomIndexes: [firstOwner, secondOwner],
      openingIds: [first.opening.id, second.opening.id],
    })
    linkedOpeningIds.add([first.opening.id, second.opening.id].sort().join('|'))
  }

  for (const proof of currentOpeningWidthProofs(geometry)) {
    const opposite = proof.oppositeBinding
    if (!proof.sameOpeningAs || !opposite) continue
    const first = proof.opening
    const second = opposite.opening
    if (first.type !== 'door' || second.type !== 'door' || first.id === second.id) continue
    const firstCut = openingCut(first, proof.wall)
    const secondCut = openingCut(second, opposite.wall)
    if (!firstCut || !secondCut || !sameCut(firstCut, secondCut)) continue
    const openingKey = [first.id, second.id].sort().join('|')
    if (linkedOpeningIds.has(openingKey)) continue
    const firstOwner = uniqueRoomOwner(proof.wall, geometry.rooms)
    const secondOwner = uniqueRoomOwner(opposite.wall, geometry.rooms)
    if (firstOwner === undefined || secondOwner === undefined || firstOwner === secondOwner)
      continue
    links.push({ roomIndexes: [firstOwner, secondOwner], openingIds: [first.id, second.id] })
    linkedOpeningIds.add(openingKey)
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
