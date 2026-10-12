import { z } from 'zod'
import { exactNativePointKey } from './plan-native-exact-intersections'
import { nativeFaceRationalPredicates } from './plan-native-face-rational'
import { nativeHeightFloorReferenceEvidence } from './plan-native-height-floor-reference'
import { nativeHeightGroupBounds } from './plan-native-height-group'
import { nativeHeightObservations } from './plan-native-height-observations'
import {
  nativePaintedFloorReview,
  type ReviewedNativePaintedFloors,
} from './plan-native-painted-floor-review'
import { nativeCaptionInkIssue } from './plan-pdf-caption-binding'
import type { PagePoint } from './plan-pdf-linework'

export const reviewedFloorHeightsSchema = z
  .object({
    review: z.literal('manual-native-room-height-review'),
    source: z
      .object({
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        pdfPage: z.number().int().min(1).max(9999),
        state: z.literal('existing'),
      })
      .strict(),
    rasterSource: z
      .object({
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        page: z.number().int().min(1).max(9999),
        width: z.number().int().min(1).max(100_000),
        height: z.number().int().min(1).max(100_000),
      })
      .strict(),
    floorReviewSavedAt: z.string().datetime(),
    bindings: z
      .array(
        z
          .object({
            floorId: z.string().min(1).max(128),
            labelId: z
              .string()
              .regex(/^native-text-\d+$/)
              .max(128),
          })
          .strict(),
      )
      .max(50),
  })
  .strict()
export type ReviewedNativeFloorHeights = z.infer<typeof reviewedFloorHeightsSchema>
type Input = Omit<Parameters<typeof nativeHeightObservations>[0], 'source'> & {
  reviewedFloors: ReviewedNativePaintedFloors
  floorReviewSavedAt: string
  reviewed?: unknown
}

/** Whole caption containment uses the unrounded paint topology, including holes. */
function containsCaption(
  floor: ReturnType<typeof nativePaintedFloorReview>['floors'][number],
  polygon: PagePoint[],
) {
  const keys = polygon.map(exactNativePointKey)
  if (keys.some((key) => !key)) return false
  const caption = keys as string[]
  const predicates = nativeFaceRationalPredicates()
  if (caption.some((key) => predicates.location(floor.exactPointKeys, key) !== 'inside'))
    return false
  for (const ring of [floor.exactPointKeys, ...floor.holeExactPointKeys]) {
    if (
      ring !== floor.exactPointKeys &&
      (caption.some((key) => predicates.location(ring, key) !== 'outside') ||
        ring.some((key) => predicates.location(caption, key) !== 'outside'))
    )
      return false
    if (
      ring.some((key, edge) =>
        caption.some((corner, index) =>
          predicates.segmentsTouch(
            key,
            ring[(edge + 1) % ring.length] as string,
            corner,
            caption[(index + 1) % caption.length] as string,
          ),
        ),
      )
    )
      return false
  }
  return true
}

/** A manually reviewed source association, never an accepted ceiling or shared elevation. */
export function nativeReviewedFloorHeightBindings(input: Input) {
  const source = input.reviewedFloors.source
  const common = { ...input, source }
  const floors = nativePaintedFloorReview({ ...input, reviewed: input.reviewedFloors })
  const options: {
    floorId: string
    sourceRoomKey: string
    name: string
    labelId: string
    originalText: string
    valueMm: number
    quantityKind: string
    localReferenceLabelId: string
  }[] = []
  const bindings: typeof options = []
  const finish = (reason: string | null) => ({
    status: reason ? ('held' as const) : ('draft' as const),
    refusalReason: reason,
    review: {
      review: 'manual-native-room-height-review' as const,
      source: { ...source },
      rasterSource: { ...input.native.source },
      floorReviewSavedAt: input.floorReviewSavedAt,
      bindings: reason ? [] : bindings.map(({ floorId, labelId }) => ({ floorId, labelId })),
    },
    floors: reason
      ? []
      : floors.floors.map(({ id, owner }) => ({
          id,
          sourceRoomKey: owner.sourceRoomKey,
          name: owner.name,
        })),
    options: reason ? [] : options,
    bindings: reason ? [] : bindings,
    associationBasis: 'manual-whole-source-caption-in-selected-floor' as const,
    physicalBoundariesAccepted: false as const,
    ceilingHeightsConfirmed: false as const,
    commonZeroConfirmed: false as const,
    readyFor2D: false as const,
    readyFor3D: false as const,
  })
  if (floors.refusalReason) return finish(floors.refusalReason)
  if (!z.string().datetime().safeParse(input.floorReviewSavedAt).success)
    return finish('invalid-floor-review-revision')
  const heights = nativeHeightObservations(common)
  const references = nativeHeightFloorReferenceEvidence(common)
  if (heights.refusalReason || references.refusalReason)
    return finish(heights.refusalReason ?? references.refusalReason)
  const verifiedReferences = references.references.filter(
    (row) => row.status === 'verified' && row.datum === 'local-finished-floor',
  )
  if (references.references.length !== 1 || verifiedReferences.length !== 1)
    return finish('local-floor-reference-unverified')
  const ink = input.native.heightCaptionInk
  if (
    !ink ||
    input.native.vectorInkRefusal ||
    ink.refusalReason ||
    !ink.source ||
    ink.source.sha256 !== source.sha256 ||
    ink.source.pdfPage !== source.pdfPage ||
    ink.source.pageWidth !== input.work.pageWidth ||
    ink.source.pageHeight !== input.work.pageHeight ||
    !Array.isArray(ink.items) ||
    !Array.isArray(ink.unresolved) ||
    ink.items.length + ink.unresolved.length > 100 ||
    ink.complete !== (ink.unresolved.length === 0)
  )
    return finish('height-caption-ink-unverified')
  const expected = new Set(heights.observations.map((row) => Number(row.labelId.slice(12))))
  const indexes = new Set<number>()
  for (const item of [...ink.items, ...ink.unresolved]) {
    if (
      !item ||
      !Number.isSafeInteger(item.index) ||
      !expected.has(item.index) ||
      indexes.has(item.index)
    )
      return finish('invalid-height-ink-inventory')
    indexes.add(item.index)
  }
  if (indexes.size !== expected.size) return finish('incomplete-height-ink-inventory')
  const operations = new Set<number>()
  let containmentBudget = 500_000
  for (const item of ink.items) {
    const label = input.native.labels.find((label) => label.nativeIndex === item.index)
    const height = heights.observations.find((row) => row.labelId === label?.id)
    if (
      !label?.pagePoint ||
      !height ||
      item.text !== label.name ||
      !item.baselineStart ||
      !item.baselineEnd ||
      !Array.isArray(item.quad) ||
      item.quad.length !== 4 ||
      item.quad.some(
        (point) =>
          !point ||
          ![point.x, point.y].every(
            (value) => Number.isFinite(value) && value >= 0 && value <= 1000,
          ),
      )
    )
      return finish('invalid-height-ink-provenance')
    const bounds = item.sourceGroup ? nativeHeightGroupBounds(item, label, input.work) : item.quad
    const refs = item.sourceGroup?.operationIndexes ?? [item.operationIndex]
    if (
      !bounds ||
      refs.some(
        (operation) =>
          !Number.isSafeInteger(operation) || operation < 0 || operations.has(operation),
      ) ||
      (!item.sourceGroup &&
        (Math.abs(item.baselineStart.x - label.pagePoint.x) > 1e-7 ||
          Math.abs(item.baselineStart.y - label.pagePoint.y) > 1e-7))
    )
      return finish('invalid-height-ink-provenance')
    for (const operation of refs) operations.add(operation)
    const dx = (item.baselineEnd.x - item.baselineStart.x) * input.work.pageWidth
    const dy = (item.baselineEnd.y - item.baselineStart.y) * input.work.pageHeight
    const delta = Math.abs(
      ((-Math.atan2(dy, dx) * 180) / Math.PI - (label.rotation as number)) % 360,
    )
    if (
      !Number.isFinite(delta) ||
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
        input.work,
      )
    )
      return finish('invalid-height-ink-provenance')
    // Bare H is retained only with verified mm ink. The explicit room review
    // supplies an association, not the missing object kind or a world datum.
    if (
      !height.unitEvidence ||
      height.unitEvidence.inkSourceOperation === null ||
      !/^[hн]\s*=\s*\d{1,4}$/iu.test(height.originalText)
    )
      continue
    const owners: typeof floors.floors = []
    for (const floor of floors.floors) {
      containmentBudget -=
        (floor.exactPointKeys.length +
          floor.holeExactPointKeys.reduce((count, ring) => count + ring.length, 0)) *
        bounds.length *
        4
      if (containmentBudget < 0) return finish('room-height-containment-budget')
      if (containsCaption(floor, bounds)) owners.push(floor)
    }
    if (owners.length !== 1) continue
    const floor = owners[0] as (typeof floors.floors)[number]
    options.push({
      floorId: floor.id,
      sourceRoomKey: floor.owner.sourceRoomKey,
      name: floor.owner.name,
      labelId: height.labelId,
      originalText: height.originalText,
      valueMm: height.valueMm,
      quantityKind: height.quantityKind,
      localReferenceLabelId: verifiedReferences[0]?.labelId as string,
    })
  }
  if (input.reviewed !== undefined) {
    const parsed = reviewedFloorHeightsSchema.safeParse(input.reviewed)
    if (!parsed.success) return finish('invalid-room-height-review')
    const reviewed = parsed.data
    if (
      reviewed.source.sha256 !== source.sha256 ||
      reviewed.source.pdfPage !== source.pdfPage ||
      reviewed.source.state !== source.state ||
      Object.entries(input.native.source).some(
        ([key, value]) =>
          reviewed.rasterSource[key as keyof typeof reviewed.rasterSource] !== value,
      ) ||
      reviewed.floorReviewSavedAt !== input.floorReviewSavedAt
    )
      return finish('stale-room-height-review')
    const floorIds = new Set<string>(),
      labelIds = new Set<string>()
    for (const binding of reviewed.bindings) {
      if (floorIds.has(binding.floorId) || labelIds.has(binding.labelId))
        return finish('duplicate-room-height-owner')
      floorIds.add(binding.floorId)
      labelIds.add(binding.labelId)
      const option = options.find(
        (option) => option.floorId === binding.floorId && option.labelId === binding.labelId,
      )
      if (!option) return finish('room-height-caption-not-eligible')
      bindings.push({ ...option })
    }
  }
  return finish(null)
}
