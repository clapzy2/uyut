import type { PlanPageSegmentRef } from '@uyut/db'
import { exactNativePointKey } from './plan-native-exact-intersections'
import {
  nativeFaceRationalPredicates,
  nativePagePointKeyIsCanonical,
} from './plan-native-face-rational'
import type { PagePoint, PdfLinework } from './plan-pdf-linework'
import { pdfPaintInventoryIsComplete, pdfPaintMayTouchSpan } from './plan-pdf-paint-exclusion'

export type NativeSourceSpanVisibility = {
  status: 'unoccluded' | 'held'
  reason: string | null
  sourceRef: PlanPageSegmentRef | null
  blockerOperations: number[]
}

export class NativeSourceVisibilityLimit extends Error {
  constructor() {
    super('source-span-visibility-limit')
  }
}

/** Display probes are conservative exclusions only; source membership remains rational. */
function displayPoint(key: string): PagePoint | null {
  if (!nativePagePointKeyIsCanonical(key)) return null
  const coordinates = key.split(':').map((part) => {
    const [numerator, denominator] = part.split('/').map(BigInt)
    if (numerator === undefined || !denominator || numerator > 1000n * denominator) return null
    return Number(numerator) / Number(denominator)
  })
  const [x, y] = coordinates
  return x !== null &&
    x !== undefined &&
    y !== null &&
    y !== undefined &&
    Number.isFinite(x) &&
    Number.isFinite(y)
    ? { x, y }
    : null
}

/** Same-source literal span plus all later paint envelopes, not wall/material acceptance. */
export function createNativeSourceSpanVisibility(work: PdfLinework) {
  const exact = nativeFaceRationalPredicates()
  const paths = new Map(
    work.paths.map((path) => [`${path.operationIndex}:${path.subpathIndex}`, path]),
  )
  const counts = new Map<number, number>()
  for (const path of work.paths)
    counts.set(path.operationIndex, (counts.get(path.operationIndex) ?? 0) + 1)
  const events = work.paintBounds?.events ?? []
  const ownEvents = new Map(events.map((event) => [event.operationIndex, event]))
  const complete =
    pdfPaintInventoryIsComplete(work.paintBounds) &&
    work.paths.every((path) => ownEvents.get(path.operationIndex)?.kind === 'vector') &&
    [...(work.skippedCurveBounds ?? []), ...(work.clippedPathBounds ?? [])].every(
      (item) => ownEvents.get(item.operationIndex)?.kind === 'vector',
    )
  const omitted = new Set(
    [...(work.skippedCurveBounds ?? []), ...(work.clippedPathBounds ?? [])].map(
      (item) => item.operationIndex,
    ),
  )
  let workLeft = 2_000_000
  let outputLeft = 20_000
  return (
    ref: PlanPageSegmentRef,
    startKey: string,
    endKey: string,
  ): NativeSourceSpanVisibility => {
    const result: NativeSourceSpanVisibility = {
      status: 'held',
      reason: 'paint-envelope-inventory-unavailable',
      sourceRef: null,
      blockerOperations: [],
    }
    if (!complete) return result
    const path = paths.get(`${ref.operationIndex}:${ref.subpathIndex}`)
    const own = ownEvents.get(ref.operationIndex)
    if (
      !path ||
      own?.kind !== 'vector' ||
      !own.bounds ||
      own.subpathCount !== 1 ||
      counts.get(ref.operationIndex) !== 1 ||
      !Number.isInteger(ref.segmentIndex) ||
      ref.segmentIndex < 0 ||
      omitted.has(ref.operationIndex)
    ) {
      result.reason = 'source-span-provenance-unavailable'
      return result
    }
    const first = path.points[0],
      last = path.points.at(-1)
    const explicitReturn = first && last && first.x === last.x && first.y === last.y
    const count = path.points.length - (explicitReturn ? 1 : 0)
    if (ref.segmentIndex >= (path.closed ? count : path.points.length - 1)) {
      result.reason = 'source-span-snapshot-mismatch'
      return result
    }
    const sourceStart = path.points[ref.segmentIndex],
      sourceEnd = path.points[(ref.segmentIndex + 1) % count]
    const a = sourceStart && exactNativePointKey(sourceStart),
      b = sourceEnd && exactNativePointKey(sourceEnd)
    const start = displayPoint(startKey),
      end = displayPoint(endKey)
    if (
      !a ||
      !b ||
      !start ||
      !end ||
      !exact.sharedSpan(startKey, endKey, startKey, endKey) ||
      !exact.coversSpan(startKey, endKey, [{ startKey: a, endKey: b }])
    ) {
      result.reason = 'source-span-snapshot-mismatch'
      return result
    }
    result.sourceRef = {
      operationIndex: ref.operationIndex,
      subpathIndex: ref.subpathIndex,
      segmentIndex: ref.segmentIndex,
    }
    // 0.001 source-coordinate quantization plus helper arithmetic padding bounds
    // every exclusion query; it cannot create a contact or erase a short gap.
    for (const event of events) {
      if (--workLeft < 0) throw new NativeSourceVisibilityLimit()
      if (
        event.operationIndex <= ref.operationIndex ||
        !pdfPaintMayTouchSpan(event, [start, end], 0.0005)
      )
        continue
      if (--outputLeft < 0) throw new NativeSourceVisibilityLimit()
      result.blockerOperations.push(event.operationIndex)
    }
    result.blockerOperations.sort((a, b) => a - b)
    result.status = result.blockerOperations.length ? 'held' : 'unoccluded'
    result.reason = result.blockerOperations.length ? 'later-paint-may-cover-source-span' : null
    return result
  }
}
