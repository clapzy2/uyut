import type {
  PlanGeometry,
  PlanOpening,
  PlanOpeningFacePair,
  PlanOpeningWidthProof,
  PlanWall,
  PlanWallFacePair,
} from '@uyut/db'

function sameWall(wall: PlanWall | undefined, snapshot: PlanWall): boolean {
  return (
    wall !== undefined &&
    wall.kind === snapshot.kind &&
    wall.thicknessCm === snapshot.thicknessCm &&
    wall.start.xCm === snapshot.start.xCm &&
    wall.start.yCm === snapshot.start.yCm &&
    wall.end.xCm === snapshot.end.xCm &&
    wall.end.yCm === snapshot.end.yCm
  )
}

function sameOpening(opening: PlanOpening | undefined, snapshot: PlanOpening): boolean {
  return (
    opening !== undefined &&
    opening.type === snapshot.type &&
    opening.wallId === snapshot.wallId &&
    opening.offsetCm === snapshot.offsetCm &&
    opening.widthCm === snapshot.widthCm
  )
}

function sameRoomPolygons(geometry: Pick<PlanGeometry, 'rooms' | 'pdfCalibration'>): boolean {
  const polygons = geometry.pdfCalibration?.wallFaceRoomPolygons
  return (
    polygons !== undefined &&
    polygons.length === geometry.rooms.length &&
    polygons.every((snapshot) =>
      geometry.rooms.some(
        ({ polygon }) =>
          polygon.length === snapshot.length &&
          snapshot.every(
            (point, index) =>
              point.xCm === polygon[index]?.xCm && point.yCm === polygon[index]?.yCm,
          ),
      ),
    )
  )
}

/** A PDF face relation requires unchanged spans, hosts and room interiors. */
export function currentOpeningFacePairs(
  geometry: Pick<PlanGeometry, 'walls' | 'openings' | 'rooms' | 'pdfCalibration'>,
): PlanOpeningFacePair[] {
  if (!sameRoomPolygons(geometry)) return []
  return (geometry.pdfCalibration?.openingFacePairs ?? []).filter((pair) =>
    pair.bindings.every(({ opening: snapshot, wall: host }) => {
      const opening = geometry.openings.find((value) => value.id === snapshot.id)
      const wall = geometry.walls.find((value) => value.id === host.id)
      return sameOpening(opening, snapshot) && sameWall(wall, host)
    }),
  )
}

/** Source strips require unchanged hosts, cuts and the free-floor contours they avoid. */
export function currentWallFacePairs(
  geometry: Pick<PlanGeometry, 'walls' | 'openings' | 'rooms' | 'pdfCalibration'>,
): PlanWallFacePair[] {
  if (!sameRoomPolygons(geometry)) return []
  const sourcePairs =
    geometry.pdfCalibration?.sourceWallFacePairs ?? geometry.pdfCalibration?.wallFacePairs ?? []
  return sourcePairs.filter((pair) => {
    if (
      !pair.faces.every(({ wall }) =>
        sameWall(
          geometry.walls.find((w) => w.id === wall.id),
          wall,
        ),
      )
    )
      return false
    const hostIds = new Set(pair.faces.map(({ wall }) => wall.id))
    const cuts = geometry.openings.filter((opening) => hostIds.has(opening.wallId))
    return (
      cuts.length === pair.openings.length &&
      pair.openings.every((snapshot) =>
        sameOpening(
          cuts.find((opening) => opening.id === snapshot.id),
          snapshot,
        ),
      )
    )
  })
}

/** A printed width cannot remain certified after the owner, cut or host has changed. */
export function currentOpeningWidthProofs(
  geometry: Pick<PlanGeometry, 'walls' | 'openings' | 'rooms' | 'pdfCalibration'>,
): PlanOpeningWidthProof[] {
  if (!sameRoomPolygons(geometry)) return []
  return (geometry.pdfCalibration?.openingWidthProofs ?? []).filter(
    ({ opening, wall, oppositeBinding }) =>
      sameOpening(
        geometry.openings.find((item) => item.id === opening.id),
        opening,
      ) &&
      sameWall(
        geometry.walls.find((item) => item.id === wall.id),
        wall,
      ) &&
      (!oppositeBinding ||
        (sameOpening(
          geometry.openings.find((item) => item.id === oppositeBinding.opening.id),
          oppositeBinding.opening,
        ) &&
          sameWall(
            geometry.walls.find((item) => item.id === oppositeBinding.wall.id),
            oppositeBinding.wall,
          ))),
  )
}
