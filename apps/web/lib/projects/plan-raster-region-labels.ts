import {
  type RasterPointMembership,
  type RasterRegionPoint,
  validRasterRegionPolygon,
} from './plan-raster-regions'

export type RegionLabelFrame = { sha256: string; width: number; height: number; page: number }
export type ObservedRegionLabel = { id: string; name: string; point: RasterRegionPoint }

function validFrame(frame: RegionLabelFrame) {
  return (
    /^[a-f0-9]{64}$/.test(frame.sha256) &&
    Number.isInteger(frame.width) &&
    Number.isInteger(frame.height) &&
    frame.width >= 1 &&
    frame.width <= 2000 &&
    frame.height >= 1 &&
    frame.height <= 2000 &&
    Number.isInteger(frame.page) &&
    frame.page >= 1 &&
    frame.page <= 9999
  )
}

function containsLabel(point: RasterRegionPoint, polygon: RasterRegionPoint[]) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j]
    if (!a || !b) return false
    const cross = (point.x - a.x) * (b.y - a.y) - (point.y - a.y) * (b.x - a.x)
    if (
      Math.abs(cross) < 1e-6 &&
      point.x >= Math.min(a.x, b.x) &&
      point.x <= Math.max(a.x, b.x) &&
      point.y >= Math.min(a.y, b.y) &&
      point.y <= Math.max(a.y, b.y)
    )
      return false
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside
  }
  return inside
}

/** Bind native/reviewed caption positions, never coordinates guessed by this function or an LLM. */
export function bindObservedRegionLabels(input: {
  regionSource: RegionLabelFrame
  labelSource: RegionLabelFrame
  regions: { id: string; polygon: RasterRegionPoint[] }[]
  labels: ObservedRegionLabel[]
  pixelMembership?: { source: RegionLabelFrame; points: RasterPointMembership[] }
}) {
  const { regionSource: frame, labelSource, regions, labels } = input
  if (
    !validFrame(frame) ||
    !validFrame(labelSource) ||
    frame.sha256 !== labelSource.sha256 ||
    frame.page !== labelSource.page ||
    frame.width !== labelSource.width ||
    frame.height !== labelSource.height
  )
    throw new Error('Caption and region source frames differ')
  if (
    !Array.isArray(regions) ||
    !Array.isArray(labels) ||
    regions.length > 50 ||
    labels.length > 50
  )
    throw new Error('Too many region labels')
  const validText = (value: string) =>
    typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 120
  const validPoint = (point: RasterRegionPoint) =>
    point &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.x >= 0 &&
    point.x <= frame.width &&
    point.y >= 0 &&
    point.y <= frame.height
  if (
    new Set(regions.map((region) => region.id)).size !== regions.length ||
    regions.some(
      (region) =>
        !validText(region.id) ||
        !Array.isArray(region.polygon) ||
        region.polygon.some((point) => !validPoint(point)) ||
        !validRasterRegionPolygon(region.polygon),
    )
  )
    throw new Error('Invalid source region')
  if (
    new Set(labels.map((label) => label.id)).size !== labels.length ||
    labels.some(
      (label) => !validText(label.id) || !validText(label.name) || !validPoint(label.point),
    )
  )
    throw new Error('Invalid observed caption')
  const membership = input.pixelMembership
  if (membership && (!Array.isArray(membership.points) || membership.points.length > 50))
    throw new Error('Too many pixel membership points')
  const membershipsById = new Map(membership?.points.map((point) => [point.id, point]))
  if (membership) {
    const source = membership.source
    const regionIds = new Set(regions.map((region) => region.id))
    if (
      !validFrame(source) ||
      source.sha256 !== frame.sha256 ||
      source.page !== frame.page ||
      source.width !== frame.width ||
      source.height !== frame.height ||
      membership.points.length !== labels.length ||
      membershipsById.size !== labels.length ||
      labels.some((label) => {
        const sample = membershipsById.get(label.id)
        return (
          !sample ||
          sample.point.x !== label.point.x ||
          sample.point.y !== label.point.y ||
          (sample.regionId !== null && !regionIds.has(sample.regionId))
        )
      })
    )
      throw new Error('Pixel membership does not match source captions')
  }
  const candidates = labels.map((label) => ({
    label,
    // Unknown (ink/ignored/rejected) samples still compete spatially, but cannot be assigned.
    regions: regions.filter((region) => {
      const sample = membershipsById.get(label.id)
      return (
        (!sample || sample.regionId === null || sample.regionId === region.id) &&
        containsLabel(label.point, region.polygon)
      )
    }),
  }))
  const groups = new Map<string, ObservedRegionLabel[]>()
  const uniqueLabelIds = new Set(
    candidates
      .filter(
        (entry) =>
          entry.regions.length === 1 &&
          (!membership || membershipsById.get(entry.label.id)?.regionId !== null),
      )
      .map((entry) => entry.label.id),
  )
  for (const entry of candidates) {
    for (const region of entry.regions) {
      const group = groups.get(region.id) ?? []
      group.push(entry.label)
      groups.set(region.id, group)
    }
  }
  const assignments: { labelId: string; name: string; regionId: string }[] = []
  const ambiguities: { regionId: string; labelIds: string[] }[] = []
  for (const [regionId, group] of groups) {
    const label = group[0]
    if (group.length === 1 && label && uniqueLabelIds.has(label.id))
      assignments.push({ labelId: label.id, name: label.name, regionId })
    else if (group.length > 1)
      ambiguities.push({ regionId, labelIds: group.map((label) => label.id) })
  }
  const assignedIds = new Set(assignments.map((assignment) => assignment.labelId))
  const assignedRegions = new Set(assignments.map((assignment) => assignment.regionId))
  return {
    status: 'draft' as const,
    assignments,
    unresolvedLabelIds: labels
      .filter((label) => !assignedIds.has(label.id))
      .map((label) => label.id),
    ignoredRegionIds: regions
      .filter((region) => !assignedRegions.has(region.id))
      .map((region) => region.id),
    ambiguities,
    overlappingLabelIds: candidates
      .filter((entry) => entry.regions.length > 1)
      .map((entry) => entry.label.id),
  }
}
