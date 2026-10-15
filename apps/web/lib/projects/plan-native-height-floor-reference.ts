import { nativeCaptionKnownPaintBlockers } from './plan-native-caption-paint'
import {
  nativeFinishedFloorHeightReference,
  nativeFinishedFloorHeightReferenceTopic,
} from './plan-native-height-datum-caption'
import { nativeResetNoteBounds } from './plan-native-height-group'
import { nativeHeightObservations } from './plan-native-height-observations'
import { nativeCaptionInkIssue } from './plan-pdf-caption-binding'
import type { PagePoint } from './plan-pdf-linework'

type Input = Parameters<typeof nativeHeightObservations>[0]
const validPoint = (point: PagePoint | undefined): point is PagePoint =>
  !!point &&
  [point.x, point.y].every((value) => Number.isFinite(value) && value >= 0 && value <= 1000)
export type NativeHeightFloorReferences = {
  status: 'draft' | 'unresolved'
  refusalReason: string | null
  references: {
    labelId: string
    originalText: string
    status: 'verified' | 'unresolved'
    datum: 'local-finished-floor' | null
    inkSourceOperations: number[]
    reason: string | null
  }[]
  commonWorldZeroConfirmed: false
  coplanarFloorsConfirmed: false
  geometryOwnersConfirmed: false
  mayTransfer2D3D: false
}

/** A source note can specify the reference kind, never each floor's world elevation. */
export function nativeHeightFloorReferenceEvidence(input: Input): NativeHeightFloorReferences {
  const references: NativeHeightFloorReferences['references'] = []
  const finish = (reason: string | null): NativeHeightFloorReferences => ({
    status: reason ? 'unresolved' : 'draft',
    refusalReason: reason,
    references: reason ? [] : references,
    commonWorldZeroConfirmed: false,
    coplanarFloorsConfirmed: false,
    geometryOwnersConfirmed: false,
    mayTransfer2D3D: false,
  })
  const sourceCheck = nativeHeightObservations(input)
  if (sourceCheck.refusalReason) return finish(sourceCheck.refusalReason)
  if (input.native.vectorInkRefusal) return finish(input.native.vectorInkRefusal)
  const labels = input.native.labels.filter((label) =>
    nativeFinishedFloorHeightReferenceTopic(label.name),
  )
  if (labels.length > 20) return finish('floor-reference-budget')
  for (const label of labels)
    references.push({
      labelId: label.id,
      originalText: label.name,
      status: 'unresolved',
      datum: null,
      inkSourceOperations: [],
      reason: nativeFinishedFloorHeightReference(label.name)
        ? 'floor-reference-ink-unavailable'
        : 'unsupported-floor-reference',
    })
  if (!labels.length) return finish(null)
  const ink = input.native.heightFloorReferenceInk
  if (!ink) return finish(null)
  if (
    !ink.source ||
    ink.source.sha256 !== input.source.sha256 ||
    ink.source.pdfPage !== input.source.pdfPage ||
    ink.source.pageWidth !== input.work.pageWidth ||
    ink.source.pageHeight !== input.work.pageHeight
  )
    return finish('different-floor-reference-source')
  if (
    !Array.isArray(ink.items) ||
    !Array.isArray(ink.unresolved) ||
    ink.items.length + ink.unresolved.length !== labels.length ||
    typeof ink.complete !== 'boolean' ||
    ink.complete !== (ink.unresolved.length === 0)
  )
    return finish('invalid-floor-reference-inventory')
  if (ink.refusalReason) return finish(ink.refusalReason)
  const expected = new Set(labels.map((label) => label.nativeIndex))
  const indexes = new Set<number>()
  for (const item of [...ink.items, ...ink.unresolved]) {
    if (
      !item ||
      !Number.isSafeInteger(item.index) ||
      !expected.has(item.index) ||
      indexes.has(item.index)
    )
      return finish('invalid-floor-reference-inventory')
    indexes.add(item.index)
  }
  const operations = new Set<number>()
  for (const item of ink.items) {
    const label = labels.find((label) => label.nativeIndex === item.index)
    const row = references.find((row) => row.labelId === label?.id)
    if (
      !label ||
      !row ||
      item.text !== label.name ||
      !Number.isSafeInteger(item.operationIndex) ||
      item.operationIndex < 0 ||
      !validPoint(item.baselineStart) ||
      !validPoint(item.baselineEnd)
    )
      return finish('invalid-floor-reference-provenance')
    if (!nativeFinishedFloorHeightReference(label.name)) continue
    const reset = item.sourceResetCaption
    const resetBounds = reset ? nativeResetNoteBounds(item, label, input.work) : null
    if (
      reset
        ? !resetBounds
        : !label.pagePoint ||
          !item.baselineStart ||
          Math.abs(item.baselineStart.x - label.pagePoint.x) > 1e-7 ||
          Math.abs(item.baselineStart.y - label.pagePoint.y) > 1e-7
    )
      return finish('invalid-floor-reference-provenance')
    const refs = reset ? reset.shows.map((show) => show.operationIndex) : [item.operationIndex]
    if (refs.some((ref) => !Number.isSafeInteger(ref) || ref < 0 || operations.has(ref)))
      return finish('invalid-floor-reference-provenance')
    for (const ref of refs) operations.add(ref)
    // The native note and its glyph baseline must agree in physical PDF axes.
    // A valid envelope alone must not certify a differently rotated reference.
    const dx = (item.baselineEnd.x - item.baselineStart.x) * input.work.pageWidth
    const dy = (item.baselineEnd.y - item.baselineStart.y) * input.work.pageHeight
    const delta = Math.abs(
      ((-Math.atan2(dy, dx) * 180) / Math.PI - (label.rotation as number)) % 360,
    )
    if (!Number.isFinite(delta) || (dx === 0 && dy === 0) || Math.min(delta, 360 - delta) > 1e-6)
      return finish('invalid-floor-reference-provenance')
    if (
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
        input.work,
      )
    )
      return finish('invalid-floor-reference-provenance')
    const blockers = nativeCaptionKnownPaintBlockers(
      input.work.paintBounds,
      refs,
      resetBounds ?? item.quad,
    )
    if (blockers === null) {
      row.reason = 'floor-reference-paint-inventory-unavailable'
      continue
    }
    if (blockers.length) {
      row.reason = 'later-paint-may-cover-floor-reference'
      continue
    }
    row.status = 'verified'
    row.datum = 'local-finished-floor'
    row.reason = null
    row.inkSourceOperations = refs
  }
  return finish(null)
}
