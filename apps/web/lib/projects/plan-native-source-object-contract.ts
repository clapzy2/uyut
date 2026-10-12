import { nativeFinishedFloorHeightReference } from './plan-native-height-datum-caption'
import type { NativeReviewPacket } from './plan-native-review-packet'

const only = (value: object, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key))
const bounded = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 200
const count = (value: unknown, maximum = 100_000) =>
  Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= maximum
const label = (value: unknown) => typeof value === 'string' && /^native-text-\d{1,4}$/.test(value)
const roomKey = (value: unknown) =>
  typeof value === 'string' &&
  /^[1-9]\d{0,4}(?:\.\d{1,3})?$/.test(value) &&
  Number(value) <= 10_000 &&
  Number(value).toString() === value

function floorReferences(value: NativeReviewPacket['heightFloorReferences']): boolean {
  if (value === undefined) return true
  if (
    !value ||
    !only(value, [
      'status',
      'refusalReason',
      'references',
      'commonWorldZeroConfirmed',
      'coplanarFloorsConfirmed',
      'geometryOwnersConfirmed',
      'mayTransfer2D3D',
    ]) ||
    value.commonWorldZeroConfirmed !== false ||
    value.coplanarFloorsConfirmed !== false ||
    value.geometryOwnersConfirmed !== false ||
    value.mayTransfer2D3D !== false ||
    !Array.isArray(value.references) ||
    value.references.length > 20
  )
    return false
  if (value.status === 'unresolved')
    return bounded(value.refusalReason) && value.references.length === 0
  if (value.status !== 'draft' || value.refusalReason !== null) return false
  const seen = new Set<string>(),
    operations = new Set<number>()
  return value.references.every((row) => {
    if (
      !row ||
      !only(row, ['labelId', 'originalText', 'status', 'datum', 'inkSourceOperations', 'reason']) ||
      !label(row.labelId) ||
      seen.has(row.labelId) ||
      !bounded(row.originalText) ||
      !Array.isArray(row.inkSourceOperations) ||
      row.inkSourceOperations.length > 50
    )
      return false
    seen.add(row.labelId)
    if (row.status === 'unresolved')
      return row.datum === null && bounded(row.reason) && row.inkSourceOperations.length === 0
    if (
      row.status !== 'verified' ||
      row.reason !== null ||
      row.datum !== 'local-finished-floor' ||
      !nativeFinishedFloorHeightReference(row.originalText) ||
      !row.inkSourceOperations.length
    )
      return false
    let previous = -1
    for (const operation of row.inkSourceOperations) {
      if (!count(operation) || operation <= previous || operations.has(operation)) return false
      operations.add(operation)
      previous = operation
    }
    return true
  })
}

function panelEnds(packet: NativeReviewPacket): boolean {
  const value = packet.filledPanelEnds
  if (value === undefined) return true
  if (
    !value ||
    !only(value, [
      'status',
      'refusalReason',
      'physicalJambAccepted',
      'wallOwnershipConfirmed',
      'panels',
    ]) ||
    value.physicalJambAccepted !== false ||
    value.wallOwnershipConfirmed !== false ||
    !Array.isArray(value.panels) ||
    value.panels.length > 100
  )
    return false
  if (value.status === 'unresolved')
    return bounded(value.refusalReason) && value.panels.length === 0
  if (
    value.status !== 'draft' ||
    value.refusalReason !== null ||
    packet.filledPanelSymbols?.status !== 'draft'
  )
    return false
  const ids = new Set(packet.filledPanelSymbols.candidates.map((panel) => panel.id))
  if (value.panels.length !== ids.size) return false
  let sourceCount = 0
  return value.panels.every((panel) => {
    if (
      !panel ||
      !only(panel, ['panelId', 'status', 'ends']) ||
      !ids.delete(panel.panelId) ||
      !Array.isArray(panel.ends) ||
      panel.ends.length !== 2
    )
      return false
    const symbol = packet.filledPanelSymbols?.candidates.find(
      (symbol) => symbol.id === panel.panelId,
    )
    const body = symbol?.polygons[0]
    if (!symbol || !body || body.length < 4) return false
    const lengths = body.slice(0, 4).map((start, index) => {
      const end = body[(index + 1) % 4]
      return end ? Math.hypot(end.x - start.x, end.y - start.y) : Number.NaN
    })
    const shortParity =
      Math.max(lengths[0] ?? 0, lengths[2] ?? 0) < Math.max(lengths[1] ?? 0, lengths[3] ?? 0)
        ? 0
        : 1
    for (const end of panel.ends) {
      if (
        !end ||
        !only(end, ['edgeIndex', 'status', 'coverage', 'reason', 'sourceEdges']) ||
        !count(end.edgeIndex, 3) ||
        !['matched', 'partial', 'ambiguous', 'unobserved', 'unresolved'].includes(end.status) ||
        !['complete', 'partial', 'unproved'].includes(end.coverage) ||
        !Array.isArray(end.sourceEdges)
      )
        return false
      sourceCount += end.sourceEdges.length
      if (sourceCount > 1000) return false
      const refs = new Set<string>()
      for (const ref of end.sourceEdges) {
        if (
          !ref ||
          !only(ref, ['operationIndex', 'subpathIndex', 'segmentIndex']) ||
          ![ref.operationIndex, ref.subpathIndex, ref.segmentIndex].every((index) => count(index))
        )
          return false
        if (
          symbol.sourceRefs.some(
            (own) =>
              own.operationIndex === ref.operationIndex && own.subpathIndex === ref.subpathIndex,
          )
        )
          return false
        const key = `${ref.operationIndex}:${ref.subpathIndex}:${ref.segmentIndex}`
        if (refs.has(key)) return false
        refs.add(key)
      }
      if (
        end.status === 'matched'
          ? end.coverage !== 'complete' || end.reason !== null || !refs.size
          : !bounded(end.reason)
      )
        return false
      if (end.status === 'unobserved' && (refs.size !== 0 || end.coverage !== 'unproved'))
        return false
    }
    const first = panel.ends[0],
      second = panel.ends[1]
    if (
      !first ||
      !second ||
      first.edgeIndex !== shortParity ||
      second.edgeIndex !== shortParity + 2
    )
      return false
    const expected = panel.ends.some((end) => end.status === 'unresolved')
      ? 'unresolved'
      : panel.ends.some((end) => end.status === 'ambiguous')
        ? 'ambiguous'
        : panel.ends.every((end) => end.status === 'matched')
          ? 'paired'
          : panel.ends.every((end) => end.status === 'unobserved')
            ? 'unobserved'
            : 'partial'
    return panel.status === expected
  })
}

function savedFloors(packet: NativeReviewPacket): boolean {
  const value = packet.savedPaintedFloors
  if (value === undefined) return true
  if (
    !value ||
    !only(value, [
      'status',
      'reason',
      'physicalBoundariesAccepted',
      'measurementsConfirmed',
      'commonZeroConfirmed',
      'floors',
    ]) ||
    value.physicalBoundariesAccepted !== false ||
    value.measurementsConfirmed !== false ||
    value.commonZeroConfirmed !== false ||
    !Array.isArray(value.floors) ||
    value.floors.length > 50
  )
    return false
  if (value.status === 'not-saved') return value.reason === null && value.floors.length === 0
  if (value.status === 'refused') return bounded(value.reason) && value.floors.length === 0
  if (value.status !== 'checked' || value.reason !== null || !value.floors.length) return false
  const ids = new Set<string>(),
    owners = new Set<string>(),
    labels = new Set<string>()
  let pointCount = 0
  const ring = (points: { x: number; y: number }[]) =>
    Array.isArray(points) &&
    points.length >= 3 &&
    points.length <= 100 &&
    points.every((point) => {
      pointCount++
      return (
        point &&
        Number.isFinite(point.x) &&
        Number.isFinite(point.y) &&
        point.x >= 0 &&
        point.y >= 0 &&
        point.x <= packet.image.width &&
        point.y <= packet.image.height
      )
    })
  return value.floors.every((floor) => {
    if (
      !floor ||
      !only(floor, [
        'id',
        'candidateId',
        'sourceRoomKey',
        'name',
        'nameLabelId',
        'numberLabelId',
        'polygon',
        'holes',
        'unresolvedEdges',
        'omittedStrokeCount',
        'boundaryInkComplete',
      ]) ||
      typeof floor.id !== 'string' ||
      !/^native-fill-\d+:\d+:piece-\d{1,2}$/.test(floor.id) ||
      floor.candidateId !== floor.id.split(':piece-')[0] ||
      ids.has(floor.id) ||
      !roomKey(floor.sourceRoomKey) ||
      owners.has(floor.sourceRoomKey) ||
      !bounded(floor.name) ||
      !label(floor.nameLabelId) ||
      !label(floor.numberLabelId) ||
      floor.nameLabelId === floor.numberLabelId ||
      [floor.nameLabelId, floor.numberLabelId].some((id) => labels.has(id)) ||
      !ring(floor.polygon) ||
      !Array.isArray(floor.holes) ||
      floor.holes.length > 50 ||
      !floor.holes.every(ring) ||
      pointCount > 10_000 ||
      !count(floor.unresolvedEdges, floor.polygon.length) ||
      !count(floor.omittedStrokeCount) ||
      typeof floor.boundaryInkComplete !== 'boolean' ||
      (floor.omittedStrokeCount > 0 && floor.boundaryInkComplete)
    )
      return false
    const region = packet.orderedPaint?.regions.find(
      (region) => region.candidateId === floor.candidateId,
    )
    const pieceIndex = Number(floor.id.split(':piece-')[1])
    const piece = region?.pieces[pieceIndex]
    const sameRing = (left: { x: number; y: number }[], right: { x: number; y: number }[]) =>
      left.length === right.length &&
      left.every((point, index) => point.x === right[index]?.x && point.y === right[index]?.y)
    if (
      packet.orderedPaint?.status !== 'diagnostic' ||
      region?.status !== 'diagnostic' ||
      !piece ||
      !sameRing(floor.polygon, piece.polygon) ||
      floor.holes.length !== piece.holes.length ||
      floor.holes.some((hole, index) => !sameRing(hole, piece.holes[index] ?? []))
    )
      return false
    ids.add(floor.id)
    owners.add(floor.sourceRoomKey)
    labels.add(floor.nameLabelId)
    labels.add(floor.numberLabelId)
    return true
  })
}

/** Optional source-object reports stay separate from accepted geometry in every wire version. */
export function nativeSourceObjectReportsValid(packet: NativeReviewPacket): boolean {
  return (
    floorReferences(packet.heightFloorReferences) &&
    panelEnds(packet) &&
    savedFloors(packet) &&
    savedFloorHeights(packet)
  )
}

function savedFloorHeights(packet: NativeReviewPacket): boolean {
  const report = packet.savedFloorHeights
  if (report === undefined) return true
  if (
    !report ||
    !only(report, [
      'status',
      'reason',
      'associationBasis',
      'physicalBoundariesAccepted',
      'ceilingHeightsConfirmed',
      'commonZeroConfirmed',
      'readyFor2D',
      'readyFor3D',
      'bindings',
    ]) ||
    report.associationBasis !== 'manual-whole-source-caption-in-selected-floor' ||
    report.physicalBoundariesAccepted !== false ||
    report.ceilingHeightsConfirmed !== false ||
    report.commonZeroConfirmed !== false ||
    report.readyFor2D !== false ||
    report.readyFor3D !== false ||
    !Array.isArray(report.bindings) ||
    report.bindings.length > 50
  )
    return false
  if (report.status === 'not-saved') return report.reason === null && !report.bindings.length
  if (report.status === 'refused') return bounded(report.reason) && !report.bindings.length
  if (
    report.status !== 'checked' ||
    report.reason !== null ||
    packet.savedPaintedFloors?.status !== 'checked' ||
    packet.heightObservations?.status !== 'draft'
  )
    return false
  const floorIds = new Set<string>(),
    labelIds = new Set<string>()
  return report.bindings.every((row) => {
    if (
      !row ||
      !only(row, [
        'floorId',
        'sourceRoomKey',
        'name',
        'labelId',
        'originalText',
        'valueMm',
        'quantityKind',
        'localReferenceLabelId',
      ]) ||
      floorIds.has(row.floorId) ||
      labelIds.has(row.labelId)
    )
      return false
    const floor = packet.savedPaintedFloors?.floors.find((floor) => floor.id === row.floorId)
    const height = packet.heightObservations?.observations.find(
      (height) => height.labelId === row.labelId,
    )
    const reference = packet.heightFloorReferences?.references.find(
      (reference) => reference.labelId === row.localReferenceLabelId,
    )
    if (
      !floor ||
      !height ||
      !reference ||
      floor.sourceRoomKey !== row.sourceRoomKey ||
      floor.name !== row.name ||
      height.originalText !== row.originalText ||
      height.valueMm !== row.valueMm ||
      height.quantityKind !== row.quantityKind ||
      !height.unitEvidence ||
      !/^[hн]\s*=\s*\d{1,4}$/iu.test(row.originalText) ||
      row.quantityKind !== 'unclassified-height' ||
      height.unitEvidence.inkSourceOperation === null ||
      reference.status !== 'verified' ||
      reference.datum !== 'local-finished-floor'
    )
      return false
    floorIds.add(row.floorId)
    labelIds.add(row.labelId)
    return true
  })
}
