import type { NativeTextAnchors } from './plan-document'
import { exactNativeSegmentsTouch } from './plan-native-exact-intersections'
import { nativeStrokeFaceCandidates } from './plan-native-stroke-candidates'
import { pdfNativeDimensionSourceIssue } from './plan-pdf-dimension-source'
import type { PdfLinework } from './plan-pdf-linework'
import { type NativePageSegment, nativePageSegments } from './plan-pdf-opening-endpoint'
import type { RegionLabelFrame } from './plan-raster-region-labels'

export type NativeRoomNumberFrame = {
  labelId: string
  bounds: { left: number; top: number; right: number; bottom: number }
  sides: NativePageSegment[]
}
const refKey = (side: NativePageSegment) =>
  `${side.operationIndex}:${side.subpathIndex}:${side.segmentIndex}`
const pathKey = (side: NativePageSegment) => `${side.operationIndex}:${side.subpathIndex}`
const samePoint = (a: NativePageSegment['start'], b: NativePageSegment['start']) =>
  a.x === b.x && a.y === b.y

/** Scoped graph view only. The source ink and the generic interior-node guard remain intact. */
export function nativeRoomFrameFaceCandidates(input: {
  native: NativeTextAnchors
  work: PdfLinework
  lineworkSource: RegionLabelFrame
  frames: NativeRoomNumberFrame[]
}) {
  const { native, work, frames } = input
  const scale = native.pageNormalizedScale
  const fail = (status: 'unresolved' | 'not-applicable', reason: string) => ({
    status,
    reason,
    geometry: null,
    exclusions: [] as NativeRoomNumberFrame[],
  })
  if (
    ![work.skippedCurves, work.clippedPaths].every(
      (count) => Number.isSafeInteger(count) && count >= 0,
    )
  )
    return fail('unresolved', 'invalid-number-frame-layer')
  // Old localized-omission fill/cycle candidates remain a separate limited path.
  // Do not treat a missing curved wall or door arc as an annotation to remove.
  if (work.skippedCurves !== 0 || work.clippedPaths !== 0)
    return fail('not-applicable', 'number-frame-layer-has-omissions')
  if (
    !native.complete ||
    !scale ||
    frames.length > 50 ||
    new Set(frames.map((frame) => frame.labelId)).size !== frames.length ||
    pdfNativeDimensionSourceIssue(
      { sha256: native.originalPdfSha256 ?? '', pdfPage: native.source.page, state: 'existing' },
      work,
    )
  )
    return fail('unresolved', 'incomplete-number-frame-source')
  const segments = nativePageSegments(work)
  const sourceRefs = new Map(segments.map((side) => [refKey(side), side]))
  const paths = new Map(
    work.paths.map((path) => [`${path.operationIndex}:${path.subpathIndex}`, path]),
  )
  const exclusions: NativeRoomNumberFrame[] = []
  const excludedPaths = new Set<string>()
  let budget = 200_000
  for (const frame of frames) {
    const label = native.labels.find((label) => label.id === frame.labelId)
    const box = frame.bounds
    const inside = (point: NativePageSegment['start']) =>
      point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom
    if (
      !label?.pagePoint ||
      label.id !== `native-text-${label.nativeIndex}` ||
      !Number.isSafeInteger(label.nativeIndex) ||
      (label.nativeIndex ?? -1) < 0 ||
      !/^0?[1-9]\d?$/u.test(label.name) ||
      label.rotation !== 0 ||
      ![box.left, box.top, box.right, box.bottom].every(Number.isFinite) ||
      box.left >= box.right ||
      box.top >= box.bottom ||
      label.pagePoint.x <= box.left ||
      label.pagePoint.x >= box.right ||
      label.pagePoint.y <= box.top ||
      label.pagePoint.y >= box.bottom ||
      frame.sides.length !== 4 ||
      new Set(frame.sides.map(refKey)).size !== 4
    )
      return fail('unresolved', 'invalid-number-frame-witness')
    const corners = [
      { x: box.left, y: box.top },
      { x: box.right, y: box.top },
      { x: box.right, y: box.bottom },
      { x: box.left, y: box.bottom },
    ]
    const exactSides = corners.every((start, index) => {
      const end = corners[(index + 1) % corners.length]
      return (
        end &&
        frame.sides.some(
          (side) =>
            (samePoint(side.start, start) && samePoint(side.end, end)) ||
            (samePoint(side.start, end) && samePoint(side.end, start)),
        )
      )
    })
    if (
      !exactSides ||
      frame.sides.some((side) => {
        const source = sourceRefs.get(refKey(side))
        return !source || !samePoint(source.start, side.start) || !samePoint(source.end, side.end)
      })
    )
      return fail('unresolved', 'stale-number-frame-witness')
    const width = (box.right - box.left) * scale.x
    const height = (box.bottom - box.top) * scale.y
    const minimumRegionArea = Math.max(400, native.source.width * native.source.height * 0.002)
    // A candidate-sized enclosed zone is not reduced to a removable numeric frame.
    if (width < 5 || width > 50 || height < 5 || height > 50 || width * height >= minimumRegionArea)
      continue
    // Exclude only whole, isolated open strokes. Never drop unrelated subpaths/segments.
    if (
      frame.sides.some((side) => {
        const path = paths.get(pathKey(side))
        return (
          side.segmentIndex !== 0 ||
          path?.paint !== 'stroke' ||
          path.closed ||
          path.points.length !== 2
        )
      })
    )
      continue
    if (native.labels.filter((item) => item.pagePoint && inside(item.pagePoint)).length !== 1)
      continue
    const own = new Set(frame.sides.map(refKey))
    let isolated = true
    for (const other of segments) {
      if (own.has(refKey(other))) continue
      if (--budget < 0) return fail('unresolved', 'number-frame-isolation-budget')
      if (
        inside(other.start) ||
        inside(other.end) ||
        frame.sides.some((side) => exactNativeSegmentsTouch(side, other) !== false)
      ) {
        isolated = false
        break
      }
    }
    if (!isolated) continue
    exclusions.push(structuredClone(frame))
    for (const side of frame.sides) excludedPaths.add(pathKey(side))
  }
  if (!exclusions.length) return fail('not-applicable', 'no-isolated-number-frame')
  const geometry = nativeStrokeFaceCandidates({
    ...input,
    work: {
      ...work,
      paths: work.paths.filter(
        (path) => !excludedPaths.has(`${path.operationIndex}:${path.subpathIndex}`),
      ),
    },
  })
  if (geometry.truncated)
    return fail('unresolved', geometry.refusalReason ?? 'incomplete-number-frame-faces')
  return {
    status: 'draft' as const,
    reason: null,
    exclusions,
    geometry: {
      ...geometry,
      candidates: geometry.candidates.map((candidate, index) => ({
        ...candidate,
        id: `native-number-frame-face-${index}`,
      })),
    },
  }
}
