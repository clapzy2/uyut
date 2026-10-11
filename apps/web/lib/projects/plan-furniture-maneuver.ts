import { compareDecimalSums } from '@uyut/catalog/plan-exact-geometry'
import { signedElevationSum, signedPlanFloors } from '@uyut/catalog/plan-vertical-floor-geometry'
import type { PlanGeometry, PlanPoint } from '@uyut/db'
import polygonClipping, { type MultiPolygon, type Polygon } from 'polygon-clipping'
import { intersectsOpenRectangle } from './plan-source-clearance-route'
import {
  enclosingDecimalSum,
  enclosingTurnBounds,
  enclosingTurnSide,
} from './plan-transfer-enclosure'

export type FurnitureManeuver = {
  carryElevationCm: number
  tilt: 'none' | 'width' | 'depth'
}

export type FurnitureManeuverResult = FurnitureManeuver & {
  carriedHeightCm: number
  sweepHeightCm: number
  stages: Array<{
    roomId: string
    startFloorElevationCm: number
    endFloorElevationCm: number
    liftCm: number
    lowerCm: number
  }>
}

/** A prescribed airborne box path, not a load-bearing stair or human lifting certificate. */
export function furnitureManeuverEnvelope(
  geometry: PlanGeometry,
  upright: { widthCm: number; depthCm: number; heightCm: number },
  maneuver: FurnitureManeuver,
  orientation: 0 | 90,
  allowTurns: boolean,
) {
  const signed = signedPlanFloors(geometry)
  if (!signed?.ok) return undefined
  const dimension = maneuver.tilt === 'width' ? upright.widthCm : upright.depthCm
  const diagonal =
    maneuver.tilt === 'none' ? upright.heightCm : enclosingTurnSide(dimension, upright.heightCm)
  if (diagonal === undefined) return undefined
  const carried = {
    widthCm: maneuver.tilt === 'width' ? upright.heightCm : upright.widthCm,
    depthCm: maneuver.tilt === 'depth' ? upright.heightCm : upright.depthCm,
    heightCm: maneuver.tilt === 'none' ? upright.heightCm : dimension,
  }
  const sweep = {
    widthCm: maneuver.tilt === 'width' ? diagonal : upright.widthCm,
    depthCm: maneuver.tilt === 'depth' ? diagonal : upright.depthCm,
  }
  // At each pitch angle the XY centre stays fixed and the Z centre follows
  // half the rotated height. Both rotated extents are at most the diagonal,
  // so the entire continuous motion stays above base and below base + diagonal.
  if (orientation === 90) {
    const carriedWidth = carried.widthCm
    carried.widthCm = carried.depthCm
    carried.depthCm = carriedWidth
    const sweepWidth = sweep.widthCm
    sweep.widthCm = sweep.depthCm
    sweep.depthCm = sweepWidth
  }
  if (allowTurns) {
    const side = Math.max(sweep.widthCm, sweep.depthCm)
    sweep.widthCm = side
    sweep.depthCm = side
  }
  const obstacles: Polygon[] = [
    ...(geometry.obstacles ?? []),
    ...(geometry.kitchenItems ?? []),
  ].map((obstacle) => [
    [
      [obstacle.xCm, obstacle.yCm],
      [enclosingDecimalSum([obstacle.xCm, obstacle.widthCm]), obstacle.yCm],
      [
        enclosingDecimalSum([obstacle.xCm, obstacle.widthCm]),
        enclosingDecimalSum([obstacle.yCm, obstacle.depthCm]),
      ],
      [obstacle.xCm, enclosingDecimalSum([obstacle.yCm, obstacle.depthCm])],
    ],
  ])
  const floors = geometry.rooms.map((room) => {
    const floor = signed.reference.floors.find(
      (floor) =>
        floor.room.name === room.name &&
        floor.room.polygon.length === room.polygon.length &&
        floor.room.polygon.every((point, index) => {
          const other = room.polygon[index]
          return other?.xCm === point.xCm && other.yCm === point.yCm
        }),
    )
    const ceiling = signed.reference.ceilings?.find((ceiling) => ceiling.floorId === floor?.id)
    if (
      floor?.surface !== 'finished-floor' ||
      !ceiling ||
      maneuver.carryElevationCm < floor.elevationCm ||
      compareDecimalSums([maneuver.carryElevationCm, diagonal], [ceiling.elevationCm]) > 0
    )
      return undefined
    const surfaces: MultiPolygon = signed.surfaces
      .filter((surface) => surface.floorId === floor.id)
      .map((surface) => [
        surface.floor.map(({ xCm, yCm }) => [xCm, yCm]),
        ...surface.voids.map((hole) => hole.map(({ xCm, yCm }) => [xCm, yCm] as [number, number])),
      ])
    const first = surfaces[0]
    if (!first) return undefined
    const union = polygonClipping.union(first, ...surfaces.slice(1))
    return {
      elevationCm: floor.elevationCm,
      free: obstacles.length ? polygonClipping.difference(union, ...obstacles) : union,
    }
  })
  let startFloorElevationCm: number | undefined
  const endpointCheck = (point: PlanPoint, roomId?: string): boolean => {
    // Prove the whole endpoint box, including numerical cancellation near zero.
    const horizontal = enclosingTurnBounds(point, sweep.widthCm, 0, sweep.widthCm)
    const vertical = enclosingTurnBounds(point, sweep.depthCm, 0, sweep.depthCm)
    if (!horizontal || !vertical) return false
    const [left, , right] = horizontal
    const [, top, , bottom] = vertical
    if (geometry.walls.some((wall) => intersectsOpenRectangle(wall, left, top, right, bottom)))
      return false
    const envelope: Polygon = [
      [
        [left, top],
        [right, top],
        [right, bottom],
        [left, bottom],
      ],
    ]
    const owners = floors.flatMap((floor, index) =>
      floor &&
      (roomId === undefined || roomId === String(index)) &&
      polygonClipping.difference(envelope, floor.free).length === 0
        ? [floor]
        : [],
    )
    if (owners.length !== 1 || !owners[0]) return false
    if (roomId === undefined) startFloorElevationCm = owners[0].elevationCm
    return true
  }
  return {
    carried,
    sweepHeightCm: diagonal,
    endpointCheck,
    stages: (routes: Array<{ roomId: string }>): FurnitureManeuverResult['stages'] => {
      if (startFloorElevationCm === undefined) return []
      const start = startFloorElevationCm
      return routes.flatMap(({ roomId }) => {
        const floor = floors[Number(roomId)]
        return floor
          ? [
              {
                roomId,
                startFloorElevationCm: start,
                endFloorElevationCm: floor.elevationCm,
                liftCm: signedElevationSum(maneuver.carryElevationCm, -start),
                lowerCm: signedElevationSum(maneuver.carryElevationCm, -floor.elevationCm),
              },
            ]
          : []
      })
    },
  }
}
