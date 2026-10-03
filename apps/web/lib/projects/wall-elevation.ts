export type WallElevationOpening = {
  startCm: number
  endCm: number
  bottomCm: number
  heightCm: number
}

export type WallElevationPanel = {
  startCm: number
  endCm: number
  bottomCm: number
  topCm: number
}

const EPSILON_CM = 1e-7

/** Partition a measured wall face around the union of explicitly measured openings. */
export function wallElevationPanels(
  lengthCm: number,
  heightCm: number,
  openings: readonly WallElevationOpening[],
): WallElevationPanel[] | null {
  if (!Number.isFinite(lengthCm) || lengthCm <= 0 || !Number.isFinite(heightCm) || heightCm <= 0)
    return null
  if (
    openings.some(
      (opening) =>
        ![opening.startCm, opening.endCm, opening.bottomCm, opening.heightCm].every(
          Number.isFinite,
        ) ||
        opening.startCm < 0 ||
        opening.endCm > lengthCm ||
        opening.endCm <= opening.startCm ||
        opening.bottomCm < 0 ||
        opening.heightCm <= 0 ||
        opening.bottomCm + opening.heightCm > heightCm + EPSILON_CM,
    )
  )
    return null

  const measuredOpenings = openings.map((opening) => ({
    ...opening,
    topCm: Math.min(heightCm, opening.bottomCm + opening.heightCm),
  }))
  const horizontalCuts = [
    ...new Set([0, lengthCm, ...openings.flatMap((o) => [o.startCm, o.endCm])]),
  ].sort((a, b) => a - b)
  const panels: WallElevationPanel[] = []
  for (let index = 1; index < horizontalCuts.length; index++) {
    const startCm = horizontalCuts[index - 1]
    const endCm = horizontalCuts[index]
    if (startCm === undefined || endCm === undefined) continue
    const active = measuredOpenings.filter((o) => o.startCm < endCm && o.endCm > startCm)
    const verticalCuts = [
      ...new Set([0, heightCm, ...active.flatMap((o) => [o.bottomCm, o.topCm])]),
    ].sort((a, b) => a - b)
    for (let level = 1; level < verticalCuts.length; level++) {
      const bottomCm = verticalCuts[level - 1]
      const topCm = verticalCuts[level]
      if (bottomCm === undefined || topCm === undefined) continue
      if (active.some((o) => o.bottomCm < topCm && o.topCm > bottomCm)) continue
      panels.push({ startCm, endCm, bottomCm, topCm })
    }
  }
  return panels
}
