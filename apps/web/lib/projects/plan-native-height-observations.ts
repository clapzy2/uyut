import type { NativeTextAnchors } from './plan-document'
import { nativeFillCandidates } from './plan-native-fill-candidates'
import { type NativeHeightCaption, nativeHeightCaption } from './plan-native-height-caption'
import type { PagePoint, PdfLinework } from './plan-pdf-linework'
import type { PdfPlanSource } from './plan-pdf-room-binding'
import type { RegionLabelFrame } from './plan-raster-region-labels'

export type NativeHeightObservation = NativeHeightCaption & {
  labelId: string
  originalText: string
  pagePoint: PagePoint
  mayAcceptFor3D: false
}

const MAX_OBSERVATIONS = 100
const pointValid = (point: PagePoint) =>
  [point.x, point.y].every((value) => Number.isFinite(value) && value >= 0 && value <= 1000)

/** Literal vertical references only. No caption joining, room ownership or geometry mutation. */
export function nativeHeightObservations(input: {
  source: PdfPlanSource
  native: NativeTextAnchors
  work: PdfLinework
  lineworkSource: RegionLabelFrame
}) {
  const { native, work, source } = input
  const observations: NativeHeightObservation[] = []
  const issues: { labelId: string; originalText: string; code: string }[] = []
  const finish = (refusalReason: string | null) => ({
    status: refusalReason ? ('unresolved' as const) : ('draft' as const),
    refusalReason,
    basis: 'literal-native-height-observations' as const,
    source: { ...source },
    image: { ...native.source },
    observations: refusalReason ? [] : structuredClone(observations),
    issues: refusalReason ? [] : structuredClone(issues),
    omissionCounts: { skippedCurves: work.skippedCurves, clippedPaths: work.clippedPaths },
    mayAcceptFor3D: false as const,
    assignsGeometryHeights: false as const,
    readOnly: true as const,
  })
  if (source.state !== 'existing') return finish('not-existing-state')
  if (
    !/^[a-f0-9]{64}$/u.test(source.sha256) ||
    source.sha256 !== native.originalPdfSha256 ||
    !Number.isSafeInteger(source.pdfPage) ||
    source.pdfPage < 1 ||
    source.pdfPage !== native.source.page
  )
    return finish('different-height-source')
  try {
    if (nativeFillCandidates(input).refusalReason === 'incomplete-native-layer')
      return finish('incomplete-native-layer')
  } catch {
    return finish('height-source-frame-unavailable')
  }
  const scale = native.pageNormalizedScale
  if (!scale || !native.complete || native.labels.length > 1000)
    return finish('incomplete-native-text')
  const labelIds = new Set<string>()
  for (const label of native.labels) {
    const point = label.pagePoint
    if (
      !Number.isSafeInteger(label.nativeIndex) ||
      (label.nativeIndex ?? -1) < 0 ||
      label.id !== `native-text-${label.nativeIndex}` ||
      labelIds.has(label.id) ||
      !label.name ||
      label.name !== label.name.trim() ||
      label.name.length > 200 ||
      !point ||
      !pointValid(point) ||
      !Number.isFinite(label.rotation) ||
      ![label.point.x, label.point.y].every(Number.isFinite) ||
      Math.abs(label.point.x - point.x * scale.x) > 1e-6 ||
      Math.abs(label.point.y - point.y * scale.y) > 1e-6
    )
      return finish('invalid-native-text-provenance')
    labelIds.add(label.id)
  }
  const refs = new Set<string>()
  for (const path of work.paths) {
    const ref = `${path.operationIndex}:${path.subpathIndex}`
    if (
      refs.has(ref) ||
      ![path.operationIndex, path.subpathIndex].every(
        (value) => Number.isSafeInteger(value) && value >= 0,
      ) ||
      !['stroke', 'fill', 'fill-stroke'].includes(path.paint) ||
      typeof path.closed !== 'boolean' ||
      path.points.some((point) => !pointValid(point))
    )
      return finish('invalid-native-path-provenance')
    refs.add(ref)
  }
  if (
    ![work.skippedCurves, work.clippedPaths].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    ) ||
    (work.skippedCurveBounds?.length ?? 0) !== work.skippedCurves ||
    (work.clippedPathBounds?.length ?? 0) !== work.clippedPaths ||
    [...(work.skippedCurveBounds ?? []), ...(work.clippedPathBounds ?? [])].some(
      ({ operationIndex, bounds }) =>
        !Number.isSafeInteger(operationIndex) ||
        operationIndex < 0 ||
        ![bounds.left, bounds.top, bounds.right, bounds.bottom].every(Number.isFinite) ||
        bounds.left > bounds.right ||
        bounds.top > bounds.bottom,
    )
  )
    return finish('invalid-omission-provenance')
  const outputLimit = Symbol('height-observation-output-limit')
  const issue = (labelId: string, originalText: string, code: string) => {
    issues.push({ labelId, originalText, code })
    if (issues.length > MAX_OBSERVATIONS) throw outputLimit
  }
  try {
    for (const label of native.labels) {
      const text = label.name
      const caption = nativeHeightCaption(text)
      if (caption.status === 'not-height') continue
      if (caption.status === 'unresolved') {
        issue(label.id, text, caption.code)
        continue
      }
      observations.push({
        ...caption.observation,
        labelId: label.id,
        originalText: text,
        pagePoint: { ...(label.pagePoint as PagePoint) },
        mayAcceptFor3D: false,
      })
      if (observations.length > MAX_OBSERVATIONS) return finish('height-observation-output-limit')
      for (const code of caption.observation.issueCodes) issue(label.id, text, code)
    }
    return finish(null)
  } catch (error) {
    if (error === outputLimit) return finish('height-observation-output-limit')
    throw error
  }
}
