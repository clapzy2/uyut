import type { NativeTextAnchors } from './plan-document'
import { nativeCaptionKnownPaintBlockers } from './plan-native-caption-paint'
import { nativeFillCandidates } from './plan-native-fill-candidates'
import {
  type NativeHeightCaption,
  nativeDocumentaryHeightCaption,
  nativeHeightCaption,
  nativeHeightMillimetreDeclarationIndex,
} from './plan-native-height-caption'
import { nativeResetNoteBounds } from './plan-native-height-group'
import { nativeCaptionInkIssue } from './plan-pdf-caption-binding'
import type { PagePoint, PdfLinework } from './plan-pdf-linework'
import type { PdfPlanSource } from './plan-pdf-room-binding'
import type { RegionLabelFrame } from './plan-raster-region-labels'

export type NativeHeightObservation = NativeHeightCaption & {
  labelId: string
  originalText: string
  pagePoint: PagePoint
  mayAcceptFor3D: false
  unitEvidence?: {
    kind: 'same-page-millimetre-declaration'
    labelId: string
    originalText: string
    nativeIndex: number
    inkSourceOperation: number | null
    source: PdfPlanSource
  }
}

export type NativeSplitHeightHint = {
  parts: { labelId: string; originalText: string; pagePoint: PagePoint }[]
  valueMm: number
  quantityKind: 'threshold-height'
  status: 'unverified-source-ink'
}

const MAX_OBSERVATIONS = 100
const pointValid = (point: PagePoint) =>
  [point.x, point.y].every((value) => Number.isFinite(value) && value >= 0 && value <= 1000)

/** A local alpha check is usable only for these source glyphs, never for geometry transfer. */
export function nativeHeightCaptionPaintIssue(native: NativeTextAnchors): string | undefined {
  const ink = native.heightCaptionInk
  if (
    native.vectorInkRefusal === 'unverified-native-vector-paint-alpha' &&
    native.heightCaptionPaintRefusal === null &&
    ink?.complete === true &&
    ink.refusalReason === null &&
    ink.unresolved.length === 0 &&
    ink.items.length > 0 &&
    ink.source.sha256 === native.originalPdfSha256 &&
    ink.source.pdfPage === native.source.page
  )
    return undefined
  return native.vectorInkRefusal
}

/** A review hint, not a height observation: PDF text order and position do not prove visible ink. */
function splitThresholdHints(native: NativeTextAnchors, pageWidth: number, pageHeight: number) {
  const hints: NativeSplitHeightHint[] = []
  if (![pageWidth, pageHeight].every((value) => Number.isFinite(value) && value > 0)) return hints
  for (let index = 0; index + 2 < native.labels.length; index++) {
    const parts = native.labels.slice(index, index + 3)
    const [prefix, object, quantity] = parts
    if (
      !prefix ||
      !object ||
      !quantity ||
      !/^[hн]$/iu.test(prefix.name) ||
      !/^порога$/iu.test(object.name) ||
      !/^=\s*\d{1,4}\s*мм$/iu.test(quantity.name) ||
      object.nativeIndex !== (prefix.nativeIndex as number) + 1 ||
      quantity.nativeIndex !== (object.nativeIndex as number) + 1 ||
      parts.some((part) => part.rotation !== 0 || !part.pagePoint)
    )
      continue

    const first = prefix.pagePoint as PagePoint
    const middle = object.pagePoint as PagePoint
    const last = quantity.pagePoint as PagePoint
    const firstGap = ((middle.x - first.x) * pageWidth) / 1000
    const secondGap = ((last.x - middle.x) * pageWidth) / 1000
    const firstBaseline = Math.abs(((middle.y - first.y) * pageHeight) / 1000)
    const lastBaseline = Math.abs(((last.y - first.y) * pageHeight) / 1000)
    if (
      firstGap <= 0 ||
      firstGap > 16 ||
      secondGap <= 0 ||
      secondGap > 45 ||
      firstBaseline > 3 ||
      lastBaseline > 2
    )
      continue

    const caption = nativeHeightCaption(parts.map((part) => part.name).join(''))
    if (
      caption.status !== 'observed' ||
      caption.observation.quantityKind !== 'threshold-height' ||
      caption.observation.issueCodes.includes('height-outside-model-range')
    )
      continue
    hints.push({
      parts: parts.map((part) => ({
        labelId: part.id,
        originalText: part.name,
        pagePoint: { ...(part.pagePoint as PagePoint) },
      })),
      valueMm: caption.observation.valueMm,
      quantityKind: 'threshold-height',
      status: 'unverified-source-ink',
    })
    if (hints.length >= MAX_OBSERVATIONS) break
  }
  return hints
}

function documentaryUnitEvidence(
  input: Parameters<typeof nativeHeightObservations>[0],
): NativeHeightObservation['unitEvidence'] | undefined {
  const { native, work, source } = input
  const position = nativeHeightMillimetreDeclarationIndex(native.labels.map((label) => label.name))
  if (position === null || nativeHeightCaptionPaintIssue(native)) return
  const label = native.labels[position]
  const ink = native.heightUnitInk
  if (
    !label?.pagePoint ||
    !ink?.source ||
    ink.source.sha256 !== source.sha256 ||
    ink.source.pdfPage !== source.pdfPage ||
    ink.source.pageWidth !== work.pageWidth ||
    ink.source.pageHeight !== work.pageHeight ||
    ink.refusalReason !== null ||
    !Array.isArray(ink.items) ||
    !Array.isArray(ink.unresolved) ||
    typeof ink.complete !== 'boolean'
  )
    return
  // A native show-run identity omission is retained as documentary text only.
  // It does not certify note glyph visibility, ownership or geometry transfer.
  if (
    ink.complete === false &&
    ink.items.length === 0 &&
    ink.unresolved.length === 1 &&
    ink.unresolved[0]?.index === label.nativeIndex &&
    ink.unresolved[0]?.reason === 'native-text-show-identity-unresolved'
  )
    return {
      kind: 'same-page-millimetre-declaration',
      labelId: label.id,
      originalText: label.name,
      nativeIndex: label.nativeIndex as number,
      inkSourceOperation: null,
      source: { ...source },
    }
  if (!ink.complete || ink.items.length !== 1 || ink.unresolved.length !== 0) return
  const item = ink.items[0]
  const resetBounds = item?.sourceResetCaption
    ? nativeResetNoteBounds(item, label, work)
    : undefined
  if (
    !item ||
    item.index !== label.nativeIndex ||
    item.text !== label.name ||
    !item.baselineStart ||
    !item.baselineEnd ||
    !pointValid(item.baselineStart) ||
    !pointValid(item.baselineEnd) ||
    (item.sourceResetCaption
      ? !resetBounds
      : Math.abs(item.baselineStart.x - label.pagePoint.x) > 1e-7 ||
        Math.abs(item.baselineStart.y - label.pagePoint.y) > 1e-7)
  )
    return
  const dx = (item.baselineEnd.x - item.baselineStart.x) * work.pageWidth
  const dy = (item.baselineEnd.y - item.baselineStart.y) * work.pageHeight
  const delta = Math.abs(((-Math.atan2(dy, dx) * 180) / Math.PI - (label.rotation as number)) % 360)
  if (
    (dx === 0 && dy === 0) ||
    Math.min(delta, 360 - delta) > 1e-6 ||
    nativeCaptionInkIssue(
      {
        source: ink.source,
        complete: true,
        items: [
          {
            index: item.index,
            text: item.text,
            rotation: label.rotation as number,
            origin: item.baselineStart,
            baselineStart: item.baselineStart,
            baselineEnd: item.baselineEnd,
            inkPolygon: item.quad,
            inkSourceOperation: item.operationIndex,
          },
        ],
      },
      work,
    )
  )
    return
  const operations = item.sourceResetCaption
    ? item.sourceResetCaption.shows.map((show) => show.operationIndex)
    : [item.operationIndex]
  const blockers = nativeCaptionKnownPaintBlockers(
    work.paintBounds,
    operations,
    resetBounds ?? item.quad,
  )
  if (blockers === null || blockers.length > 0) return
  return {
    kind: 'same-page-millimetre-declaration',
    labelId: label.id,
    originalText: label.name,
    nativeIndex: item.index,
    inkSourceOperation: item.operationIndex,
    source: { ...source },
  }
}

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
  let splitHints: NativeSplitHeightHint[] = []
  const finish = (refusalReason: string | null) => ({
    status: refusalReason ? ('unresolved' as const) : ('draft' as const),
    refusalReason,
    basis: 'literal-native-height-observations' as const,
    source: { ...source },
    image: { ...native.source },
    observations: refusalReason ? [] : structuredClone(observations),
    issues: refusalReason ? [] : structuredClone(issues),
    splitHints: refusalReason ? [] : structuredClone(splitHints),
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
    const units = documentaryUnitEvidence(input)
    splitHints = splitThresholdHints(native, work.pageWidth, work.pageHeight)
    for (const label of native.labels) {
      const text = label.name
      const literal = nativeHeightCaption(text)
      const documentary = units ? nativeDocumentaryHeightCaption(text) : null
      if (documentary && units?.inkSourceOperation === null)
        documentary.issueCodes.push('height-unit-ink-unverified')
      const caption = documentary
        ? { status: 'observed' as const, observation: documentary }
        : literal
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
        ...(documentary && units ? { unitEvidence: structuredClone(units) } : {}),
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
