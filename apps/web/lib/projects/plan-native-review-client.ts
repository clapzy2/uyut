import type { NativeReviewPacket } from './plan-native-review-packet'

export class NativeReviewRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

function isCandidateLayer(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const layer = value as { status: unknown; refusalReason: unknown; candidates: unknown[] }
  return (
    (layer.status === 'draft' || layer.status === 'unresolved') &&
    Array.isArray(layer.candidates) &&
    layer.candidates.length <= 100 &&
    (layer.status === 'draft'
      ? layer.refusalReason === null
      : typeof layer.refusalReason === 'string' &&
        !!layer.refusalReason.trim() &&
        layer.refusalReason.length <= 128 &&
        layer.candidates.length === 0)
  )
}

function isInImage(value: unknown, image: NativeReviewPacket['image']): boolean {
  if (!value || typeof value !== 'object') return false
  const point = value as { x: number; y: number }
  return (
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.x >= 0 &&
    point.y >= 0 &&
    point.x <= image.width &&
    point.y <= image.height
  )
}

function isSourceSegment(value: unknown, image: NativeReviewPacket['image']): boolean {
  if (!value || typeof value !== 'object') return false
  const segment = value as { start: { x: number; y: number }; end: { x: number; y: number } }
  return (
    isInImage(segment.start, image) &&
    isInImage(segment.end, image) &&
    (segment.start.x !== segment.end.x || segment.start.y !== segment.end.y)
  )
}

function isSourceQuad(value: unknown, image: NativeReviewPacket['image']): boolean {
  if (!Array.isArray(value) || ![4, 5].includes(value.length)) return false
  if (!value.every((point) => isInImage(point, image))) return false
  const first = value[0]
  const last = value.at(-1)
  if (value.length === 5 && (first.x !== last.x || first.y !== last.y)) return false
  return new Set(value.slice(0, 4).map((point) => `${point.x}:${point.y}`)).size === 4
}

function isDoorProfile(
  candidate: NonNullable<NativeReviewPacket['doorSymbols']>['candidates'][number],
  image: NativeReviewPacket['image'],
): boolean {
  const { leafProfile, swingAngleDegrees, leafParts } = candidate
  if (leafProfile === undefined && swingAngleDegrees === undefined && leafParts === undefined)
    return true
  if (typeof swingAngleDegrees !== 'number' || !Number.isFinite(swingAngleDegrees)) return false
  if (leafProfile === 'single-stroke')
    return (
      leafParts === undefined &&
      isSourceSegment(candidate.leaf, image) &&
      Math.abs(swingAngleDegrees - 90) <= (0.005 * 180) / Math.PI
    )
  return (
    leafProfile === 'capped-panel' &&
    swingAngleDegrees >= 80 &&
    swingAngleDegrees <= 100 &&
    Array.isArray(leafParts) &&
    leafParts.length === 3 &&
    leafParts.every((part) => isSourceSegment(part, image))
  )
}

function isDoorSymbols(value: unknown, image: NativeReviewPacket['image']): boolean {
  if (value === undefined) return true
  if (!isCandidateLayer(value)) return false
  const symbols = value as NonNullable<NativeReviewPacket['doorSymbols']>
  const inImage = (point: unknown) => isInImage(point, image)
  const ids = new Set<string>()
  return symbols.candidates.every((candidate) => {
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      typeof candidate.id !== 'string' ||
      !candidate.id.trim() ||
      candidate.id.length > 128 ||
      ids.has(candidate.id) ||
      !candidate.arc ||
      !inImage(candidate.arc.start) ||
      !Array.isArray(candidate.arc.segments) ||
      candidate.arc.segments.length < 1 ||
      candidate.arc.segments.length > 4 ||
      !candidate.leaf ||
      !inImage(candidate.leaf.start) ||
      !inImage(candidate.leaf.end) ||
      !isDoorProfile(candidate, image) ||
      !Number.isFinite(candidate.endpointResidualPixels) ||
      candidate.endpointResidualPixels < 0 ||
      candidate.endpointResidualPixels > 0.1
    )
      return false
    ids.add(candidate.id)
    return candidate.arc.segments.every(
      (segment) =>
        segment &&
        typeof segment === 'object' &&
        inImage(segment.control1) &&
        inImage(segment.control2) &&
        inImage(segment.end),
    )
  })
}

function isOpeningFrames(value: unknown, image: NativeReviewPacket['image']): boolean {
  if (value === undefined) return true
  if (!isCandidateLayer(value)) return false
  const frames = value as NonNullable<NativeReviewPacket['openingFrames']>
  const ids = new Set<string>()
  return frames.candidates.every((frame) => {
    if (
      !frame ||
      typeof frame !== 'object' ||
      typeof frame.id !== 'string' ||
      !frame.id.trim() ||
      frame.id.length > 128 ||
      ids.has(frame.id) ||
      !isSourceQuad(frame.polygon, image)
    )
      return false
    ids.add(frame.id)
    return true
  })
}

function isGlazingSymbols(value: unknown, image: NativeReviewPacket['image']): boolean {
  if (value === undefined) return true
  if (!isCandidateLayer(value)) return false
  const symbols = value as NonNullable<NativeReviewPacket['glazingSymbols']>
  const ids = new Set<string>()
  return symbols.candidates.every((candidate) => {
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      typeof candidate.id !== 'string' ||
      !candidate.id.trim() ||
      candidate.id.length > 128 ||
      ids.has(candidate.id) ||
      !Array.isArray(candidate.polygons) ||
      candidate.polygons.length !== 3 ||
      !candidate.polygons.every((polygon) => isSourceQuad(polygon, image)) ||
      !isSourceSegment(candidate.centerline, image)
    )
      return false
    ids.add(candidate.id)
    return true
  })
}

function isSourceLinks(value: unknown, packet: NativeReviewPacket): boolean {
  if (value === undefined) return true
  if (!value || typeof value !== 'object') return false
  const links = value as NonNullable<NativeReviewPacket['sourceLinks']>
  if (
    !Array.isArray(links.doors) ||
    !Array.isArray(links.glazing) ||
    !Array.isArray(links.groups) ||
    [links.doors, links.glazing, links.groups].some((items) => items.length > 100)
  )
    return false
  if (links.status === 'unresolved')
    return (
      typeof links.refusalReason === 'string' &&
      !!links.refusalReason.trim() &&
      links.refusalReason.length <= 128 &&
      links.doors.length === 0 &&
      links.glazing.length === 0 &&
      links.groups.length === 0
    )
  if (links.status !== 'draft' || links.refusalReason !== null) return false
  if (
    packet.doorSymbols?.status === 'unresolved' ||
    packet.openingFrames?.status === 'unresolved' ||
    packet.glazingSymbols?.status === 'unresolved'
  )
    return false

  const doorIds = new Set(packet.doorSymbols?.candidates.map((candidate) => candidate.id) ?? [])
  const frameIds = new Set(packet.openingFrames?.candidates.map((candidate) => candidate.id) ?? [])
  const glazingIds = new Set(
    packet.glazingSymbols?.candidates.map((candidate) => candidate.id) ?? [],
  )
  if (links.doors.length !== doorIds.size || links.glazing.length !== glazingIds.size) return false
  const checkedDoors = new Set<string>()
  for (const door of links.doors) {
    if (
      !door ||
      typeof door !== 'object' ||
      !doorIds.has(door.symbolId) ||
      checkedDoors.has(door.symbolId) ||
      !['linked', 'ambiguous', 'unresolved'].includes(door.status)
    )
      return false
    checkedDoors.add(door.symbolId)
    if (door.status !== 'linked') {
      if (door.targetKind !== null || door.targetId !== null || door.relation !== null) return false
    } else if (door.targetKind === 'opening-frame') {
      if (!frameIds.has(door.targetId ?? '') || door.relation !== 'jamb-to-frame') return false
    } else if (door.targetKind === 'glazing-panel') {
      if (!glazingIds.has(door.targetId ?? '') || door.relation !== 'shared-cap-edge') return false
    } else return false
  }
  const checkedGlazing = new Set<string>()
  const twoSidedGlazing = new Set<string>()
  for (const glazing of links.glazing) {
    if (
      !glazing ||
      typeof glazing !== 'object' ||
      !glazingIds.has(glazing.symbolId) ||
      checkedGlazing.has(glazing.symbolId) ||
      !['two-sided', 'ambiguous', 'unresolved'].includes(glazing.status)
    )
      return false
    checkedGlazing.add(glazing.symbolId)
    if (glazing.status === 'two-sided') twoSidedGlazing.add(glazing.symbolId)
  }

  const groupIds = new Set<string>()
  const groupedGlazing = new Set<string>()
  const groupedDoors = new Set<string>()
  for (const group of links.groups) {
    if (
      !group ||
      typeof group !== 'object' ||
      typeof group.id !== 'string' ||
      !group.id.trim() ||
      group.id.length > 128 ||
      groupIds.has(group.id) ||
      !Array.isArray(group.glazingIds) ||
      group.glazingIds.length < 2 ||
      group.glazingIds.length > 100 ||
      !Array.isArray(group.doorIds) ||
      group.doorIds.length > 100
    )
      return false
    groupIds.add(group.id)
    for (const id of group.glazingIds) {
      if (!twoSidedGlazing.has(id) || groupedGlazing.has(id)) return false
      groupedGlazing.add(id)
    }
    for (const id of group.doorIds) {
      if (groupedDoors.has(id)) return false
      const door = links.doors.find((check) => check.symbolId === id)
      if (
        door?.status !== 'linked' ||
        door.targetKind !== 'glazing-panel' ||
        !group.glazingIds.includes(door.targetId ?? '')
      )
        return false
      groupedDoors.add(id)
    }
  }
  return true
}

function hasOnlyKeys(value: object, keys: string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && actual.every((key) => keys.includes(key))
}

function isBoundedLabel(value: unknown): value is string {
  return typeof value === 'string' && !!value.trim() && value.length <= 128
}

function isSourceNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 10000
}

function isNumberCircles(value: unknown): boolean {
  if (value === undefined) return true
  if (!value || typeof value !== 'object') return false
  const layer = value as NonNullable<NativeReviewPacket['numberCircles']>
  if (
    !hasOnlyKeys(layer, ['status', 'refusalReason', 'cues']) ||
    !Array.isArray(layer.cues) ||
    layer.cues.length > 100
  )
    return false
  if (layer.status === 'unresolved')
    return isBoundedLabel(layer.refusalReason) && layer.cues.length === 0
  if (layer.status !== 'draft' || layer.refusalReason !== null) return false
  const labelIds = new Set<string>()
  return layer.cues.every((cue) => {
    if (
      !cue ||
      typeof cue !== 'object' ||
      !hasOnlyKeys(cue, ['labelId', 'sourceNumber']) ||
      !isBoundedLabel(cue.labelId) ||
      labelIds.has(cue.labelId) ||
      !isSourceNumber(cue.sourceNumber)
    )
      return false
    labelIds.add(cue.labelId)
    return true
  })
}

function isRoomSchedule(value: unknown, packet: NativeReviewPacket): boolean {
  if (value === undefined) return true
  if (!value || typeof value !== 'object') return false
  const schedule = value as NonNullable<NativeReviewPacket['roomSchedule']>
  if (
    !hasOnlyKeys(schedule, ['status', 'refusalReason', 'rows', 'unlistedMarkerLabelIds']) ||
    !Array.isArray(schedule.rows) ||
    !Array.isArray(schedule.unlistedMarkerLabelIds) ||
    schedule.unlistedMarkerLabelIds.length > 100
  )
    return false
  if (schedule.status === 'unresolved')
    return (
      isBoundedLabel(schedule.refusalReason) &&
      schedule.rows.length === 0 &&
      schedule.unlistedMarkerLabelIds.length === 0
    )
  if (
    schedule.status !== 'draft' ||
    schedule.refusalReason !== null ||
    schedule.rows.length < 3 ||
    schedule.rows.length > 50 ||
    !packet.numberCircles
  )
    return false
  const circleNumbers = new Map(
    packet.numberCircles.cues.map(({ labelId, sourceNumber }) => [labelId, sourceNumber]),
  )
  const tableLabelIds = new Set<string>()
  const usedMarkerIds = new Set<string>()
  const tableNumbers = new Set<number>()
  for (const [index, row] of schedule.rows.entries()) {
    if (
      !row ||
      typeof row !== 'object' ||
      !hasOnlyKeys(row, [
        'sourceNumber',
        'name',
        'documentaryAreaM2',
        'numberLabelId',
        'nameLabelId',
        'areaLabelId',
        'markerStatus',
        'markerLabelIds',
      ]) ||
      row.sourceNumber !== index + 1 ||
      typeof row.name !== 'string' ||
      row.name !== row.name.trim() ||
      row.name.length < 1 ||
      row.name.length > 80 ||
      typeof row.documentaryAreaM2 !== 'number' ||
      !Number.isFinite(row.documentaryAreaM2) ||
      row.documentaryAreaM2 <= 0 ||
      row.documentaryAreaM2 > 999.99 ||
      !Array.isArray(row.markerLabelIds) ||
      row.markerLabelIds.length > 100
    )
      return false
    tableNumbers.add(row.sourceNumber)
    for (const id of [row.numberLabelId, row.nameLabelId, row.areaLabelId]) {
      if (!isBoundedLabel(id) || tableLabelIds.has(id) || circleNumbers.has(id)) return false
      tableLabelIds.add(id)
    }
    const count = row.markerLabelIds.length
    if (packet.numberCircles.status === 'unresolved') {
      if (row.markerStatus !== 'unavailable' || count !== 0) return false
    } else if (
      row.markerStatus !== (count === 0 ? 'unobserved' : count === 1 ? 'linked' : 'ambiguous')
    )
      return false
    for (const id of row.markerLabelIds) {
      if (
        !isBoundedLabel(id) ||
        circleNumbers.get(id) !== row.sourceNumber ||
        usedMarkerIds.has(id)
      )
        return false
      usedMarkerIds.add(id)
    }
  }
  for (const id of schedule.unlistedMarkerLabelIds) {
    const number = circleNumbers.get(id)
    if (
      !isBoundedLabel(id) ||
      number === undefined ||
      tableNumbers.has(number) ||
      usedMarkerIds.has(id)
    )
      return false
    usedMarkerIds.add(id)
  }
  return usedMarkerIds.size === circleNumbers.size
}

function isFloorCavities(value: unknown, packet: NativeReviewPacket): boolean {
  if (value === undefined) return true
  if (!value || typeof value !== 'object') return false
  const floor = value as NonNullable<NativeReviewPacket['floorCavities']>
  const collections = [
    floor.candidates,
    floor.thresholds,
    floor.closures,
    floor.unprovedCavities,
    floor.unresolvedMarkerLabelIds,
    ...(floor.markerLeaders !== undefined ? [floor.markerLeaders] : []),
  ]
  if (
    !hasOnlyKeys(floor, [
      'status',
      'refusalReason',
      'candidates',
      'thresholds',
      'closures',
      'unprovedCavities',
      'unresolvedMarkerLabelIds',
      'markersAvailable',
      ...('markerLeaders' in floor ? ['markerLeaders'] : []),
    ]) ||
    typeof floor.markersAvailable !== 'boolean' ||
    collections.some((items) => !Array.isArray(items) || items.length > 100)
  )
    return false
  if (floor.status === 'unresolved')
    return isBoundedLabel(floor.refusalReason) && collections.every((items) => items.length === 0)
  if (
    floor.status !== 'draft' ||
    floor.refusalReason !== null ||
    !packet.numberCircles ||
    packet.openingFrames?.status !== 'draft' ||
    floor.markersAvailable !== (packet.numberCircles.status === 'draft')
  )
    return false
  const boundedCount = (value: unknown, maximum: number) =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= maximum
  const frameIds = new Set(packet.openingFrames.candidates.map(({ id }) => id))
  const closures = new Map<string, boolean>()
  for (const threshold of floor.thresholds) {
    if (
      !threshold ||
      typeof threshold !== 'object' ||
      !hasOnlyKeys(threshold, ['frameId', 'paintAmbiguous']) ||
      !isBoundedLabel(threshold.frameId) ||
      !frameIds.has(threshold.frameId) ||
      closures.has(threshold.frameId) ||
      typeof threshold.paintAmbiguous !== 'boolean'
    )
      return false
    closures.set(threshold.frameId, threshold.paintAmbiguous)
  }
  for (const closure of floor.closures) {
    if (
      !closure ||
      typeof closure !== 'object' ||
      !hasOnlyKeys(closure, ['id', 'sourceKind', 'remainingSegmentCount', 'paintAmbiguous']) ||
      !isBoundedLabel(closure.id) ||
      closures.has(closure.id) ||
      !['closed-path', 'literal-closed-run'].includes(closure.sourceKind) ||
      !boundedCount(closure.remainingSegmentCount, 20000) ||
      typeof closure.paintAmbiguous !== 'boolean'
    )
      return false
    closures.set(closure.id, closure.paintAmbiguous)
  }
  const cueNumbers = new Map(
    packet.numberCircles.cues.map(({ labelId, sourceNumber }) => [labelId, sourceNumber]),
  )
  const numberCounts = new Map<number, number>()
  for (const number of cueNumbers.values())
    numberCounts.set(number, (numberCounts.get(number) ?? 0) + 1)
  const candidateIds = new Set<string>()
  const markerClaims = new Map<string, typeof floor.candidates>()
  let vertices = 0
  for (const cell of floor.candidates) {
    if (
      !cell ||
      typeof cell !== 'object' ||
      !hasOnlyKeys(cell, [
        'id',
        'polygon',
        'markerLabelIds',
        'markerStatus',
        'closureIds',
        'unknownInteriorStrokeCount',
        'omittedBoundaryInkCount',
      ]) ||
      !isBoundedLabel(cell.id) ||
      candidateIds.has(cell.id) ||
      !Array.isArray(cell.polygon) ||
      cell.polygon.length < 3 ||
      cell.polygon.length > 100 ||
      !cell.polygon.every(
        (point) => isInImage(point, packet.image) && hasOnlyKeys(point, ['x', 'y']),
      ) ||
      !Array.isArray(cell.markerLabelIds) ||
      cell.markerLabelIds.length > 100 ||
      !Array.isArray(cell.closureIds) ||
      cell.closureIds.length > 100 ||
      !boundedCount(cell.unknownInteriorStrokeCount, 20000) ||
      !boundedCount(cell.omittedBoundaryInkCount, 6000)
    )
      return false
    candidateIds.add(cell.id)
    vertices += cell.polygon.length
    if (vertices > 4000) return false
    const ownMarkers = new Set<string>()
    for (const id of cell.markerLabelIds) {
      if (!isBoundedLabel(id) || !cueNumbers.has(id) || ownMarkers.has(id)) return false
      ownMarkers.add(id)
      const claims = markerClaims.get(id) ?? []
      claims.push(cell)
      markerClaims.set(id, claims)
    }
    const ownClosures = new Set<string>()
    for (const id of cell.closureIds) {
      if (!isBoundedLabel(id) || closures.get(id) !== false || ownClosures.has(id)) return false
      ownClosures.add(id)
    }
    if (!floor.markersAvailable) {
      if (cell.markerStatus !== 'unavailable' || cell.markerLabelIds.length) return false
    } else if (cell.markerStatus === 'unmarked') {
      if (cell.markerLabelIds.length) return false
    } else if (
      !['unambiguous', 'ambiguous'].includes(cell.markerStatus) ||
      !cell.markerLabelIds.length
    )
      return false
  }
  for (const cell of floor.candidates) {
    const competition = cell.markerLabelIds.some(
      (id) =>
        (markerClaims.get(id)?.length ?? 0) > 1 ||
        (numberCounts.get(cueNumbers.get(id) as number) ?? 0) > 1,
    )
    if (cell.markerStatus === 'unambiguous' && competition) return false
    if (cell.markerStatus === 'ambiguous' && !competition) return false
  }
  const unresolved = new Set<string>()
  for (const id of floor.unresolvedMarkerLabelIds) {
    if (!isBoundedLabel(id) || !cueNumbers.has(id) || markerClaims.has(id) || unresolved.has(id))
      return false
    unresolved.add(id)
  }
  if (markerClaims.size + unresolved.size !== cueNumbers.size) return false
  const leaderLabels = new Set<string>()
  const leaderSegments = new Set<string>()
  for (const leader of floor.markerLeaders ?? []) {
    if (
      !floor.markersAvailable ||
      !leader ||
      typeof leader !== 'object' ||
      !hasOnlyKeys(leader, ['labelId', 'cavityId', 'circleEndpoint', 'segment']) ||
      !isBoundedLabel(leader.labelId) ||
      !cueNumbers.has(leader.labelId) ||
      leaderLabels.has(leader.labelId) ||
      !isBoundedLabel(leader.cavityId) ||
      !candidateIds.has(leader.cavityId) ||
      !markerClaims.get(leader.labelId)?.some((cell) => cell.id === leader.cavityId) ||
      !['start', 'end'].includes(leader.circleEndpoint) ||
      !leader.segment ||
      typeof leader.segment !== 'object' ||
      !hasOnlyKeys(leader.segment, [
        'operationIndex',
        'subpathIndex',
        'segmentIndex',
        'start',
        'end',
      ]) ||
      ![leader.segment.operationIndex, leader.segment.subpathIndex].every(
        (index) => Number.isSafeInteger(index) && index >= 0,
      ) ||
      leader.segment.segmentIndex !== 0 ||
      !isSourceSegment(leader.segment, packet.image) ||
      !hasOnlyKeys(leader.segment.start, ['x', 'y']) ||
      !hasOnlyKeys(leader.segment.end, ['x', 'y'])
    )
      return false
    const segmentKey = [
      leader.segment.operationIndex,
      leader.segment.subpathIndex,
      leader.segment.segmentIndex,
    ].join(':')
    if (leaderSegments.has(segmentKey)) return false
    leaderLabels.add(leader.labelId)
    leaderSegments.add(segmentKey)
  }
  return floor.unprovedCavities.every(
    (item) =>
      item &&
      typeof item === 'object' &&
      hasOnlyKeys(item, ['reason', 'vertexCount']) &&
      isBoundedLabel(item.reason) &&
      boundedCount(item.vertexCount, 100000) &&
      item.vertexCount >= 3,
  )
}

function isFloorOpeningSides(value: unknown, packet: NativeReviewPacket): boolean {
  if (value === undefined) return true
  if (!value || typeof value !== 'object') return false
  const report = value as NonNullable<NativeReviewPacket['floorOpeningSides']>
  if (
    !hasOnlyKeys(report, ['status', 'refusalReason', 'frames']) ||
    !Array.isArray(report.frames) ||
    report.frames.length > 100
  )
    return false
  if (report.status === 'unresolved')
    return isBoundedLabel(report.refusalReason) && report.frames.length === 0
  const floor = packet.floorCavities
  const frameLayer = packet.openingFrames
  if (
    report.status !== 'draft' ||
    report.refusalReason !== null ||
    floor?.status !== 'draft' ||
    frameLayer?.status !== 'draft'
  )
    return false
  const frameIds = new Set(frameLayer.candidates.map(({ id }) => id))
  if (report.frames.length !== frameIds.size) return false
  const cells = new Map(floor.candidates.map((cell) => [cell.id, cell]))
  const thresholds = new Map(floor.thresholds.map((threshold) => [threshold.frameId, threshold]))
  const checkedFrames = new Set<string>()
  let contactCount = 0
  let proofIndexCount = 0
  for (const frame of report.frames) {
    if (
      !frame ||
      typeof frame !== 'object' ||
      !hasOnlyKeys(frame, [
        'frameId',
        'status',
        'reason',
        'sides',
        'doorSymbolIds',
        'omittedInkCount',
      ]) ||
      !isBoundedLabel(frame.frameId) ||
      !frameIds.has(frame.frameId) ||
      checkedFrames.has(frame.frameId) ||
      !Array.isArray(frame.sides) ||
      ![0, 2].includes(frame.sides.length) ||
      !Array.isArray(frame.doorSymbolIds) ||
      frame.doorSymbolIds.length > 100 ||
      new Set(frame.doorSymbolIds).size !== frame.doorSymbolIds.length ||
      !frame.doorSymbolIds.every(isBoundedLabel) ||
      !Number.isSafeInteger(frame.omittedInkCount) ||
      frame.omittedInkCount < 0 ||
      frame.omittedInkCount > 6000
    )
      return false
    checkedFrames.add(frame.frameId)
    const expectedDoorIds =
      packet.sourceLinks?.status === 'draft'
        ? packet.sourceLinks.doors
            .filter(
              (door) =>
                door.status === 'linked' &&
                door.targetKind === 'opening-frame' &&
                door.targetId === frame.frameId,
            )
            .map(({ symbolId }) => symbolId)
        : []
    if (
      frame.doorSymbolIds.length !== expectedDoorIds.length ||
      frame.doorSymbolIds.some((id) => !expectedDoorIds.includes(id))
    )
      return false
    const threshold = thresholds.get(frame.frameId)
    if (!frame.sides.length) {
      if (frame.reason === 'logical-strip-unavailable') {
        if (frame.status !== 'unresolved' || threshold) return false
      } else if (frame.reason === 'competing-strip-paint') {
        if (frame.status !== 'ambiguous' || threshold?.paintAmbiguous !== true) return false
      } else if (frame.reason === 'strip-overlaps-cavity') {
        if (frame.status !== 'ambiguous' || threshold?.paintAmbiguous !== false) return false
      } else if (frame.reason === 'unproved-neighbor-region') {
        if (
          frame.status !== 'unresolved' ||
          threshold?.paintAmbiguous !== false ||
          floor.unprovedCavities.length === 0
        )
          return false
      } else return false
      continue
    }
    if (threshold?.paintAmbiguous !== false) return false
    const firstEdge = frame.sides[0]?.frameEdgeIndex
    const secondEdge = frame.sides[1]?.frameEdgeIndex
    if (
      !Number.isSafeInteger(firstEdge) ||
      !Number.isSafeInteger(secondEdge) ||
      (firstEdge ?? -1) < 0 ||
      (firstEdge ?? 4) > 3 ||
      (secondEdge ?? -1) < 0 ||
      (secondEdge ?? 4) > 3 ||
      Math.abs((firstEdge ?? 0) - (secondEdge ?? 0)) !== 2
    )
      return false
    for (const side of frame.sides) {
      if (
        !side ||
        typeof side !== 'object' ||
        !hasOnlyKeys(side, ['frameEdgeIndex', 'status', 'contacts']) ||
        !Array.isArray(side.contacts) ||
        side.contacts.length > 100
      )
        return false
      const contactedCells = new Set<string>()
      for (const contact of side.contacts) {
        if (
          !contact ||
          typeof contact !== 'object' ||
          !hasOnlyKeys(contact, ['cavityId', 'coverage', 'boundaryEdgeIndices']) ||
          !isBoundedLabel(contact.cavityId) ||
          contactedCells.has(contact.cavityId) ||
          !['complete', 'partial', 'unproved'].includes(contact.coverage) ||
          !Array.isArray(contact.boundaryEdgeIndices) ||
          contact.boundaryEdgeIndices.length < 1 ||
          contact.boundaryEdgeIndices.length > 100 ||
          new Set(contact.boundaryEdgeIndices).size !== contact.boundaryEdgeIndices.length
        )
          return false
        const cell = cells.get(contact.cavityId)
        if (
          !cell ||
          (contact.coverage !== 'unproved' && !cell.closureIds.includes(frame.frameId)) ||
          contact.boundaryEdgeIndices.some(
            (index) => !Number.isSafeInteger(index) || index < 0 || index >= cell.polygon.length,
          )
        )
          return false
        contactedCells.add(contact.cavityId)
        contactCount++
        proofIndexCount += contact.boundaryEdgeIndices.length
        if (contactCount > 1000 || proofIndexCount > 10000) return false
      }
      const expectedStatus =
        side.contacts.length > 1
          ? 'ambiguous'
          : side.contacts.length === 0
            ? 'unobserved'
            : side.contacts[0]?.coverage === 'complete'
              ? 'matched'
              : side.contacts[0]?.coverage === 'partial'
                ? 'partial'
                : 'unresolved'
      if (side.status !== expectedStatus) return false
    }
    const [first, second] = frame.sides
    if (frame.sides.some((side) => side.status === 'ambiguous')) {
      if (frame.status !== 'ambiguous' || frame.reason !== 'competing-cavity-contacts') return false
    } else if (frame.sides.every((side) => side.status === 'matched')) {
      const expectedStatus =
        first?.contacts[0]?.cavityId === second?.contacts[0]?.cavityId ? 'same-cavity' : 'two-sided'
      if (frame.status !== expectedStatus || frame.reason !== null) return false
    } else if (
      frame.sides.filter((side) => side.status === 'matched').length === 1 &&
      frame.sides.some((side) => side.status === 'unobserved')
    ) {
      if (frame.status !== 'one-sided' || frame.reason !== 'unobserved-opposite-cavity')
        return false
    } else if (frame.status !== 'unresolved' || frame.reason !== 'incomplete-cavity-contacts')
      return false
  }
  return true
}

function isSavedFrameRooms(value: unknown, packet: NativeReviewPacket): boolean {
  if (value === undefined) return true
  if (!value || typeof value !== 'object') return false
  const review = value as NonNullable<NativeReviewPacket['savedFrameRooms']>
  if (review.status === 'not-saved') return hasOnlyKeys(review, ['status'])
  if (review.status === 'unavailable' || review.status === 'refused')
    return hasOnlyKeys(review, ['status', 'reason']) && isBoundedLabel(review.reason)
  if (
    review.status !== 'checked' ||
    !hasOnlyKeys(review, ['status', 'frames']) ||
    !Array.isArray(review.frames) ||
    review.frames.length > 100 ||
    packet.openingFrames?.status !== 'draft' ||
    packet.savedReview.status !== 'checked' ||
    packet.savedReview.coverage.status !== 'partial'
  )
    return false
  const frameIds = new Set(packet.openingFrames.candidates.map(({ id }) => id))
  if (review.frames.length !== frameIds.size) return false
  const cueCounts = new Map<number, number>()
  for (const cue of packet.numberCircles?.cues ?? []) {
    cueCounts.set(cue.sourceNumber, (cueCounts.get(cue.sourceNumber) ?? 0) + 1)
  }
  const checkedIds = new Set<string>()
  const claims = new Map<string, Set<string>>()
  let sideCount = 0
  for (const frame of review.frames) {
    if (
      !frame ||
      typeof frame !== 'object' ||
      !hasOnlyKeys(frame, ['frameId', 'status', 'sides']) ||
      !isBoundedLabel(frame.frameId) ||
      !frameIds.has(frame.frameId) ||
      checkedIds.has(frame.frameId) ||
      !Array.isArray(frame.sides) ||
      frame.sides.length > 50
    )
      return false
    checkedIds.add(frame.frameId)
    sideCount += frame.sides.length
    if (sideCount > 200) return false
    const sideKeys = new Set<string>()
    const zones = new Set<string>()
    for (const side of frame.sides) {
      if (
        !side ||
        typeof side !== 'object' ||
        !hasOnlyKeys(side, [
          'roomSourceNumbers',
          'openingId',
          'kind',
          'frameEdgeIndex',
          'numberCue',
        ]) ||
        !Array.isArray(side.roomSourceNumbers) ||
        side.roomSourceNumbers.length < 1 ||
        side.roomSourceNumbers.length > 12 ||
        side.roomSourceNumbers.some(
          (number, index, numbers) =>
            !isSourceNumber(number) || (index > 0 && number <= (numbers[index - 1] ?? 0)),
        ) ||
        !isBoundedLabel(side.openingId) ||
        !['door', 'window', 'balcony'].includes(side.kind) ||
        !Number.isSafeInteger(side.frameEdgeIndex) ||
        side.frameEdgeIndex < 0 ||
        side.frameEdgeIndex > 3 ||
        !['inside', 'not-inside', 'ambiguous', 'unavailable'].includes(side.numberCue) ||
        (side.numberCue === 'inside' &&
          !side.roomSourceNumbers.every((number) => cueCounts.get(number) === 1))
      )
        return false
      const zone = side.roomSourceNumbers.join('+')
      const sideKey = `${zone}:${side.frameEdgeIndex}:${side.openingId}`
      if (sideKeys.has(sideKey)) return false
      sideKeys.add(sideKey)
      zones.add(zone)
      const claimKey = `${zone}:${side.openingId}`
      const claimants = claims.get(claimKey) ?? new Set<string>()
      claimants.add(frame.frameId)
      claims.set(claimKey, claimants)
    }
    const [first, second] = frame.sides
    if (frame.status === 'two-reviewed-sides') {
      if (
        frame.sides.length !== 2 ||
        zones.size !== 2 ||
        !first ||
        !second ||
        first.kind !== 'door' ||
        second.kind !== 'door' ||
        Math.abs(first.frameEdgeIndex - second.frameEdgeIndex) !== 2
      )
        return false
    } else if (frame.status === 'one-reviewed-side') {
      if (frame.sides.length !== 1) return false
    } else if (frame.status === 'coincident-sides') {
      if (
        frame.sides.length < 2 ||
        zones.size !== frame.sides.length ||
        frame.sides.some((side) => side.frameEdgeIndex !== first?.frameEdgeIndex)
      )
        return false
    } else if (frame.status === 'ambiguous') {
      if (!frame.sides.length) return false
    } else if (frame.status === 'unresolved') {
      if (frame.sides.length > 2) return false
    } else return false
  }
  return review.frames.every(
    (frame) =>
      frame.status === 'ambiguous' ||
      frame.sides.every(
        (side) =>
          (claims.get(`${side.roomSourceNumbers.join('+')}:${side.openingId}`)?.size ?? 0) === 1,
      ),
  )
}

function isSavedReview(value: unknown, source: NativeReviewPacket['source']): boolean {
  if (!value || typeof value !== 'object') return false
  const saved = value as NativeReviewPacket['savedReview']
  if (saved.status === 'not-saved') return true
  if (saved.status === 'unavailable')
    return ['native-layer-unavailable', 'unsupported-review-version'].includes(saved.reason)
  if (saved.status !== 'checked' || !saved.coverage || typeof saved.coverage !== 'object')
    return false
  const report = saved.coverage
  const boundedCount = (count: unknown, max = 100_000) =>
    Number.isSafeInteger(count) && typeof count === 'number' && count >= 0 && count <= max
  const statuses = [
    'paired',
    'opening',
    'unmatched',
    'unpaired-exterior',
    'ambiguous',
    'unsupported-angle',
    'conditional',
  ] as const
  if (
    !['refused', 'partial'].includes(report.status) ||
    report.source?.sha256 !== source.sha256 ||
    report.source.pdfPage !== source.pdfPage ||
    report.source.state !== source.state ||
    typeof report.extractionComplete !== 'boolean' ||
    !['missing', 'envelope-only', 'reviewed-floor', 'legacy-exterior-floor'].includes(
      report.floorBoundary,
    ) ||
    !Array.isArray(report.missingSourceNumbers) ||
    report.missingSourceNumbers.length > 100 ||
    report.missingSourceNumbers.some((number) => !boundedCount(number, 10_000) || number === 0) ||
    !boundedCount(report.wallPairs) ||
    !report.wallSource ||
    typeof report.wallSource.strictValid !== 'boolean' ||
    typeof report.wallSource.localAuditValid !== 'boolean' ||
    !report.wallSpans ||
    statuses.some((status) => !boundedCount(report.wallSpans[status])) ||
    'reviewSpans' in report ||
    typeof report.reviewSpansTruncated !== 'boolean' ||
    !report.openings ||
    Object.keys(report.openings).length !== 7 ||
    [
      report.openings.declaredDoors,
      report.openings.doorPairCandidates,
      report.openings.pairedDoorFaces,
      report.openings.unresolvedDoorChecks,
      report.openings.ambiguousDoorChecks,
      report.openings.uncheckedDoorFaces,
      report.openings.nonDoorDeclarations,
    ].some((count) => !boundedCount(count, 200)) ||
    report.openings.pairedDoorFaces !== report.openings.doorPairCandidates * 2 ||
    report.openings.pairedDoorFaces +
      report.openings.unresolvedDoorChecks +
      report.openings.ambiguousDoorChecks +
      report.openings.uncheckedDoorFaces >
      report.openings.declaredDoors ||
    !Array.isArray(report.issues) ||
    report.issues.length > 30 ||
    report.issues.some((issue) => typeof issue !== 'string' || !issue || issue.length > 128) ||
    report.readiness?.readOnly !== true ||
    report.readiness.readyFor2D !== false ||
    report.readiness.readyFor3D !== false ||
    (report.status === 'refused' &&
      (typeof report.refusalReason !== 'string' ||
        !report.refusalReason ||
        report.refusalReason.length > 128))
  )
    return false
  return true
}

function isPacket(value: unknown, page: number, revision: string): value is NativeReviewPacket {
  if (!value || typeof value !== 'object') return false
  const packet = value as NativeReviewPacket
  if (
    packet.version !== 1 ||
    packet.coordinateSystem !== 'rendered-image-pixels' ||
    !['draft', 'unresolved'].includes(packet.status) ||
    packet.sourceRevision !== revision ||
    packet.source?.state !== 'existing' ||
    packet.source.pdfPage !== page ||
    !/^[a-f0-9]{64}$/.test(packet.source.sha256) ||
    packet.image?.page !== page ||
    !/^[a-f0-9]{64}$/.test(packet.image.sha256) ||
    ![packet.image.width, packet.image.height].every(
      (size) => Number.isSafeInteger(size) && size > 0 && size <= 10000,
    ) ||
    packet.readiness?.readOnly !== true ||
    packet.readiness.readyFor2D !== false ||
    packet.readiness.readyFor3D !== false ||
    !isSavedReview(packet.savedReview, packet.source) ||
    !isDoorSymbols(packet.doorSymbols, packet.image) ||
    !isOpeningFrames(packet.openingFrames, packet.image) ||
    !isGlazingSymbols(packet.glazingSymbols, packet.image) ||
    !isSourceLinks(packet.sourceLinks, packet) ||
    !isNumberCircles(packet.numberCircles) ||
    !isRoomSchedule(packet.roomSchedule, packet) ||
    !isFloorCavities(packet.floorCavities, packet) ||
    !isFloorOpeningSides(packet.floorOpeningSides, packet) ||
    !isSavedFrameRooms(packet.savedFrameRooms, packet) ||
    !Array.isArray(packet.faces) ||
    packet.faces.length > 100 ||
    !Array.isArray(packet.issues) ||
    packet.issues.length > 20 ||
    !packet.counts ||
    [
      packet.counts.fillCandidates,
      packet.counts.strokeFaces,
      packet.counts.annotationHints,
      packet.counts.numberedAssociations,
      packet.counts.printedDimensions,
    ].some((count) => !Number.isSafeInteger(count) || count < 0 || count > 1000)
  )
    return false
  return (
    packet.faces.every(
      (face) =>
        face &&
        typeof face === 'object' &&
        typeof face.id === 'string' &&
        face.id.length <= 128 &&
        ['fill', 'stroke'].includes(face.layer) &&
        typeof face.annotationHint === 'boolean' &&
        (face.roomName === undefined ||
          (typeof face.roomName === 'string' && face.roomName.length <= 200)) &&
        Array.isArray(face.polygon) &&
        face.polygon.length >= 3 &&
        face.polygon.length <= 100 &&
        face.polygon.every(
          (point) =>
            point &&
            typeof point === 'object' &&
            Number.isFinite(point.x) &&
            Number.isFinite(point.y) &&
            point.x >= 0 &&
            point.y >= 0 &&
            point.x <= packet.image.width &&
            point.y <= packet.image.height,
        ),
    ) &&
    packet.issues.every(
      (issue) =>
        issue &&
        typeof issue === 'object' &&
        typeof issue.code === 'string' &&
        typeof issue.message === 'string' &&
        issue.message.length <= 1000,
    )
  )
}

/** Fetch an atomic private image/inspection pair; never calls a save or paid-reader action. */
export async function loadNativeReview(
  input: { projectId: string; page: number; revision: string; signal: AbortSignal },
  fetcher: typeof fetch = fetch,
) {
  const base = `/api/projects/${encodeURIComponent(input.projectId)}/plan-page`
  const query = new URLSearchParams({ page: String(input.page), revision: input.revision })
  const options = { signal: input.signal, cache: 'no-store' as const }
  const [jsonResponse, imageResponse] = await Promise.all([
    fetcher(`${base}?${query}&format=native-review`, options),
    fetcher(`${base}?${query}&format=native-review-image`, options),
  ])
  for (const response of [jsonResponse, imageResponse])
    if (!response.ok)
      throw new NativeReviewRequestError(
        (await response.text()).slice(0, 400) || 'Не удалось проверить исходный лист.',
        response.status,
      )
  const [value, blob] = await Promise.all([
    jsonResponse.json() as Promise<unknown>,
    imageResponse.blob(),
  ])
  if (!isPacket(value, input.page, input.revision))
    throw new NativeReviewRequestError('Ответ проверки не соответствует выбранному листу.', 422)
  if (
    !imageResponse.headers.get('content-type')?.startsWith('image/jpeg') ||
    imageResponse.headers.get('x-plan-sha256') !== value.source.sha256 ||
    imageResponse.headers.get('x-plan-image-sha256') !== value.image.sha256 ||
    imageResponse.headers.get('x-plan-page') !== String(input.page) ||
    imageResponse.headers.get('x-plan-image-width') !== String(value.image.width) ||
    imageResponse.headers.get('x-plan-image-height') !== String(value.image.height)
  )
    throw new NativeReviewRequestError(
      'Изображение и контуры относятся к разным версиям исходника.',
      409,
    )
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
  if (hash !== value.image.sha256)
    throw new NativeReviewRequestError(
      'Изображение исходника изменилось. Откройте проверку заново.',
      409,
    )
  if (input.signal.aborted) throw new DOMException('Aborted', 'AbortError')
  return { packet: value, image: blob }
}
