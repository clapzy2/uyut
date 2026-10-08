import type { NativeTextAnchors } from './plan-document'
import { bindObservedRegionLabels, type RegionLabelFrame } from './plan-raster-region-labels'
import type { RasterRegionPoint } from './plan-raster-regions'

export type ReviewedNumberedCaptions = {
  review: 'manual-source-review'
  source: RegionLabelFrame
  rows: { sourceNumber: number; numberLabelId: string; nameLabelId: string }[]
  markers: { sourceNumber: number; labelId: string }[]
}

/** Review-selected text IDs only. Never classify every short dimension as a room number. */
export function bindReviewedNumberedCaptions(input: {
  regionSource: RegionLabelFrame
  regions: { id: string; polygon: RasterRegionPoint[] }[]
  native: NativeTextAnchors
  reviewed: ReviewedNumberedCaptions
}) {
  const { native, reviewed } = input
  if (!native.complete || reviewed.review !== 'manual-source-review')
    throw new Error('Complete native text and explicit source review required')
  // Validate both frames against the same source before interpreting selected text IDs.
  for (const source of [native.source, reviewed.source]) {
    bindObservedRegionLabels({
      regionSource: input.regionSource,
      labelSource: source,
      regions: input.regions,
      labels: [],
    })
  }
  if (
    native.labels.length > 1000 ||
    reviewed.rows.length > 50 ||
    reviewed.markers.length > 50 ||
    new Set(native.labels.map((label) => label.id)).size !== native.labels.length
  )
    throw new Error('Invalid numbered caption inventory')
  const labelsById = new Map(native.labels.map((label) => [label.id, label]))
  const selectedLabel = (id: string) => {
    const label = labelsById.get(id)
    if (
      !label?.name ||
      label.name !== label.name.trim() ||
      label.name.length > 120 ||
      !Number.isFinite(label.point.x) ||
      !Number.isFinite(label.point.y) ||
      label.point.x < 0 ||
      label.point.x > native.source.width ||
      label.point.y < 0 ||
      label.point.y > native.source.height
    )
      throw new Error('Invalid selected native text ID')
    return label
  }
  const matchesNumber = (text: string, number: number) =>
    Number.isInteger(number) &&
    number >= 1 &&
    number <= 99 &&
    /^0?[1-9]\d?$/.test(text) &&
    Number(text) === number
  const rowIds = new Set<string>()
  const rows = new Map<number, { name: string; numberLabelId: string; nameLabelId: string }>()
  for (const row of reviewed.rows) {
    const number = selectedLabel(row.numberLabelId)
    const name = selectedLabel(row.nameLabelId)
    if (
      rows.has(row.sourceNumber) ||
      rowIds.has(number.id) ||
      rowIds.has(name.id) ||
      number.id === name.id ||
      !matchesNumber(number.name, row.sourceNumber) ||
      /^\d+[.,]?\d*$/.test(name.name) ||
      number.point.x >= name.point.x ||
      Math.abs(number.point.y - name.point.y) > native.source.height * 0.002
    )
      throw new Error('Invalid reviewed horizontal schedule row')
    rowIds.add(number.id)
    rowIds.add(name.id)
    rows.set(row.sourceNumber, { name: name.name, numberLabelId: number.id, nameLabelId: name.id })
  }
  const markerIds = new Set<string>()
  const markersByNumber = new Map<number, NativeTextAnchors['labels']>()
  for (const marker of reviewed.markers) {
    const label = selectedLabel(marker.labelId)
    if (
      !rows.has(marker.sourceNumber) ||
      rowIds.has(label.id) ||
      markerIds.has(label.id) ||
      !matchesNumber(label.name, marker.sourceNumber)
    )
      throw new Error('Invalid reviewed interior room marker')
    markerIds.add(label.id)
    const group = markersByNumber.get(marker.sourceNumber) ?? []
    group.push(label)
    markersByNumber.set(marker.sourceNumber, group)
  }
  const unresolvedSourceNumbers: number[] = []
  const evidence: {
    sourceNumber: number
    numberLabelId: string
    nameLabelId: string
    markerLabelId: string
  }[] = []
  const namedMarkers: NativeTextAnchors['labels'] = []
  const ambiguousMarkerIds = new Set<string>()
  for (const [sourceNumber, row] of rows) {
    const candidates = markersByNumber.get(sourceNumber) ?? []
    for (const candidate of candidates) {
      namedMarkers.push({ id: candidate.id, name: row.name, point: candidate.point })
    }
    const marker = candidates[0]
    if (candidates.length !== 1 || !marker) {
      unresolvedSourceNumbers.push(sourceNumber)
      for (const candidate of candidates) ambiguousMarkerIds.add(candidate.id)
      continue
    }
    evidence.push({
      sourceNumber,
      numberLabelId: row.numberLabelId,
      nameLabelId: row.nameLabelId,
      markerLabelId: marker.id,
    })
  }
  const binding = bindObservedRegionLabels({
    regionSource: input.regionSource,
    labelSource: native.source,
    regions: input.regions,
    labels: namedMarkers,
  })
  // Ambiguous number occurrences still compete for regions, but cannot receive assignments.
  const assignments = binding.assignments.filter((entry) => !ambiguousMarkerIds.has(entry.labelId))
  const assignedIds = new Set(assignments.map((entry) => entry.labelId))
  const assignedRegionIds = new Set(assignments.map((entry) => entry.regionId))
  const unresolvedLabelIds = namedMarkers
    .filter((label) => !assignedIds.has(label.id))
    .map((label) => label.id)
  const unresolvedIds = new Set(unresolvedLabelIds)
  for (const entry of evidence) {
    if (unresolvedIds.has(entry.markerLabelId)) unresolvedSourceNumbers.push(entry.sourceNumber)
  }
  return {
    ...binding,
    assignments,
    unresolvedLabelIds,
    ignoredRegionIds: input.regions
      .filter((region) => !assignedRegionIds.has(region.id))
      .map((region) => region.id),
    evidence,
    unresolvedSourceNumbers,
  }
}
