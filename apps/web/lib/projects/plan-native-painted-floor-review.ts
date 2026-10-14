import { exactNativePointKey } from './plan-native-exact-intersections'
import { nativeFaceRationalPredicates } from './plan-native-face-rational'
import { nativeVisiblePaintRegions } from './plan-native-visible-paint'
import type { PagePoint } from './plan-pdf-linework'
import type { PdfPlanSource } from './plan-pdf-room-binding'
import { bindObservedRegionLabels, type RegionLabelFrame } from './plan-raster-region-labels'

type Common = Parameters<typeof nativeVisiblePaintRegions>[0]
export type PaintedFloorBoundaryRole =
  | 'wall-face'
  | 'opening-boundary'
  | 'level-separator'
  | 'unresolved'
export type ReviewedNativePaintedFloors = {
  review: 'manual-native-painted-floor-review'
  source: PdfPlanSource
  rasterSource: RegionLabelFrame
  floors: {
    candidateId: string
    pieceIndex: number
    polygon: PagePoint[]
    holes: PagePoint[][]
    owner: { sourceRoomKey: string; nameLabelId: string; numberLabelId: string }
    boundaryRoles: { edgeIndex: number; kind: PaintedFloorBoundaryRole }[]
  }[]
}
export const nativePaintedFloorRoomName =
  /^(?:прихожая|кухня(?:[-–— ]гостиная)?|гостиная|спальня|коридор|ванная|санузел|туалет|комната|жилая комната|детская|кабинет|гардероб(?:ная)?|кладовая|балкон|лоджия)(?:\s+\d{1,2})?$/iu
const roles = new Set<PaintedFloorBoundaryRole>([
  'wall-face',
  'opening-boundary',
  'level-separator',
  'unresolved',
])
const sameRing = (left: PagePoint[], right: PagePoint[]) =>
  left.length === right.length &&
  left.every((point, index) => point?.x === right[index]?.x && point?.y === right[index]?.y)
const pointKey = (point: PagePoint) => `${point.x}:${point.y}`
const onlyKeys = (value: unknown, keys: readonly string[]): boolean =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).every((key) => keys.includes(key))
export const canonicalNativePaintedFloorRoomKey = (value: string) =>
  typeof value === 'string' &&
  /^[1-9]\d{0,4}(?:\.\d{1,3})?$/.test(value) &&
  Number(value) <= 10_000 &&
  Number(value).toString() === value

/** Explicit source-space floor selections, not automatically accepted physical floors.
 * Caption origins establish the reviewed association only, never whole-glyph containment.
 * Boundary roles are declarations, not wall/jamb/threshold or visibility proofs.
 */
export function nativePaintedFloorReview(
  input: Common & { reviewed: ReviewedNativePaintedFloors },
) {
  const { native, reviewed } = input
  type Region = ReturnType<typeof nativeVisiblePaintRegions>['regions'][number]
  type Piece = Region['pieces'][number]
  const floors: {
    id: string
    candidateId: string
    pieceIndex: number
    owner: ReviewedNativePaintedFloors['floors'][number]['owner'] & { name: string }
    polygon: PagePoint[]
    holes: PagePoint[][]
    exactPointKeys: string[]
    holeExactPointKeys: string[][]
    edges: (Piece['edges'][number] & { declaredRole: PaintedFloorBoundaryRole })[]
    sourceRef: Region['sourceRef']
    masks: Region['masks']
    intersections: Region['intersections']
    omittedStrokeCount: number
    boundaryInkComplete: boolean
  }[] = []
  const finish = (refusalReason: string | null) => ({
    status: refusalReason ? ('held' as const) : ('reviewed-draft' as const),
    refusalReason,
    source: { ...reviewed?.source },
    rasterSource: { ...native.source },
    floors: refusalReason ? [] : structuredClone(floors),
    basis: 'explicit-source-painted-floor-review' as const,
    ownerBasis: 'reviewed-literal-caption-origins' as const,
    readOnly: true as const,
    physicalBoundariesAccepted: false as const,
    measurementsConfirmed: false as const,
    commonZeroConfirmed: false as const,
    readyFor2D: false as const,
    readyFor3D: false as const,
  })
  if (
    !onlyKeys(reviewed, ['review', 'source', 'rasterSource', 'floors']) ||
    !onlyKeys(reviewed.source, ['sha256', 'pdfPage', 'state']) ||
    !onlyKeys(reviewed.rasterSource, ['sha256', 'page', 'width', 'height'])
  )
    return finish('invalid-painted-floor-review')
  if (
    reviewed.review !== 'manual-native-painted-floor-review' ||
    reviewed.source?.state !== 'existing' ||
    reviewed.source.sha256 !== native.originalPdfSha256 ||
    reviewed.source.pdfPage !== native.source.page
  )
    return finish('painted-floor-review-source-mismatch')
  try {
    for (const frame of [input.lineworkSource, reviewed.rasterSource]) {
      bindObservedRegionLabels({
        regionSource: native.source,
        labelSource: frame,
        regions: [],
        labels: [],
      })
    }
  } catch {
    return finish('painted-floor-review-frame-mismatch')
  }
  if (
    !native.complete ||
    !Array.isArray(native.labels) ||
    native.labels.length > 1000 ||
    native.labels.some((label) => !label || typeof label !== 'object')
  )
    return finish('painted-floor-label-inventory-incomplete')
  if (!Array.isArray(reviewed.floors) || reviewed.floors.length < 1 || reviewed.floors.length > 50)
    return finish('painted-floor-review-limit')
  const labels = new Map(native.labels.map((label) => [label.id, label]))
  if (
    labels.size !== native.labels.length ||
    new Set(native.labels.map((label) => label.nativeIndex)).size !== native.labels.length
  )
    return finish('invalid-painted-floor-label-provenance')
  let points = 0
  for (const floor of reviewed.floors) {
    if (
      !onlyKeys(floor, [
        'candidateId',
        'pieceIndex',
        'polygon',
        'holes',
        'owner',
        'boundaryRoles',
      ]) ||
      !onlyKeys(floor.owner, ['sourceRoomKey', 'nameLabelId', 'numberLabelId']) ||
      typeof floor.candidateId !== 'string' ||
      floor.candidateId.length > 128 ||
      !Number.isSafeInteger(floor.pieceIndex) ||
      floor.pieceIndex < 0 ||
      floor.pieceIndex >= 100 ||
      !Array.isArray(floor.polygon) ||
      floor.polygon.length < 3 ||
      floor.polygon.length > 100 ||
      !Array.isArray(floor.holes) ||
      floor.holes.length > 50 ||
      floor.holes.some((hole) => !Array.isArray(hole) || hole.length < 3 || hole.length > 100) ||
      !Array.isArray(floor.boundaryRoles) ||
      floor.boundaryRoles.length !== floor.polygon.length
    )
      return finish('invalid-painted-floor-review')
    const rings = [floor.polygon, ...floor.holes]
    points += rings.reduce((count, ring) => count + ring.length, 0)
    if (points > 10_000) return finish('painted-floor-review-limit')
    if (
      rings.some((ring) =>
        ring.some(
          (point) =>
            !onlyKeys(point, ['x', 'y']) ||
            ![point.x, point.y].every(
              (value) => Number.isFinite(value) && value >= 0 && value <= 1000,
            ),
        ),
      )
    )
      return finish('invalid-painted-floor-review')
  }
  let paint: ReturnType<typeof nativeVisiblePaintRegions>
  try {
    paint = nativeVisiblePaintRegions(input)
  } catch {
    return finish('painted-floor-source-unavailable')
  }
  if (paint.refusalReason) return finish(paint.refusalReason)
  const seenPieces = new Set<string>()
  const seenOwners = new Set<string>()
  const seenLabels = new Set<string>()
  const exact = nativeFaceRationalPredicates()
  for (const selection of reviewed.floors) {
    const region = paint.regions.find((region) => region.candidateId === selection.candidateId)
    const piece = region?.pieces[selection.pieceIndex]
    if (
      region?.status !== 'diagnostic' ||
      !piece ||
      !sameRing(selection.polygon, piece.polygon) ||
      selection.holes.length !== piece.holes.length ||
      selection.holes.some((hole, index) => !sameRing(hole, piece.holes[index] as PagePoint[]))
    )
      return finish('stale-painted-floor-selection')
    const id = `${selection.candidateId}:piece-${selection.pieceIndex}`
    if (seenPieces.has(id)) return finish('duplicate-painted-floor-piece')
    seenPieces.add(id)
    const owner = selection.owner
    const name = owner && labels.get(owner.nameLabelId)
    const number = owner && labels.get(owner.numberLabelId)
    const scale = native.pageNormalizedScale
    if (
      !owner ||
      !canonicalNativePaintedFloorRoomKey(owner.sourceRoomKey) ||
      !name ||
      !number ||
      !nativePaintedFloorRoomName.test(name.name) ||
      number.name !== owner.sourceRoomKey ||
      !scale ||
      [name, number].some(
        (label) =>
          !Number.isSafeInteger(label.nativeIndex) ||
          (label.nativeIndex ?? -1) < 0 ||
          label.id !== `native-text-${label.nativeIndex}` ||
          !label.pagePoint ||
          exactNativePointKey(label.pagePoint) === null ||
          !Number.isFinite(label.rotation) ||
          !label.point ||
          ![label.point.x, label.point.y].every(Number.isFinite) ||
          Math.abs(label.point.x - label.pagePoint.x * scale.x) > 1e-7 ||
          Math.abs(label.point.y - label.pagePoint.y * scale.y) > 1e-7,
      )
    )
      return finish('invalid-painted-floor-owner')
    if (
      seenOwners.has(owner.sourceRoomKey) ||
      [name.id, number.id].some((id) => seenLabels.has(id))
    )
      return finish('duplicate-painted-floor-owner')
    seenOwners.add(owner.sourceRoomKey)
    seenLabels.add(name.id)
    seenLabels.add(number.id)
    const proofs = new Map(
      region.intersections.map((proof) => [pointKey(proof.point), proof.exactPointKey]),
    )
    const ringKeys = (ring: PagePoint[]) =>
      ring.map((point) => proofs.get(pointKey(point)) ?? exactNativePointKey(point))
    const keys = ringKeys(piece.polygon)
    const holeKeys = piece.holes.map(ringKeys)
    if (
      keys.some((key) => !key) ||
      holeKeys.some((hole) => hole.some((key) => !key)) ||
      !exact.simple(keys as string[]) ||
      holeKeys.some((hole) => !exact.simple(hole as string[]))
    )
      return finish('unresolved-painted-floor-topology')
    for (const label of [name, number]) {
      const key = exactNativePointKey(label.pagePoint as PagePoint) as string
      if (
        exact.location(keys as string[], key) !== 'inside' ||
        holeKeys.some((hole) => exact.location(hole as string[], key) !== 'outside')
      )
        return finish('painted-floor-owner-outside-piece')
    }
    const declared = new Map<number, PaintedFloorBoundaryRole>()
    for (const role of selection.boundaryRoles) {
      if (
        !onlyKeys(role, ['edgeIndex', 'kind']) ||
        !Number.isSafeInteger(role.edgeIndex) ||
        role.edgeIndex < 0 ||
        role.edgeIndex >= piece.polygon.length ||
        declared.has(role.edgeIndex) ||
        !roles.has(role.kind)
      )
        return finish('invalid-painted-floor-boundary-roles')
      declared.set(role.edgeIndex, role.kind)
    }
    // Original paint pieces can retain an edge array in their source command order.
    // Map by untouched endpoint identity, not by assuming canonical polygon order.
    const edges = piece.polygon.map((start, index) => {
      const end = piece.polygon[(index + 1) % piece.polygon.length] as PagePoint
      const matches = piece.edges.filter(
        (edge) =>
          (pointKey(edge.start) === pointKey(start) && pointKey(edge.end) === pointKey(end)) ||
          (pointKey(edge.end) === pointKey(start) && pointKey(edge.start) === pointKey(end)),
      )
      const match = matches[0]
      const declaredRole = declared.get(index)
      return matches.length === 1 && match && declaredRole
        ? { start, end, sourceRefs: match.sourceRefs, declaredRole }
        : null
    })
    if (edges.some((edge) => !edge)) return finish('unresolved-painted-floor-edge-provenance')
    floors.push({
      id,
      candidateId: region.candidateId,
      pieceIndex: selection.pieceIndex,
      owner: { ...owner, name: name.name },
      polygon: piece.polygon,
      holes: piece.holes,
      exactPointKeys: keys as string[],
      holeExactPointKeys: holeKeys as string[][],
      edges: edges as NonNullable<(typeof edges)[number]>[],
      sourceRef: region.sourceRef,
      masks: region.masks,
      intersections: region.intersections,
      omittedStrokeCount: region.omittedStrokeCount,
      boundaryInkComplete: region.boundaryInkComplete,
    })
  }
  return finish(null)
}
