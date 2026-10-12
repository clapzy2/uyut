import { isPlanRoomSourceNumber } from '@uyut/db/source-room-number'
import type { NativeTextAnchors } from './plan-document'
import { exactNativeOrientation, exactNativeSegmentsTouch } from './plan-native-exact-intersections'
import { nativeFillCandidates } from './plan-native-fill-candidates'
import { nativeRoomFrameFaceCandidates } from './plan-native-room-frame-faces'
import { nativeRoomScheduleEvidence } from './plan-native-room-schedule'
import { nativeStrokeCycleCandidates } from './plan-native-stroke-candidates'
import type { PagePoint, PdfLinework } from './plan-pdf-linework'
import { type NativePageSegment, nativePageSegments } from './plan-pdf-opening-endpoint'
import { pdfBoundaryDistance, pdfPointInside } from './plan-pdf-room-binding'
import { bindObservedRegionLabels, type RegionLabelFrame } from './plan-raster-region-labels'

type Box = { left: number; top: number; right: number; bottom: number }
type FrameCue = { bounds: Box; sides: NativePageSegment[]; uncertain: boolean }
const verticalKey = (x: number, top: number, bottom: number) => `${x}:${top}:${bottom}`

/** Exact outline identity only; bounded cuts may add redundant collinear vertices.
 * Source polygons/evidence are never simplified, snapped or moved by this key.
 */
export function nativeRoomPolygonKey(polygon: readonly PagePoint[]): string {
  const corners = polygon.filter((point, index) => {
    const previous = polygon[(index + polygon.length - 1) % polygon.length]
    const next = polygon[(index + 1) % polygon.length]
    return (
      !previous ||
      !next ||
      exactNativeOrientation(previous, point, next) !== 0 ||
      point.x < Math.min(previous.x, next.x) ||
      point.x > Math.max(previous.x, next.x) ||
      point.y < Math.min(previous.y, next.y) ||
      point.y > Math.max(previous.y, next.y)
    )
  })
  const beginning = corners.reduce((best, point, index) => {
    const current = corners[best]
    return !current || point.x < current.x || (point.x === current.x && point.y < current.y)
      ? index
      : best
  }, 0)
  return [...corners.slice(beginning), ...corners.slice(0, beginning)]
    .map((point) => `${point.x}:${point.y}`)
    .join('|')
}

function frameInsidePolygon(work: PdfLinework, box: Box, polygon: PagePoint[]): boolean {
  const corners = [
    { x: box.left, y: box.top },
    { x: box.right, y: box.top },
    { x: box.right, y: box.bottom },
    { x: box.left, y: box.bottom },
  ]
  if (
    corners.some(
      (point) =>
        !pdfPointInside(point, polygon) || pdfBoundaryDistance(work, point, polygon) <= 0.12,
    )
  )
    return false
  // Four contained corners alone can miss a narrow concavity crossing a frame edge.
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index]
    const b = polygon[(index + 1) % polygon.length]
    if (!a || !b) return false
    for (let side = 0; side < corners.length; side++) {
      const c = corners[side]
      const d = corners[(side + 1) % corners.length]
      if (!c || !d) return false
      if (exactNativeSegmentsTouch({ start: a, end: b }, { start: c, end: d }) !== false)
        return false
    }
  }
  return true
}

function captionFrames(
  work: PdfLinework,
  native: NativeTextAnchors,
  labels: NativeTextAnchors['labels'],
) {
  const scale = native.pageNormalizedScale
  if (!scale) throw new Error('Missing native raster mapping')
  const horizontals: NativePageSegment[] = []
  const verticals = new Map<string, NativePageSegment[]>()
  for (const segment of nativePageSegments(work)) {
    const { start, end } = segment
    if (start.y === end.y && start.x !== end.x) {
      const length = Math.abs(end.x - start.x) * scale.x
      if (length >= 5 && length <= 50) horizontals.push(segment)
    } else if (start.x === end.x && start.y !== end.y) {
      const length = Math.abs(end.y - start.y) * scale.y
      if (length < 5 || length > 50) continue
      const key = verticalKey(start.x, Math.min(start.y, end.y), Math.max(start.y, end.y))
      verticals.set(key, [...(verticals.get(key) ?? []), segment])
    }
  }
  const omitted = [...(work.skippedCurveBounds ?? []), ...(work.clippedPathBounds ?? [])]
  if (
    omitted.some(
      ({ bounds }) =>
        ![bounds.left, bounds.top, bounds.right, bounds.bottom].every(Number.isFinite) ||
        bounds.left > bounds.right ||
        bounds.top > bounds.bottom,
    )
  )
    throw new Error('Invalid omitted caption-frame evidence')
  const result = new Map<string, FrameCue[]>()
  let checks = 200_000
  for (const label of labels) {
    const point = label.pagePoint
    if (!point) throw new Error('Missing page-native caption point')
    const above: NativePageSegment[] = [],
      below: NativePageSegment[] = []
    for (const segment of horizontals) {
      if (--checks < 0) throw new Error('Native caption-frame search budget exceeded')
      if (
        point.x <= Math.min(segment.start.x, segment.end.x) ||
        point.x >= Math.max(segment.start.x, segment.end.x)
      )
        continue
      const delta = (point.y - segment.start.y) * scale.y
      if (delta > 0 && delta <= 50) above.push(segment)
      if (delta < 0 && delta >= -50) below.push(segment)
    }
    if (above.length > 20 || below.length > 20)
      throw new Error('Too many possible caption-frame sides')
    const frames: FrameCue[] = []
    frameSearch: for (const top of above)
      for (const bottom of below) {
        if (--checks < 0) throw new Error('Native caption-frame search budget exceeded')
        const left = Math.min(top.start.x, top.end.x),
          right = Math.max(top.start.x, top.end.x)
        if (
          left !== Math.min(bottom.start.x, bottom.end.x) ||
          right !== Math.max(bottom.start.x, bottom.end.x)
        )
          continue
        const height = (bottom.start.y - top.start.y) * scale.y
        if (height < 5 || height > 50) continue
        const leftSides = verticals.get(verticalKey(left, top.start.y, bottom.start.y)) ?? []
        const rightSides = verticals.get(verticalKey(right, top.start.y, bottom.start.y)) ?? []
        if (!leftSides.length || !rightSides.length) continue
        const bounds = { left, right, top: top.start.y, bottom: bottom.start.y }
        const nearOmission = omitted.some(
          ({ bounds: area }) =>
            area.left <= right + 3 / scale.x &&
            area.right >= left - 3 / scale.x &&
            area.top <= bounds.bottom + 3 / scale.y &&
            area.bottom >= bounds.top - 3 / scale.y,
        )
        frames.push({
          bounds,
          sides: [top, bottom, ...leftSides, ...rightSides],
          uncertain: nearOmission || leftSides.length !== 1 || rightSides.length !== 1,
        })
        if (frames.length > 1) break frameSearch
      }
    result.set(label.id, frames)
  }
  return result
}

/** Strict native table and rectangular-number cues. Candidate associations, not human review or OCR. */
export function automaticNativeRoomCandidates(input: {
  native: NativeTextAnchors
  work: PdfLinework
  lineworkSource: RegionLabelFrame
}) {
  const { native, work } = input
  const geometry = nativeFillCandidates(input)
  const strokeGeometry = nativeStrokeCycleCandidates(input)
  let frameFaces: ReturnType<typeof nativeRoomFrameFaceCandidates> | undefined
  const scale = native.pageNormalizedScale
  const fail = (reason: string) => ({
    status: 'unresolved' as const,
    reason,
    geometry,
    strokeGeometry,
    frameFaces,
    associations: [],
  })
  if (geometry.truncated) return fail('incomplete-native-geometry')
  if (!scale) return fail('missing-native-raster-mapping')
  if (
    new Set(work.paths.map((path) => `${path.operationIndex}:${path.subpathIndex}`)).size !==
      work.paths.length ||
    work.paths.some(
      (path) =>
        ![path.operationIndex, path.subpathIndex].every(
          (value) => Number.isSafeInteger(value) && value >= 0,
        ) ||
        path.points.some(
          (point) =>
            ![point.x, point.y].every(
              (value) => Number.isFinite(value) && value >= 0 && value <= 1000,
            ),
        ),
    )
  )
    return fail('invalid-native-frame-provenance')
  if (
    !native.complete ||
    native.labels.length > 1000 ||
    new Set(native.labels.map((label) => label.id)).size !== native.labels.length
  )
    return fail('incomplete-native-text')
  if (
    native.labels.some(
      (label) =>
        !Number.isSafeInteger(label.nativeIndex) ||
        (label.nativeIndex ?? -1) < 0 ||
        !label.name ||
        label.name !== label.name.trim() ||
        label.name.length > 200 ||
        label.id !== `native-text-${label.nativeIndex}` ||
        !label.pagePoint ||
        !Number.isFinite(label.rotation) ||
        ![label.pagePoint.x, label.pagePoint.y].every(
          (value) => Number.isFinite(value) && value >= 0 && value <= 1000,
        ) ||
        ![label.point.x, label.point.y].every(Number.isFinite) ||
        label.point.x < 0 ||
        label.point.y < 0 ||
        label.point.x > native.source.width ||
        label.point.y > native.source.height ||
        Math.abs(label.point.x - label.pagePoint.x * scale.x) > 1e-6 ||
        Math.abs(label.point.y - label.pagePoint.y * scale.y) > 1e-6,
    )
  )
    return fail('missing-native-text-provenance')
  if (strokeGeometry.truncated) return fail('incomplete-native-room-cycles')
  const schedule = nativeRoomScheduleEvidence(input)
  if (schedule.status !== 'draft' || !schedule.tableBounds)
    return fail(schedule.reason ?? 'unsupported-or-ambiguous-room-table')
  const rows = schedule.rows
  const table = new Map(rows.map((row) => [row.sourceNumber, row]))
  const tableIds = new Set([
    ...schedule.headerLabelIds,
    ...rows.flatMap((row) => [row.numberLabelId, row.nameLabelId, row.areaLabelId]),
  ])
  const tableBounds = schedule.tableBounds
  const numeric = native.labels.filter((label) => {
    const p = label.pagePoint
    return (
      p &&
      label.rotation === 0 &&
      /^0?[1-9]\d?(?:\.\d{1,3})?$/u.test(label.name) &&
      (/^0?[1-9]\d?$/.test(label.name) || String(Number(label.name)) === label.name) &&
      isPlanRoomSourceNumber(Number(label.name)) &&
      table.has(Number(label.name)) &&
      !tableIds.has(label.id) &&
      !(
        p.x >= tableBounds.left &&
        p.x <= tableBounds.right &&
        p.y >= tableBounds.top &&
        p.y <= tableBounds.bottom
      )
    )
  })
  let frames: Map<string, FrameCue[]>
  try {
    frames = captionFrames(work, native, numeric)
  } catch {
    return fail('caption-frame-search-incomplete')
  }
  const cues = numeric.filter((label) => (frames.get(label.id)?.length ?? 0) > 0)
  if (cues.length > 50) return fail('too-many-native-caption-cues')
  frameFaces = nativeRoomFrameFaceCandidates({
    ...input,
    frames: cues.flatMap((cue) => {
      const candidates = frames.get(cue.id)
      const frame = candidates?.[0]
      return candidates?.length === 1 && frame && !frame.uncertain
        ? [{ labelId: cue.id, ...frame }]
        : []
    }),
  })
  if (frameFaces.status === 'unresolved') return fail(frameFaces.reason)
  const counts = new Map<number, number>()
  for (const cue of cues) counts.set(Number(cue.name), (counts.get(Number(cue.name)) ?? 0) + 1)
  const labels = cues.map((cue) => ({
    id: cue.id,
    name: table.get(Number(cue.name))?.name ?? '',
    point: cue.point,
  }))
  // Identical paint/outline polygons are aliases, not competing rooms. Different
  // nested or overlapping outlines remain competitors; never choose the smallest.
  const groups = new Map<
    string,
    {
      id: string
      polygon: PagePoint[]
      pagePolygon: PagePoint[]
      regionIds: string[]
    }
  >()
  for (const candidate of [
    ...geometry.candidates,
    ...strokeGeometry.candidates,
    ...(frameFaces.geometry?.candidates ?? []),
  ]) {
    const key = nativeRoomPolygonKey(candidate.polygon)
    const existing = groups.get(key)
    if (existing) existing.regionIds.push(candidate.id)
    else
      groups.set(key, {
        id: candidate.id,
        polygon: candidate.rasterPolygon,
        pagePolygon: candidate.polygon,
        regionIds: [candidate.id],
      })
  }
  if (groups.size > 50) return fail('room-region-limit')
  const regions = [...groups.values()]
  const binding = bindObservedRegionLabels({
    regionSource: native.source,
    labelSource: geometry.source,
    regions,
    labels,
  })
  const assignments = binding.assignments.filter((entry) => {
    const cue = cues.find((label) => label.id === entry.labelId)
    const cueFrames = frames.get(entry.labelId)
    const region = regions.find((region) => region.id === entry.regionId)
    const frame = cueFrames?.[0]
    return (
      cue &&
      counts.get(Number(cue.name)) === 1 &&
      cueFrames?.length === 1 &&
      frame &&
      !frame.uncertain &&
      region &&
      frameInsidePolygon(work, frame.bounds, region.pagePolygon)
    )
  })
  const associations = assignments.map((entry) => {
    const cue = cues.find((label) => label.id === entry.labelId)
    const row = rows.find((row) => row.sourceNumber === Number(cue?.name))
    return {
      ...entry,
      ...row,
      regionIds: regions.find((region) => region.id === entry.regionId)?.regionIds ?? [],
      markerLabelId: entry.labelId,
      frame: frames.get(entry.labelId)?.[0],
    }
  })
  const associated = new Set(associations.map((entry) => entry.sourceNumber))
  return {
    status: 'draft' as const,
    geometry,
    strokeGeometry,
    frameFaces,
    rows,
    tableBounds,
    associations,
    unresolvedSourceNumbers: rows
      .filter((row) => !associated.has(row.sourceNumber))
      .map((row) => row.sourceNumber),
    potentialCaptionCues: cues.map((cue) => ({
      id: cue.id,
      sourceNumber: Number(cue.name),
      frames: frames.get(cue.id),
    })),
    spatialAmbiguities: binding.ambiguities,
    basis: 'native-table-and-boxed-number-candidates' as const,
  }
}
