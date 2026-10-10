import type { NativeTextAnchors } from './plan-document'
import { nativeFillCandidates } from './plan-native-fill-candidates'
import type { PagePoint, PdfLinework } from './plan-pdf-linework'
import type { PdfPlanSource } from './plan-pdf-room-binding'
import type { RegionLabelFrame } from './plan-raster-region-labels'

export type NativeHeightObservation = {
  labelId: string
  originalText: string
  pagePoint: PagePoint
  valueMm: number
  quantityKind: 'finished-ceiling' | 'opening-height' | 'beam-level' | 'unclassified-height'
  datum: 'unspecified' | 'existing-floor' | 'finished-floor'
  issueCodes: string[]
  mayAcceptFor3D: false
}

const MAX_OBSERVATIONS = 100
// A role/reference mentioned under negation or uncertainty is not a positive
// literal qualification. Preserve the quantity, but withhold both interpretations.
const qualifiedHeight =
  /(?:^|[^\p{L}\d])(?:не|нет|без|отсутств[а-яё]*|не(?:проверен|извест|уточн|определ|замерен|измерен|подтвержд)[а-яё]*|предполага[а-яё]*|будущ[а-яё]*|планиру[а-яё]*)(?=$|[^\p{L}\d])|\?/iu
const heightTopic =
  /(?:^\s*[hн](?:[12](?=\s|[-–—=:])|(?=\s|[-–—=:]|пр\.?))|высот|натяжн|подвесн|потолок|балк[аи]|отметк)/iu
const quantity =
  /(?:^|[\s=:+−–—-])((?:\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d+)(?:[.,]\d+)?)\s*(мм|см|mm|cm|м|m)(?=$|[\s.,;:)])/giu
const pointValid = (point: PagePoint) =>
  [point.x, point.y].every((value) => Number.isFinite(value) && value >= 0 && value <= 1000)

function kindOf(text: string): NativeHeightObservation['quantityKind'] {
  if (qualifiedHeight.test(text)) return 'unclassified-height'
  if (/(?:^|[^\p{L}\d])[hн][12](?=\s|[-–—=:])/iu.test(text)) return 'unclassified-height'
  const finished =
    /(?:натяжн|подвесн|чистов|чист)[а-яё]*\s+потол[а-яё]*|потол[а-яё]*\s*[-:–—]?\s+(?:натяжн|подвесн|чистов|чист)[а-яё]*|^(?:натяжной|подвесной)\s*[-=–—:]\s*\d/iu.test(
      text,
    )
  const otherObject = /шкаф|светильн|люстр|гарнитур|мебел/iu.test(text)
  const structural = /плит[а-яё]*|перекрыти[а-яё]*|конструктивн[а-яё]*|толщин/iu.test(text)
  const opening = /(?:[hн]\s*пр\.?|высот[а-яё]*\s+(?:дверного\s+|оконного\s+)?про[её]м)/iu.test(
    text,
  )
  const beam =
    /(?:до\s+(?:низа\s+)?балки|низ\s+балки|(?:уровень|отметка)\s+(?:низа\s+)?балки)/iu.test(text)
  if (
    Number(finished) + Number(opening) + Number(beam) !== 1 ||
    (finished && (structural || otherObject))
  )
    return 'unclassified-height'
  return finished ? 'finished-ceiling' : opening ? 'opening-height' : 'beam-level'
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
      if (!heightTopic.test(text)) continue
      const matches = [...text.matchAll(quantity)]
      if (matches.length !== 1) {
        issue(
          label.id,
          text,
          matches.length ? 'multiple-height-quantities' : 'no-literal-unit-qualified-height',
        )
        continue
      }
      const match = matches[0] as RegExpMatchArray
      const raw = match[1] as string,
        unit = (match[2] as string).toLocaleLowerCase('ru')
      const prefix = text.slice(0, match.index ?? 0)
      const suffix = text.slice((match.index ?? 0) + match[0].length)
      const rest = `${prefix}${suffix}`.replace(/(?:^|[^\p{L}\d])[hн][12](?=$|\s|[-–—=:])/giu, '')
      if (/\d/u.test(rest)) {
        issue(label.id, text, 'ambiguous-numeric-height-caption')
        continue
      }
      const beforeNumber = prefix + match[0].slice(0, match[0].indexOf(raw))
      const sign = /([-−])\s*$/u.exec(beforeNumber)
      const stem = sign ? beforeNumber.slice(0, sign.index).trim() : ''
      const conventionalSeparator = /^(?:[hн][12]?[^=:\d−-]*|натяжн[а-яё]*|подвесн[а-яё]*)$/iu.test(
        stem,
      )
      const negative = Boolean(sign && (sign[1] === '−' || !conventionalSeparator))
      const multiplier =
        unit === 'м' || unit === 'm' ? 1000 : unit === 'см' || unit === 'cm' ? 10 : 1
      const valueMm =
        Number(raw.replace(/[ \u00a0\u202f]/gu, '').replace(',', '.')) *
        multiplier *
        (negative ? -1 : 1)
      if (!Number.isFinite(valueMm)) {
        issue(label.id, text, 'invalid-height-quantity')
        continue
      }
      const quantityKind = kindOf(text)
      const existingFloor = /от\s+(?:уровня\s+)?существующего\s+пола/iu.test(text)
      const finishedFloor = /от\s+(?:уровня\s+)?(?:чистого|чистового|готового)\s+пола/iu.test(text)
      const datum =
        qualifiedHeight.test(text) || existingFloor === finishedFloor
          ? 'unspecified'
          : existingFloor
            ? 'existing-floor'
            : 'finished-floor'
      const issueCodes: string[] = []
      if (quantityKind === 'unclassified-height') issueCodes.push('height-role-unclassified')
      if (datum === 'unspecified') issueCodes.push('height-datum-unverified')
      if (existingFloor && finishedFloor) issueCodes.push('ambiguous-height-datum')
      if (valueMm <= 0 || valueMm > 6000) issueCodes.push('height-outside-model-range')
      observations.push({
        labelId: label.id,
        originalText: text,
        pagePoint: { ...(label.pagePoint as PagePoint) },
        valueMm,
        quantityKind,
        datum,
        issueCodes,
        mayAcceptFor3D: false,
      })
      if (observations.length > MAX_OBSERVATIONS) return finish('height-observation-output-limit')
      for (const code of issueCodes) issue(label.id, text, code)
    }
    return finish(null)
  } catch (error) {
    if (error === outputLimit) return finish('height-observation-output-limit')
    throw error
  }
}
