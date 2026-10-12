import type { PlanPageSegmentRef } from '@uyut/db'
import { exactNativePointKey } from './plan-native-exact-intersections'
import { nativeFaceRationalPredicates } from './plan-native-face-rational'
import type { PdfLinework } from './plan-pdf-linework'

export type SelectedDimensionEndpointBinding = {
  status: 'continuous' | 'detached' | 'ambiguous' | 'unresolved'
  reason: string | null
  witnesses: {
    status: 'continuous' | 'detached' | 'ambiguous' | 'unresolved'
    tipKey: string
    cornerKey: string
    sourceRefs: PlanPageSegmentRef[]
  }[]
}

/** Literal drafting witnesses only. Their finite ends never bridge a physical gap. */
export function selectedDimensionWitnesses(
  work: PdfLinework,
  spend: () => void,
  spendRefs: (count: number) => void,
) {
  const exact = nativeFaceRationalPredicates()
  const strokes = work.paths.flatMap((path) => {
    spend()
    if (path.paint !== 'stroke' || path.closed || path.points.length !== 2) return []
    const [start, end] = path.points
    if (!start || !end) return []
    if (
      !Number.isSafeInteger(path.operationIndex) ||
      path.operationIndex < 0 ||
      path.operationIndex >= 100_000 ||
      !Number.isSafeInteger(path.subpathIndex) ||
      path.subpathIndex < 0 ||
      path.subpathIndex > 3000
    )
      throw new Error('Unsupported source witness reference')
    const startKey = exactNativePointKey(start)
    const endKey = exactNativePointKey(end)
    if (!startKey || !endKey || startKey === endKey) return []
    return [
      {
        startKey,
        endKey,
        ref: {
          operationIndex: path.operationIndex,
          subpathIndex: path.subpathIndex,
          segmentIndex: 0,
        },
      },
    ]
  })
  const onSpan = (key: string, start: string, end: string) =>
    exact.orientation(start, end, key) === 0 &&
    exact.compareAxis(key, start, 'x') * exact.compareAxis(key, end, 'x') <= 0 &&
    exact.compareAxis(key, start, 'y') * exact.compareAxis(key, end, 'y') <= 0
  const witness = (tipKey: string, cornerKey: string) => {
    const matches: typeof strokes = []
    if (tipKey !== cornerKey) {
      for (const stroke of strokes) {
        spend()
        if (!onSpan(tipKey, stroke.startKey, stroke.endKey)) continue
        if (!exact.sharedSpan(tipKey, cornerKey, stroke.startKey, stroke.endKey)) continue
        matches.push(stroke)
        if (matches.length > 100) throw new Error('Source witness contact limit')
      }
    }
    const groups = new Set(
      matches.map(({ startKey, endKey }) => [startKey, endKey].sort().join('|')),
    )
    spendRefs(matches.length)
    const status =
      groups.size > 1
        ? ('ambiguous' as const)
        : groups.size === 0
          ? ('unresolved' as const)
          : matches.some((stroke) => onSpan(cornerKey, stroke.startKey, stroke.endKey))
            ? ('continuous' as const)
            : ('detached' as const)
    return { status, tipKey, cornerKey, sourceRefs: matches.map(({ ref }) => ({ ...ref })) }
  }
  return (tips: [string, string], corners: [string, string]): SelectedDimensionEndpointBinding => {
    // A translated equal vector needs the actual physical-page perpendicular offsets.
    // Normalized image axes alone are insufficient for diagonal dimensions.
    const perpendicular = tips.every(
      (tip, index) =>
        tip !== corners[index] &&
        exact.physicalDotSign(
          tips[0],
          tips[1],
          tip,
          corners[index] as string,
          work.pageWidth,
          work.pageHeight,
        ) === 0,
    )
    if (!perpendicular)
      return {
        status: 'unresolved',
        reason: 'source-corner-offset-not-perpendicular',
        witnesses: [],
      }
    const witnesses = tips.map((tip, index) => witness(tip, corners[index] as string))
    const status = witnesses.some((row) => row.status === 'ambiguous')
      ? 'ambiguous'
      : witnesses.some((row) => row.status === 'unresolved')
        ? 'unresolved'
        : witnesses.some((row) => row.status === 'detached')
          ? 'detached'
          : 'continuous'
    return {
      status,
      reason:
        status === 'ambiguous'
          ? 'competing-bounded-source-witnesses'
          : status === 'unresolved'
            ? 'missing-bounded-source-witness'
            : status === 'detached'
              ? 'detached-source-extension'
              : null,
      witnesses,
    }
  }
}
