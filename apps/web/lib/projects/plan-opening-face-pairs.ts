import type { PlanGeometry, PlanOpeningFacePair } from '@uyut/db'

/** A PDF face relation is evidence only while both annotated spans and hosts are unchanged. */
export function currentOpeningFacePairs(
  geometry: Pick<PlanGeometry, 'walls' | 'openings' | 'pdfCalibration'>,
): PlanOpeningFacePair[] {
  return (geometry.pdfCalibration?.openingFacePairs ?? []).filter((pair) =>
    pair.bindings.every(({ opening: snapshot, wall: host }) => {
      const opening = geometry.openings.find((value) => value.id === snapshot.id)
      const wall = geometry.walls.find((value) => value.id === host.id)
      return (
        opening !== undefined &&
        wall !== undefined &&
        opening.type === snapshot.type &&
        opening.wallId === snapshot.wallId &&
        opening.offsetCm === snapshot.offsetCm &&
        opening.widthCm === snapshot.widthCm &&
        wall.kind === host.kind &&
        wall.thicknessCm === host.thicknessCm &&
        wall.start.xCm === host.start.xCm &&
        wall.start.yCm === host.start.yCm &&
        wall.end.xCm === host.end.xCm &&
        wall.end.yCm === host.end.yCm
      )
    }),
  )
}
