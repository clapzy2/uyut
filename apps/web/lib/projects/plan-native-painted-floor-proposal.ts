import { exactNativePointKey } from './plan-native-exact-intersections'
import { nativeFaceRationalPredicates } from './plan-native-face-rational'
import {
  canonicalNativePaintedFloorRoomKey,
  nativePaintedFloorReview,
  nativePaintedFloorRoomName,
  type ReviewedNativePaintedFloors,
} from './plan-native-painted-floor-review'
import { nativeVisiblePaintRegions } from './plan-native-visible-paint'

type Input = Parameters<typeof nativeVisiblePaintRegions>[0]
type Floor = ReviewedNativePaintedFloors['floors'][number]

/** Unsaved source-exact suggestions. A contained caption is not proof of a physical floor. */
export function nativePaintedFloorProposal(input: Input) {
  const empty = (reason: string) => ({ proposal: null, suggested: 0, skipped: 0, reason })
  const { native } = input
  if (!native.complete || !native.originalPdfSha256 || !native.pageNormalizedScale)
    return empty('Нативные подписи исходного PDF недоступны.')
  const paint = nativeVisiblePaintRegions(input)
  if (paint.refusalReason) return empty('Контуры исходного PDF пока нельзя надёжно выделить.')
  const exact = nativeFaceRationalPredicates()
  const floors: Floor[] = []
  let skipped = 0

  for (const region of paint.regions) {
    for (const [pieceIndex, piece] of region.pieces.entries()) {
      if (region.status !== 'diagnostic') {
        skipped++
        continue
      }
      const proofKeys = new Map(
        region.intersections.map((proof) => [
          `${proof.point.x}:${proof.point.y}`,
          proof.exactPointKey,
        ]),
      )
      const ringKeys = (ring: typeof piece.polygon) =>
        ring.map((point) => proofKeys.get(`${point.x}:${point.y}`) ?? exactNativePointKey(point))
      const outline = ringKeys(piece.polygon)
      const holes = piece.holes.map(ringKeys)
      if (outline.some((key) => !key) || holes.some((hole) => hole.some((key) => !key))) {
        skipped++
        continue
      }
      const contains = (label: (typeof native.labels)[number]) => {
        const key = label.pagePoint && exactNativePointKey(label.pagePoint)
        return (
          key &&
          exact.location(outline as string[], key) === 'inside' &&
          holes.every((hole) => exact.location(hole as string[], key) === 'outside')
        )
      }
      const labels = native.labels.filter(contains)
      const names = labels.filter((label) => nativePaintedFloorRoomName.test(label.name))
      const numbers = labels.filter((label) => canonicalNativePaintedFloorRoomKey(label.name))
      const name = names[0]
      const nameIndex = name?.nativeIndex
      const namePoint = name?.pagePoint
      const adjacentNumbers =
        namePoint && typeof nameIndex === 'number'
          ? numbers.filter(
              (number) =>
                typeof number.nativeIndex === 'number' &&
                number.pagePoint &&
                number.nativeIndex > nameIndex &&
                number.nativeIndex - nameIndex <= 3 &&
                Math.hypot(number.pagePoint.x - namePoint.x, number.pagePoint.y - namePoint.y) <=
                  30,
            )
          : []
      const number = adjacentNumbers[0]
      if (names.length !== 1 || !name || adjacentNumbers.length !== 1 || !number) {
        skipped++
        continue
      }
      floors.push({
        candidateId: region.candidateId,
        pieceIndex,
        polygon: piece.polygon,
        holes: piece.holes,
        owner: {
          sourceRoomKey: number.name,
          nameLabelId: name.id,
          numberLabelId: number.id,
        },
        boundaryRoles: piece.polygon.map((_, edgeIndex) => ({ edgeIndex, kind: 'unresolved' })),
      })
    }
  }

  // If two painted pieces contain the same caption, neither ownership is unambiguous.
  const ownerCounts = new Map<string, number>()
  for (const floor of floors)
    ownerCounts.set(
      floor.owner.sourceRoomKey,
      (ownerCounts.get(floor.owner.sourceRoomKey) ?? 0) + 1,
    )
  const unique = floors.filter((floor) => ownerCounts.get(floor.owner.sourceRoomKey) === 1)
  skipped += floors.length - unique.length
  if (!unique.length)
    return { ...empty('Не найдены однозначные пары подписей внутри контуров.'), skipped }
  const proposal: ReviewedNativePaintedFloors = {
    review: 'manual-native-painted-floor-review',
    source: { sha256: native.originalPdfSha256, pdfPage: native.source.page, state: 'existing' },
    rasterSource: native.source,
    floors: unique,
  }
  const checked = nativePaintedFloorReview({ ...input, reviewed: proposal })
  if (checked.status !== 'reviewed-draft')
    return { ...empty('Предложение не прошло повторную сверку с исходным PDF.'), skipped }
  return { proposal, suggested: unique.length, skipped, reason: null }
}
