import { createHash } from 'node:crypto'
import { isPlanRoomSourceNumber } from '@uyut/db/source-room-number'
import type { NativeTextAnchors } from './plan-document'
import type { PdfLinework } from './plan-pdf-linework'
import { PDF_NATIVE_MAX_PATHS } from './plan-pdf-linework'
import { bindObservedRegionLabels, type RegionLabelFrame } from './plan-raster-region-labels'
import { detectPlanRasterRegions, type RasterRegionPoint } from './plan-raster-regions'

type PathRef = { operationIndex: number; subpathIndex: number }
type Box = { left: number; top: number; right: number; bottom: number }
export type ReviewedCaptionFrames = {
  review: 'manual-caption-frame-review'
  source: RegionLabelFrame
  frames: { markerLabelId: string; sides: PathRef[] }[]
}
const refKey = (ref: PathRef) => `${ref.operationIndex}:${ref.subpathIndex}`

function segmentTouchesBox(a: RasterRegionPoint, b: RasterRegionPoint, box: Box) {
  let low = 0
  let high = 1
  for (const [start, end, minimum, maximum] of [
    [a.x, b.x, box.left, box.right],
    [a.y, b.y, box.top, box.bottom],
  ]) {
    if (start === undefined || end === undefined || minimum === undefined || maximum === undefined)
      return true
    const delta = end - start
    if (delta === 0) {
      if (start < minimum || start > maximum) return false
    } else {
      const first = (minimum - start) / delta
      const last = (maximum - start) / delta
      low = Math.max(low, Math.min(first, last))
      high = Math.min(high, Math.max(first, last))
      if (low > high) return false
    }
  }
  return true
}

/** Side-sample relations for reviewed annotations only; never erase ink or infer floor geometry. */
export function captionFrameComponents(input: {
  native: NativeTextAnchors
  work: PdfLinework
  lineworkSource: RegionLabelFrame
  reviewed: ReviewedCaptionFrames
  grayscale: Uint8Array
}) {
  const { native, work, reviewed } = input
  const source = native.source
  bindObservedRegionLabels({
    regionSource: source,
    labelSource: reviewed.source,
    regions: [],
    labels: [],
  })
  bindObservedRegionLabels({
    regionSource: source,
    labelSource: input.lineworkSource,
    regions: [],
    labels: [],
  })
  const scale = native.pageNormalizedScale
  if (
    reviewed.review !== 'manual-caption-frame-review' ||
    !native.complete ||
    !scale ||
    !Number.isFinite(scale.x) ||
    !Number.isFinite(scale.y) ||
    scale.x <= 0 ||
    scale.y <= 0 ||
    scale.x * 1000 > source.width + 0.001 ||
    scale.y * 1000 > source.height + 0.001 ||
    scale.x * 1000 < source.width * 0.995 ||
    scale.y * 1000 < source.height * 0.995 ||
    work.coordinateSystem !== 'page-0-1000' ||
    work.truncated ||
    work.unsupportedPaths > 0 ||
    work.unsupportedContexts > 0 ||
    (work.skippedCurves > 0 &&
      (!work.skippedCurveBounds?.length || work.skippedCurveBoundsTruncated)) ||
    (work.clippedPaths > 0 &&
      (!work.clippedPathBounds?.length || work.clippedPathBoundsTruncated)) ||
    reviewed.frames.length > 12 ||
    native.labels.length > 1000 ||
    work.paths.length > PDF_NATIVE_MAX_PATHS ||
    new Set(native.labels.map((label) => label.id)).size !== native.labels.length ||
    new Set(reviewed.frames.map((frame) => frame.markerLabelId)).size !== reviewed.frames.length
  )
    throw new Error('Incomplete or unsupported caption-frame evidence')
  const pixelPoint = (point: RasterRegionPoint) => ({ x: point.x * scale.x, y: point.y * scale.y })
  const labels = new Map(native.labels.map((label) => [label.id, label]))
  const usedSides = new Set<string>()
  const prepared: {
    markerLabelId: string
    sides: PathRef[]
    box: Box
    blocked: boolean
    probes: { id: string; point: RasterRegionPoint }[]
  }[] = []
  let checks = 300_000
  for (const frame of reviewed.frames) {
    const marker = labels.get(frame.markerLabelId)
    if (
      !marker ||
      !/^[1-9]\d?(?:\.\d{1,3})?$/u.test(marker.name) ||
      String(Number(marker.name)) !== marker.name ||
      !isPlanRoomSourceNumber(Number(marker.name)) ||
      frame.sides.length !== 4
    )
      throw new Error('Invalid reviewed caption marker')
    const sides = frame.sides.map((ref) => {
      const key = refKey(ref)
      if (usedSides.has(key)) throw new Error('Reused annotation side')
      usedSides.add(key)
      const matches = work.paths.filter((path) => refKey(path) === key)
      const path = matches[0]
      if (
        matches.length !== 1 ||
        !path ||
        path.paint !== 'stroke' ||
        path.closed ||
        path.points.length !== 2
      )
        throw new Error('Expected an observed straight caption-frame side')
      const points = path.points.map(pixelPoint)
      if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y)))
        throw new Error('Invalid annotation coordinates')
      return points as [RasterRegionPoint, RasterRegionPoint]
    })
    const points = sides.flat()
    const box = {
      left: Math.min(...points.map((point) => point.x)),
      right: Math.max(...points.map((point) => point.x)),
      top: Math.min(...points.map((point) => point.y)),
      bottom: Math.max(...points.map((point) => point.y)),
    }
    const tolerance = Math.max(scale.x, scale.y) * 0.002
    const close = (a: number, b: number) => Math.abs(a - b) <= tolerance
    const cornerIndex = (point: RasterRegionPoint) => {
      const column = close(point.x, box.left) ? 0 : close(point.x, box.right) ? 1 : -1
      const row = close(point.y, box.top) ? 0 : close(point.y, box.bottom) ? 1 : -1
      return column < 0 || row < 0 ? -1 : row * 2 + column
    }
    const edgeKeys = new Set(
      sides.map(([a, b]) => [cornerIndex(a), cornerIndex(b)].sort().join(':')),
    )
    if (
      box.right - box.left < 5 ||
      box.right - box.left > 50 ||
      box.bottom - box.top < 5 ||
      box.bottom - box.top > 50 ||
      !['0:1', '0:2', '1:3', '2:3'].every((key) => edgeKeys.has(key)) ||
      !Number.isFinite(marker.point.x) ||
      !Number.isFinite(marker.point.y) ||
      marker.point.x <= box.left ||
      marker.point.x >= box.right ||
      marker.point.y <= box.top ||
      marker.point.y >= box.bottom
    )
      throw new Error('Selected sides do not bound the caption marker')
    const padded = {
      left: box.left - 3,
      right: box.right + 3,
      top: box.top - 3,
      bottom: box.bottom + 3,
    }
    if (
      padded.left < 0 ||
      padded.top < 0 ||
      padded.right >= source.width ||
      padded.bottom >= source.height
    )
      throw new Error('Caption frame samples leave the raster')
    const omitted = [...(work.skippedCurveBounds ?? []), ...(work.clippedPathBounds ?? [])]
    let blocked = omitted.some(
      ({ bounds }) =>
        bounds.left * scale.x <= padded.right &&
        bounds.right * scale.x >= padded.left &&
        bounds.top * scale.y <= padded.bottom &&
        bounds.bottom * scale.y >= padded.top,
    )
    const selected = new Set(frame.sides.map(refKey))
    for (const path of work.paths) {
      if (selected.has(refKey(path))) continue
      for (let index = 0; index < path.points.length - (path.closed ? 0 : 1); index++) {
        if (--checks < 0) throw new Error('Caption-frame collision budget exceeded')
        const a = path.points[index]
        const b = path.points[(index + 1) % path.points.length]
        if (a && b && segmentTouchesBox(pixelPoint(a), pixelPoint(b), padded)) blocked = true
      }
    }
    const probes = [
      { x: padded.left, y: (box.top + box.bottom) / 2 },
      { x: padded.right, y: (box.top + box.bottom) / 2 },
      { x: (box.left + box.right) / 2, y: padded.top },
      { x: (box.left + box.right) / 2, y: padded.bottom },
    ].map((point, index) => ({ id: `${frame.markerLabelId}-side-${index}`, point }))
    prepared.push({ ...frame, box, blocked, probes })
  }
  const detected = detectPlanRasterRegions({
    grayscale: input.grayscale,
    width: source.width,
    height: source.height,
    probes: prepared.flatMap((frame) => frame.probes),
  })
  if (detected.truncated) throw new Error('Truncated component inventory')
  const memberships = new Map(detected.pointMembership?.map((sample) => [sample.id, sample]))
  const links = prepared.map((frame) => {
    const samples = frame.probes.map((probe) => memberships.get(probe.id))
    const regionIds = samples.map((sample) => sample?.regionId ?? null)
    const regionId =
      !frame.blocked && regionIds[0] && regionIds.every((id) => id === regionIds[0])
        ? regionIds[0]
        : null
    return {
      markerLabelId: frame.markerLabelId,
      sides: frame.sides,
      box: frame.box,
      samples,
      regionId,
      reason: frame.blocked
        ? 'other-linework-or-omission-near-frame'
        : regionId
          ? 'four-side-component-agreement'
          : 'unknown-or-different-side-components',
    }
  })
  return {
    status: 'draft' as const,
    kind: 'reviewed-annotation-surroundings' as const,
    source,
    pageNormalizedScale: { ...scale },
    sampleOffsetPx: 3,
    analysisMaskSha256: createHash('sha256').update(input.grayscale).digest('hex'),
    links,
  }
}
