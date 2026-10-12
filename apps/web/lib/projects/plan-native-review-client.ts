import {
  nativeDocumentaryHeightCaption,
  nativeHeightCaption,
  nativeHeightMillimetreDeclarationIndex,
} from './plan-native-height-caption'
import {
  nativeCeilingDatumDeclaration,
  nativeCeilingDatumDeclarationTopic,
} from './plan-native-height-datum-caption'
import type { NativeReviewPacket } from './plan-native-review-packet'
import { nativeSourceObjectReportsValid } from './plan-native-source-object-contract'

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

function isFilledPanelSymbols(value: unknown, image: NativeReviewPacket['image']): boolean {
  if (value === undefined) return true
  if (!isCandidateLayer(value)) return false
  const report = value as NonNullable<NativeReviewPacket['filledPanelSymbols']>
  if (
    !hasOnlyKeys(report, [
      'status',
      'basis',
      'refusalReason',
      'completeOpeningInventory',
      'physicalJambAccepted',
      'physicalPassageAccepted',
      'closesFloorBoundary',
      'finalPaintVisibilityProved',
      'candidates',
    ]) ||
    report.basis !== 'native-filled-quad-and-opposed-cap-overlap' ||
    report.completeOpeningInventory !== false ||
    report.physicalJambAccepted !== false ||
    report.physicalPassageAccepted !== false ||
    report.closesFloorBoundary !== false ||
    report.finalPaintVisibilityProved !== false
  )
    return false
  const ids = new Set<string>()
  const usedRefs = new Set<string>()
  return report.candidates.every((candidate) => {
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      !hasOnlyKeys(candidate, [
        'id',
        'sourceRefs',
        'polygons',
        'laterPaintCount',
        'omittedInkCount',
      ]) ||
      typeof candidate.id !== 'string' ||
      ids.has(candidate.id) ||
      !Array.isArray(candidate.sourceRefs) ||
      candidate.sourceRefs.length !== 3 ||
      !Array.isArray(candidate.polygons) ||
      candidate.polygons.length !== 3 ||
      !candidate.polygons.every((polygon) => isSourceQuad(polygon, image)) ||
      ![candidate.laterPaintCount, candidate.omittedInkCount].every(
        (count) => Number.isSafeInteger(count) && count >= 0 && count <= 100_000,
      )
    )
      return false
    for (const ref of candidate.sourceRefs) {
      if (
        !ref ||
        typeof ref !== 'object' ||
        !hasOnlyKeys(ref, ['operationIndex', 'subpathIndex']) ||
        ![ref.operationIndex, ref.subpathIndex].every(
          (index) => Number.isSafeInteger(index) && index >= 0 && index < 100_000,
        )
      )
        return false
      const key = `${ref.operationIndex}:${ref.subpathIndex}`
      if (usedRefs.has(key)) return false
      usedRefs.add(key)
    }
    const body = candidate.sourceRefs[0]
    if (!body || candidate.id !== `native-filled-panel-${body.operationIndex}:${body.subpathIndex}`)
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

function isDimensionDiscovery(value: unknown, packet: NativeReviewPacket): boolean {
  if (value === undefined) return true
  if (!value || typeof value !== 'object') return false
  const discovery = value as NonNullable<NativeReviewPacket['dimensionDiscovery']>
  if (
    !hasOnlyKeys(discovery, ['status', 'refusalReason', 'candidates', 'unresolved']) ||
    !Array.isArray(discovery.candidates) ||
    !Array.isArray(discovery.unresolved) ||
    discovery.candidates.length + discovery.unresolved.length > 1000 ||
    packet.counts?.printedDimensions !== discovery.candidates.length
  )
    return false
  if (discovery.status === 'unresolved')
    return (
      isBoundedLabel(discovery.refusalReason) &&
      discovery.candidates.length === 0 &&
      discovery.unresolved.length === 0
    )
  if (discovery.status !== 'draft' || discovery.refusalReason !== null) return false
  const labels = new Set<string>()
  for (const candidate of discovery.candidates) {
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      !hasOnlyKeys(candidate, ['labelId', 'valueMm', 'axis']) ||
      !isBoundedLabel(candidate.labelId) ||
      labels.has(candidate.labelId) ||
      !Number.isSafeInteger(candidate.valueMm) ||
      candidate.valueMm < 1 ||
      candidate.valueMm > 99999 ||
      !['width', 'depth'].includes(candidate.axis)
    )
      return false
    labels.add(candidate.labelId)
  }
  for (const item of discovery.unresolved) {
    if (
      !item ||
      typeof item !== 'object' ||
      !hasOnlyKeys(item, ['labelId', 'reason']) ||
      !isBoundedLabel(item.labelId) ||
      labels.has(item.labelId) ||
      !isBoundedLabel(item.reason)
    )
      return false
    labels.add(item.labelId)
  }
  return true
}

function isSourceCaptionBindings(value: unknown, packet: NativeReviewPacket): boolean {
  if (value === undefined) return true
  if (!value || typeof value !== 'object') return false
  const report = value as NonNullable<NativeReviewPacket['sourceCaptionBindings']>
  if (
    !hasOnlyKeys(report, ['status', 'refusalReason', 'candidates', 'unresolved']) ||
    !Array.isArray(report.candidates) ||
    !Array.isArray(report.unresolved) ||
    report.candidates.length + report.unresolved.length > 1000
  )
    return false
  if (report.status === 'unresolved')
    return (
      isBoundedLabel(report.refusalReason) &&
      report.candidates.length === 0 &&
      report.unresolved.length === 0
    )
  if (report.status !== 'draft' || report.refusalReason !== null) return false
  const legacyCandidates = new Map(
    packet.dimensionDiscovery?.status === 'draft'
      ? packet.dimensionDiscovery.candidates.map((candidate) => [candidate.labelId, candidate])
      : [],
  )
  const labelIds = new Set<string>()
  const compactIndices = new Set<number>()
  const railRefs = new Set<string>()
  const inkOperations = new Set<number>()
  for (const candidate of report.candidates) {
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      !hasOnlyKeys(candidate, [
        'labelId',
        'compactIndex',
        'valueMm',
        'axis',
        'rail',
        ...('angleDegrees' in candidate ? ['angleDegrees'] : []),
        ...('textPlacement' in candidate ? ['textPlacement'] : []),
        ...('inkSourceOperation' in candidate ? ['inkSourceOperation'] : []),
      ]) ||
      !isBoundedLabel(candidate.labelId) ||
      candidate.labelId !== candidate.labelId.trim() ||
      labelIds.has(candidate.labelId) ||
      !Number.isSafeInteger(candidate.compactIndex) ||
      candidate.compactIndex < 0 ||
      candidate.compactIndex > 999 ||
      compactIndices.has(candidate.compactIndex) ||
      !Number.isSafeInteger(candidate.valueMm) ||
      candidate.valueMm < 1 ||
      candidate.valueMm > 99999 ||
      !['width', 'depth', 'aligned'].includes(candidate.axis) ||
      (candidate.angleDegrees !== undefined &&
        (typeof candidate.angleDegrees !== 'number' ||
          !Number.isFinite(candidate.angleDegrees) ||
          Math.abs(candidate.angleDegrees) > 360 ||
          !sourceCaptionAngleMatchesAxis(candidate.angleDegrees, candidate.axis))) ||
      (candidate.textPlacement !== undefined &&
        !['glyph-ink', 'baseline'].includes(candidate.textPlacement)) ||
      (candidate.textPlacement === 'glyph-ink'
        ? !Number.isSafeInteger(candidate.inkSourceOperation) ||
          (candidate.inkSourceOperation ?? -1) < 0
        : candidate.inkSourceOperation !== undefined) ||
      !candidate.rail ||
      typeof candidate.rail !== 'object' ||
      !hasOnlyKeys(candidate.rail, ['operationIndex', 'subpathIndex']) ||
      ![candidate.rail.operationIndex, candidate.rail.subpathIndex].every(
        (index) => Number.isSafeInteger(index) && index >= 0,
      )
    )
      return false
    const railRef = `${candidate.rail.operationIndex}:${candidate.rail.subpathIndex}`
    const legacy = legacyCandidates.get(candidate.labelId)
    if (
      railRefs.has(railRef) ||
      (candidate.inkSourceOperation !== undefined &&
        inkOperations.has(candidate.inkSourceOperation)) ||
      (legacy && (legacy.valueMm !== candidate.valueMm || legacy.axis !== candidate.axis))
    )
      return false
    labelIds.add(candidate.labelId)
    compactIndices.add(candidate.compactIndex)
    railRefs.add(railRef)
    if (candidate.inkSourceOperation !== undefined) inkOperations.add(candidate.inkSourceOperation)
  }
  for (const item of report.unresolved) {
    if (
      !item ||
      typeof item !== 'object' ||
      !hasOnlyKeys(item, ['labelId', 'reason']) ||
      !isBoundedLabel(item.labelId) ||
      item.labelId !== item.labelId.trim() ||
      labelIds.has(item.labelId) ||
      !isBoundedLabel(item.reason)
    )
      return false
    labelIds.add(item.labelId)
  }
  return true
}

function sourceCaptionAngleMatchesAxis(angle: number, axis: string): boolean {
  const parallel = (expected: number) => {
    const delta = Math.abs((((angle - expected) % 180) + 180) % 180)
    return Math.min(delta, 180 - delta) <= 1e-6
  }
  return axis === (parallel(0) ? 'width' : parallel(90) ? 'depth' : 'aligned')
}

function isScaleEvidence(value: unknown, packet: NativeReviewPacket): boolean {
  if (value === undefined) return true
  if (!value || typeof value !== 'object') return false
  const report = value as NonNullable<NativeReviewPacket['scaleEvidence']>
  if (
    !hasOnlyKeys(report, [
      'status',
      'refusalReason',
      'dimensionToleranceMm',
      'axes',
      'commonScale',
      'unresolved',
    ]) ||
    report.dimensionToleranceMm !== 2 ||
    !Array.isArray(report.axes) ||
    !Array.isArray(report.unresolved) ||
    report.unresolved.length > 1000 ||
    !report.commonScale ||
    typeof report.commonScale !== 'object' ||
    !hasOnlyKeys(report.commonScale, ['status', 'referenceLabelId', 'mmPerPoint'])
  )
    return false
  if (report.status === 'unresolved')
    return (
      isBoundedLabel(report.refusalReason) &&
      report.axes.length === 0 &&
      report.unresolved.length === 0 &&
      report.commonScale.status === 'insufficient' &&
      report.commonScale.referenceLabelId === null &&
      report.commonScale.mmPerPoint === null
    )
  const captions = packet.sourceCaptionBindings
  if (
    report.status !== 'draft' ||
    report.refusalReason !== null ||
    captions?.status !== 'draft' ||
    report.axes.length !== 2
  )
    return false
  const candidates = new Map(captions.candidates.map((item) => [item.labelId, item]))
  const held = new Map(captions.unresolved.map((item) => [item.labelId, item.reason]))
  const ids = new Set<string>()
  const positive = (number: number) => Number.isFinite(number) && number > 0
  // Arithmetic replay only. This epsilon is not an additional drawing or endpoint tolerance.
  const sameNumber = (actual: number, expected: number) =>
    Number.isFinite(actual) &&
    Number.isFinite(expected) &&
    Math.abs(actual - expected) <= Number.EPSILON * 16 * Math.max(1, Math.abs(expected))
  for (const [index, axis] of report.axes.entries()) {
    if (
      !axis ||
      typeof axis !== 'object' ||
      !hasOnlyKeys(axis, [
        'axis',
        'status',
        'referenceLabelId',
        'referenceMmPerPoint',
        'independentLabelIds',
        'observations',
      ]) ||
      axis.axis !== (index === 0 ? 'width' : 'depth') ||
      !Array.isArray(axis.observations) ||
      axis.observations.length > 1000 ||
      !Array.isArray(axis.independentLabelIds) ||
      ![0, 2].includes(axis.independentLabelIds.length) ||
      new Set(axis.independentLabelIds).size !== axis.independentLabelIds.length
    )
      return false
    const reference = axis.observations[0]
    if (!reference) {
      if (
        axis.status !== 'insufficient' ||
        axis.referenceLabelId !== null ||
        axis.referenceMmPerPoint !== null ||
        axis.independentLabelIds.length !== 0
      )
        return false
      continue
    }
    if (
      axis.referenceLabelId !== reference.labelId ||
      !positive(axis.referenceMmPerPoint as number) ||
      !sameNumber(axis.referenceMmPerPoint as number, reference.mmPerPoint)
    )
      return false
    let previous: typeof reference | undefined
    let conflict = false
    for (const observation of axis.observations) {
      if (
        !observation ||
        typeof observation !== 'object' ||
        !hasOnlyKeys(observation, [
          'labelId',
          'valueMm',
          'lengthPoints',
          'mmPerPoint',
          'residualMm',
        ]) ||
        !isBoundedLabel(observation.labelId) ||
        ids.has(observation.labelId) ||
        !positive(observation.lengthPoints) ||
        !positive(observation.mmPerPoint)
      )
        return false
      const source = candidates.get(observation.labelId)
      if (
        !source ||
        source.axis !== axis.axis ||
        source.valueMm !== observation.valueMm ||
        !sameNumber(observation.mmPerPoint, observation.valueMm / observation.lengthPoints) ||
        !sameNumber(
          observation.residualMm,
          observation.lengthPoints * (axis.referenceMmPerPoint as number) - observation.valueMm,
        ) ||
        (previous &&
          (previous.lengthPoints < observation.lengthPoints ||
            (previous.lengthPoints === observation.lengthPoints &&
              previous.labelId.localeCompare(observation.labelId) > 0)))
      )
        return false
      conflict ||= Math.abs(observation.residualMm) > 2
      previous = observation
      ids.add(observation.labelId)
    }
    if (
      axis.independentLabelIds.some((id) => !axis.observations.some((item) => item.labelId === id))
    )
      return false
    const anchors = axis.independentLabelIds.map((id) => candidates.get(id))
    if (
      anchors.length === 2 &&
      anchors[0]?.rail.operationIndex === anchors[1]?.rail.operationIndex &&
      anchors[0]?.rail.subpathIndex === anchors[1]?.rail.subpathIndex
    )
      return false
    // Source endpoints are deliberately absent from this DTO. The source helper proves interval independence.
    const expected = conflict ? 'conflict' : anchors.length === 2 ? 'consistent' : 'insufficient'
    if (axis.status !== expected) return false
  }
  for (const item of report.unresolved) {
    if (
      !item ||
      typeof item !== 'object' ||
      !hasOnlyKeys(item, ['labelId', 'reason']) ||
      !isBoundedLabel(item.labelId) ||
      ids.has(item.labelId)
    )
      return false
    const source = candidates.get(item.labelId)
    const reason =
      source?.axis === 'aligned' ? 'scale-evidence-noncardinal-dimension' : held.get(item.labelId)
    if (!reason || item.reason !== reason) return false
    ids.add(item.labelId)
  }
  if (ids.size !== candidates.size + held.size) return false
  const x = report.axes[0]?.observations[0]
  const conflict =
    report.axes.some((axis) => axis.status === 'conflict') ||
    (!!x &&
      report.axes.some((axis) =>
        axis.observations.some(
          (item) => Math.abs(item.lengthPoints * x.mmPerPoint - item.valueMm) > 2,
        ),
      ))
  const expected = conflict
    ? 'conflict'
    : report.axes.every((axis) => axis.status === 'consistent')
      ? 'consistent'
      : 'insufficient'
  return (
    report.commonScale.status === expected &&
    (expected === 'consistent'
      ? report.commonScale.referenceLabelId === x?.labelId &&
        sameNumber(report.commonScale.mmPerPoint as number, x?.mmPerPoint as number)
      : report.commonScale.referenceLabelId === null && report.commonScale.mmPerPoint === null)
  )
}

function isDimensionStrokeContacts(value: unknown, packet: NativeReviewPacket): boolean {
  if (value === undefined) return true
  if (!value || typeof value !== 'object') return false
  const report = value as NonNullable<NativeReviewPacket['dimensionStrokeContacts']>
  if (
    !hasOnlyKeys(report, [
      'status',
      'refusalReason',
      'observations',
      'visibility',
      'physicalTargetsAccepted',
      'mayTransfer2D',
      'mayTransfer3D',
    ]) ||
    report.visibility !== 'not-checked' ||
    report.physicalTargetsAccepted !== false ||
    report.mayTransfer2D !== false ||
    report.mayTransfer3D !== false ||
    !Array.isArray(report.observations) ||
    report.observations.length > 1000
  )
    return false
  if (report.status === 'unresolved')
    return isBoundedLabel(report.refusalReason) && report.observations.length === 0
  const captions = packet.sourceCaptionBindings
  if (
    report.status !== 'diagnostic' ||
    report.refusalReason !== null ||
    captions?.status !== 'draft'
  )
    return false
  const candidates = new Map(captions.candidates.map((item) => [item.labelId, item]))
  if (report.observations.length !== candidates.size) return false
  const labels = new Set<string>()
  let referenceCount = 0
  return report.observations.every((row) => {
    if (!row || !hasOnlyKeys(row, ['labelId', 'valueMm', 'rail', 'tips'])) return false
    const caption = candidates.get(row.labelId)
    if (
      !caption ||
      labels.has(row.labelId) ||
      row.valueMm !== caption.valueMm ||
      !row.rail ||
      !hasOnlyKeys(row.rail, ['operationIndex', 'subpathIndex']) ||
      row.rail.operationIndex !== caption.rail.operationIndex ||
      row.rail.subpathIndex !== caption.rail.subpathIndex ||
      !Array.isArray(row.tips) ||
      row.tips.length !== 2
    )
      return false
    labels.add(row.labelId)
    return row.tips.every((tip, index) => {
      if (
        !tip ||
        !hasOnlyKeys(tip, ['endpoint', 'status', 'reason', 'sourceRefs']) ||
        tip.endpoint !== index ||
        !Array.isArray(tip.sourceRefs) ||
        tip.sourceRefs.length > 3000
      )
        return false
      if (
        tip.status === 'ink-overlap'
          ? tip.reason !== null || !tip.sourceRefs.length
          : tip.status !== 'held' || !isBoundedLabel(tip.reason) || tip.sourceRefs.length !== 0
      )
        return false
      referenceCount += tip.sourceRefs.length
      if (referenceCount > 20000) return false
      const refs = new Set<string>()
      return tip.sourceRefs.every((ref) => {
        if (
          !ref ||
          !hasOnlyKeys(ref, ['operationIndex', 'subpathIndex', 'segmentIndex']) ||
          ![ref.operationIndex, ref.subpathIndex].every(
            (item) => Number.isSafeInteger(item) && item >= 0,
          ) ||
          ref.segmentIndex !== 0 ||
          (ref.operationIndex === row.rail.operationIndex &&
            ref.subpathIndex === row.rail.subpathIndex)
        )
          return false
        const key = `${ref.operationIndex}:${ref.subpathIndex}:${ref.segmentIndex}`
        if (refs.has(key)) return false
        refs.add(key)
        return true
      })
    })
  })
}

function isDimensionTargets(value: unknown, packet: NativeReviewPacket): boolean {
  if (value === undefined) return true
  if (!value || typeof value !== 'object') return false
  const report = value as NonNullable<NativeReviewPacket['dimensionTargets']>
  if (
    !hasOnlyKeys(report, [
      'status',
      'refusalReason',
      'observations',
      'unresolved',
      ...('jambSpans' in report ? ['jambSpans'] : []),
    ]) ||
    !Array.isArray(report.observations) ||
    !Array.isArray(report.unresolved) ||
    report.observations.length + report.unresolved.length > 1000
  )
    return false
  if (report.status === 'unresolved')
    return (
      isBoundedLabel(report.refusalReason) &&
      report.observations.length === 0 &&
      report.unresolved.length === 0 &&
      (report.jambSpans === undefined ||
        (Array.isArray(report.jambSpans) && report.jambSpans.length === 0))
    )
  const captions = packet.sourceCaptionBindings
  if (report.status !== 'draft' || report.refusalReason !== null || captions?.status !== 'draft')
    return false
  const candidates = new Map(captions.candidates.map((item) => [item.labelId, item]))
  const held = new Map(captions.unresolved.map((item) => [item.labelId, item.reason]))
  const floor = new Map(packet.floorCavities?.candidates.map((item) => [item.id, item]) ?? [])
  const frames = new Map(packet.openingFrames?.candidates.map((item) => [item.id, item]) ?? [])
  const statuses = ['continuous', 'detached', 'ambiguous', 'unresolved']
  const floorDimensionGroups = new Map<string, typeof report.observations>()
  const ids = new Set<string>()
  let faceCount = 0
  let referenceCount = 0
  const refsValid = (refs: unknown): boolean => {
    if (!Array.isArray(refs) || refs.length > 20000) return false
    referenceCount += refs.length
    if (referenceCount > 20000) return false
    const keys = new Set<string>()
    return refs.every((ref) => {
      if (
        !ref ||
        typeof ref !== 'object' ||
        !hasOnlyKeys(ref, ['operationIndex', 'subpathIndex', 'segmentIndex']) ||
        ![ref.operationIndex, ref.subpathIndex, ref.segmentIndex].every(
          (index) => Number.isSafeInteger(index) && index >= 0,
        )
      )
        return false
      const key = `${ref.operationIndex}:${ref.subpathIndex}:${ref.segmentIndex}`
      if (keys.has(key)) return false
      keys.add(key)
      return true
    })
  }
  for (const row of report.observations) {
    if (
      !row ||
      typeof row !== 'object' ||
      !hasOnlyKeys(row, ['labelId', 'valueMm', 'axis', 'status', 'reason', 'targets']) ||
      !isBoundedLabel(row.labelId) ||
      row.labelId !== row.labelId.trim() ||
      ids.has(row.labelId) ||
      ![...statuses, 'conflict'].includes(row.status) ||
      (row.status === 'continuous' ? row.reason !== null : !isBoundedLabel(row.reason)) ||
      !Array.isArray(row.targets) ||
      row.targets.length > 200
    )
      return false
    const source = candidates.get(row.labelId)
    if (!source || source.valueMm !== row.valueMm || source.axis !== row.axis) return false
    ids.add(row.labelId)
    const targetIds = new Set<string>()
    for (const target of row.targets) {
      if (
        !target ||
        typeof target !== 'object' ||
        !hasOnlyKeys(target, ['kind', 'id', 'faces']) ||
        !['floor-boundary', 'opening-frame'].includes(target.kind) ||
        !isBoundedLabel(target.id) ||
        target.id !== target.id.trim() ||
        targetIds.has(`${target.kind}:${target.id}`) ||
        !Array.isArray(target.faces) ||
        target.faces.length < 1 ||
        target.faces.length > 100
      )
        return false
      targetIds.add(`${target.kind}:${target.id}`)
      const parent = target.kind === 'floor-boundary' ? floor.get(target.id) : frames.get(target.id)
      const layer = target.kind === 'floor-boundary' ? packet.floorCavities : packet.openingFrames
      if (layer?.status !== 'draft' || !parent) return false
      const polygon = parent?.polygon
      const first = polygon?.[0]
      const last = polygon?.at(-1)
      const edgeLimit = polygon
        ? polygon.length - (first?.x === last?.x && first?.y === last?.y ? 1 : 0)
        : target.kind === 'opening-frame'
          ? 4
          : 100
      const edges = new Set<number>()
      for (const face of target.faces) {
        faceCount += 1
        if (
          !face ||
          typeof face !== 'object' ||
          !hasOnlyKeys(face, [
            'edgeIndex',
            'status',
            'reason',
            'supportRefs',
            'endpointWitnesses',
          ]) ||
          faceCount > 4200 ||
          !Number.isSafeInteger(face.edgeIndex) ||
          face.edgeIndex < 0 ||
          face.edgeIndex >= edgeLimit ||
          edges.has(face.edgeIndex) ||
          !statuses.includes(face.status) ||
          (face.status === 'continuous' ? face.reason !== null : !isBoundedLabel(face.reason)) ||
          !refsValid(face.supportRefs) ||
          face.supportRefs.length === 0 ||
          !Array.isArray(face.endpointWitnesses) ||
          face.endpointWitnesses.length !== 2
        )
          return false
        if (
          target.kind === 'floor-boundary' &&
          (floor.get(target.id)?.omittedBoundaryInkCount ?? 0) > 0 &&
          (face.status !== 'unresolved' || face.reason !== 'omitted-ink-near-source-target')
        )
          return false
        edges.add(face.edgeIndex)
        for (const witness of face.endpointWitnesses) {
          if (
            !witness ||
            typeof witness !== 'object' ||
            !hasOnlyKeys(witness, ['status', 'sourceRefs', 'gapPoints']) ||
            !statuses.includes(witness.status) ||
            !refsValid(witness.sourceRefs)
          )
            return false
          if (witness.status === 'continuous' || witness.status === 'detached') {
            if (
              witness.sourceRefs.length === 0 ||
              typeof witness.gapPoints !== 'number' ||
              !Number.isFinite(witness.gapPoints) ||
              (witness.status === 'continuous' ? witness.gapPoints !== 0 : witness.gapPoints <= 0)
            )
              return false
          } else if (
            witness.gapPoints !== null ||
            (witness.status === 'unresolved'
              ? witness.sourceRefs.length !== 0
              : witness.sourceRefs.length < 2)
          )
            return false
        }
        const witnessStatuses = face.endpointWitnesses.map((item) => item.status)
        if (
          (face.status === 'continuous' &&
            witnessStatuses.some((status) => status !== 'continuous')) ||
          (face.status === 'detached' &&
            (!witnessStatuses.includes('detached') ||
              witnessStatuses.some((status) => !['continuous', 'detached'].includes(status)))) ||
          (face.status === 'ambiguous' && !witnessStatuses.includes('ambiguous'))
        )
          return false
      }
    }
    if (!row.targets.length) {
      if (row.status !== 'unresolved') return false
    } else if (row.targets.length > 1 || (row.targets[0]?.faces.length ?? 0) > 1) {
      if (row.status !== 'ambiguous') return false
    } else {
      const target = row.targets[0]
      const face = target?.faces[0]
      if (!target || !face) return false
      if (
        target.kind === 'floor-boundary' &&
        (face.status === 'continuous' || face.status === 'detached')
      ) {
        const key = JSON.stringify([target.id, face.edgeIndex, row.axis])
        const group = floorDimensionGroups.get(key) ?? []
        group.push(row)
        floorDimensionGroups.set(key, group)
      } else if (row.status !== face.status || row.reason !== face.reason) return false
    }
  }
  // Conflicts belong to the entire literal face/axis group, never just one caption.
  for (const group of floorDimensionGroups.values()) {
    const conflict = new Set(group.map((row) => row.valueMm)).size > 1
    for (const row of group) {
      const face = row.targets[0]?.faces[0]
      if (
        !face ||
        row.status !== (conflict ? 'conflict' : face.status) ||
        row.reason !== (conflict ? 'conflicting-whole-floor-dimensions' : face.reason)
      )
        return false
    }
  }
  for (const item of report.unresolved) {
    if (
      !item ||
      typeof item !== 'object' ||
      !hasOnlyKeys(item, ['labelId', 'reason']) ||
      !isBoundedLabel(item.labelId) ||
      item.labelId !== item.labelId.trim() ||
      ids.has(item.labelId) ||
      !isBoundedLabel(item.reason) ||
      held.get(item.labelId) !== item.reason
    )
      return false
    ids.add(item.labelId)
  }
  if (ids.size !== candidates.size + held.size) return false
  if (report.jambSpans === undefined) return true
  if (!Array.isArray(report.jambSpans) || report.jambSpans.length > 1000) return false
  const spanIds = new Set<string>()
  const refKey = (ref: { operationIndex: number; subpathIndex: number; segmentIndex: number }) =>
    `${ref.operationIndex}:${ref.subpathIndex}:${ref.segmentIndex}`
  for (const span of report.jambSpans) {
    if (
      !span ||
      typeof span !== 'object' ||
      !hasOnlyKeys(span, [
        'labelId',
        'frameId',
        'valueMm',
        'axis',
        'status',
        'jambRefs',
        'faceEdgeIndexes',
      ]) ||
      spanIds.has(span.labelId) ||
      !['width', 'depth'].includes(span.axis) ||
      !['continuous', 'detached', 'conflict'].includes(span.status) ||
      !Array.isArray(span.jambRefs) ||
      span.jambRefs.length !== 2 ||
      !span.jambRefs.every((refs) => refsValid(refs) && refs.length > 0) ||
      span.jambRefs[0].some((ref) =>
        span.jambRefs[1].some((other) => refKey(ref) === refKey(other)),
      ) ||
      !Array.isArray(span.faceEdgeIndexes) ||
      span.faceEdgeIndexes.length !== 2 ||
      !span.faceEdgeIndexes.every((index) => Number.isSafeInteger(index) && index >= 0) ||
      (span.faceEdgeIndexes[1] ?? -Infinity) - (span.faceEdgeIndexes[0] ?? Infinity) !== 2
    )
      return false
    const row = report.observations.find((item) => item.labelId === span.labelId)
    const target = row?.targets[0]
    if (
      !row ||
      row.valueMm !== span.valueMm ||
      row.axis !== span.axis ||
      row.targets.length !== 1 ||
      target?.kind !== 'opening-frame' ||
      target.id !== span.frameId ||
      target.faces.length !== 2 ||
      span.faceEdgeIndexes.some(
        (index) => !target.faces.some((face) => face.edgeIndex === index),
      ) ||
      target.faces.some((face) => !['continuous', 'detached'].includes(face.status))
    )
      return false
    const frameSource = /^native-opening-frame-(\d+):(\d+)$/.exec(span.frameId)
    if (!frameSource) return false
    const operationIndex = Number(frameSource[1])
    const subpathIndex = Number(frameSource[2])
    if (![operationIndex, subpathIndex].every((index) => Number.isSafeInteger(index) && index >= 0))
      return false
    const jambEdges = [0, 1, 2, 3].filter((index) => !span.faceEdgeIndexes.includes(index))
    const supportRefs = new Set(target.faces.flatMap((face) => face.supportRefs.map(refKey)))
    const seenJambEdges = new Set<number>()
    for (const refs of span.jambRefs) {
      const frameJambs = refs.filter(
        (ref) =>
          ref.operationIndex === operationIndex &&
          ref.subpathIndex === subpathIndex &&
          jambEdges.includes(ref.segmentIndex),
      )
      if (frameJambs.length !== 1 || seenJambEdges.has(frameJambs[0]?.segmentIndex as number))
        return false
      seenJambEdges.add(frameJambs[0]?.segmentIndex as number)
      if (refs.some((ref) => ref !== frameJambs[0] && !supportRefs.has(refKey(ref)))) return false
    }
    const conflicts = report.jambSpans.some(
      (other) => other.frameId === span.frameId && other.valueMm !== span.valueMm,
    )
    const expected = conflicts
      ? 'conflict'
      : target.faces.some((face) => face.status === 'detached')
        ? 'detached'
        : 'continuous'
    if (span.status !== expected) return false
    spanIds.add(span.labelId)
  }
  return true
}

function isHeightLocations(
  heights: NonNullable<NativeReviewPacket['heightObservations']>,
  packet: NativeReviewPacket,
): boolean {
  const locations = heights.locations
  if (locations === undefined) return true
  if (
    !locations ||
    typeof locations !== 'object' ||
    !hasOnlyKeys(locations, ['status', 'refusalReason', 'observations']) ||
    !Array.isArray(locations.observations) ||
    locations.observations.length > 100
  )
    return false
  if (locations.status === 'unresolved')
    return isBoundedLabel(locations.refusalReason) && locations.observations.length === 0
  if (
    locations.status !== 'draft' ||
    locations.refusalReason !== null ||
    heights.status !== 'draft' ||
    locations.observations.length !== heights.observations.length
  )
    return false
  const parentIds = new Set(heights.observations.map(({ labelId }) => labelId))
  const floor = packet.floorCavities
  if (floor?.status === 'draft' && !Array.isArray(floor.candidates)) return false
  const cavities = new Map(
    floor?.status === 'draft' ? floor.candidates.map((cavity) => [cavity.id, cavity]) : [],
  )
  const seenIds = new Set<string>()
  const seenOperations = new Set<number>()
  let leaderReferenceCount = 0
  const leaderValid = (
    leader: NonNullable<(typeof locations.observations)[number]['leader']>,
  ): boolean => {
    if (
      !leader ||
      typeof leader !== 'object' ||
      !hasOnlyKeys(leader, [
        'status',
        'reason',
        'cavityIds',
        ...('source' in leader ? ['source'] : []),
      ]) ||
      !Array.isArray(leader.cavityIds) ||
      leader.cavityIds.length > 100 ||
      new Set(leader.cavityIds).size !== leader.cavityIds.length ||
      !leader.cavityIds.every((id) => isBoundedLabel(id) && cavities.has(id))
    )
      return false
    if (leader.status === 'linked') {
      if (
        leader.reason !== null ||
        leader.cavityIds.length !== 1 ||
        cavities.get(leader.cavityIds[0] ?? '')?.omittedBoundaryInkCount !== 0 ||
        !leader.source
      )
        return false
    } else if (leader.status === 'ambiguous') {
      if (
        !isBoundedLabel(leader.reason) ||
        (leader.source &&
          (leader.cavityIds.length < 2 || leader.reason !== 'competing-height-leader-targets'))
      )
        return false
    } else if (leader.status === 'unresolved') {
      if (
        !isBoundedLabel(leader.reason) ||
        leader.cavityIds.length > 1 ||
        (leader.source && leader.reason !== 'height-leader-target-unverified')
      )
        return false
    } else return false
    if (!('source' in leader)) return leader.cavityIds.length === 0
    const source = leader.source
    if (
      !source ||
      typeof source !== 'object' ||
      !hasOnlyKeys(source, ['boxRefs', 'stemRefs', 'arrowRef']) ||
      !Array.isArray(source.boxRefs) ||
      source.boxRefs.length < 1 ||
      source.boxRefs.length > 100 ||
      !Array.isArray(source.stemRefs) ||
      source.stemRefs.length < 1 ||
      source.stemRefs.length > 100
    )
      return false
    leaderReferenceCount += source.boxRefs.length + source.stemRefs.length + 1
    if (leaderReferenceCount > 20000) return false
    const pathKey = (ref: { operationIndex: number; subpathIndex: number }) =>
      `${ref.operationIndex}:${ref.subpathIndex}`
    const refValid = (value: unknown, segment: boolean): boolean => {
      if (!value || typeof value !== 'object') return false
      const ref = value as { operationIndex: number; subpathIndex: number; segmentIndex?: number }
      return (
        hasOnlyKeys(ref, [
          'operationIndex',
          'subpathIndex',
          ...(segment ? ['segmentIndex'] : []),
        ]) &&
        [ref.operationIndex, ref.subpathIndex, ...(segment ? [ref.segmentIndex] : [])].every(
          (index) => Number.isSafeInteger(index) && (index ?? -1) >= 0,
        )
      )
    }
    if (!refValid(source.arrowRef, false)) return false
    const boxPaths = new Set<string>()
    for (const ref of source.boxRefs) {
      if (!refValid(ref, false) || boxPaths.has(pathKey(ref))) return false
      boxPaths.add(pathKey(ref))
    }
    const stemSegments = new Set<string>()
    const stemPaths = new Set<string>()
    for (const ref of source.stemRefs) {
      if (!refValid(ref, true) || boxPaths.has(pathKey(ref))) return false
      const key = `${pathKey(ref)}:${ref.segmentIndex}`
      if (stemSegments.has(key)) return false
      stemSegments.add(key)
      stemPaths.add(pathKey(ref))
    }
    return !boxPaths.has(pathKey(source.arrowRef)) && !stemPaths.has(pathKey(source.arrowRef))
  }
  for (const row of locations.observations) {
    if (
      !row ||
      typeof row !== 'object' ||
      !hasOnlyKeys(row, [
        'labelId',
        'status',
        'cavityIds',
        'inkSourceOperation',
        'reason',
        ...('leader' in row ? ['leader'] : []),
      ]) ||
      !isBoundedLabel(row.labelId) ||
      !parentIds.has(row.labelId) ||
      seenIds.has(row.labelId) ||
      !Array.isArray(row.cavityIds) ||
      row.cavityIds.length > 100 ||
      new Set(row.cavityIds).size !== row.cavityIds.length ||
      !row.cavityIds.every((id) => isBoundedLabel(id) && cavities.has(id))
    )
      return false
    seenIds.add(row.labelId)
    if (
      'leader' in row &&
      (row.inkSourceOperation === null || !row.leader || !leaderValid(row.leader))
    )
      return false
    if (row.inkSourceOperation === null) {
      if (
        row.status !== 'unresolved' ||
        row.reason !== 'height-caption-ink-unverified' ||
        row.cavityIds.length !== 0
      )
        return false
    } else {
      if (
        !Number.isSafeInteger(row.inkSourceOperation) ||
        row.inkSourceOperation < 0 ||
        seenOperations.has(row.inkSourceOperation) ||
        row.reason === 'height-caption-ink-unverified'
      )
        return false
      seenOperations.add(row.inkSourceOperation)
    }
    if (row.status === 'inside-single-cavity') {
      if (
        row.inkSourceOperation === null ||
        row.reason !== null ||
        row.cavityIds.length !== 1 ||
        cavities.get(row.cavityIds[0] ?? '')?.omittedBoundaryInkCount !== 0
      )
        return false
    } else if (row.status === 'ambiguous') {
      if (row.cavityIds.length < 2 || !isBoundedLabel(row.reason)) return false
    } else if (row.status === 'unresolved') {
      if (row.cavityIds.length > 1 || !isBoundedLabel(row.reason)) return false
    } else return false
  }
  return seenIds.size === parentIds.size
}

function isHeightObservations(value: unknown, packet: NativeReviewPacket): boolean {
  if (value === undefined) return true
  if (!value || typeof value !== 'object') return false
  const heights = value as NonNullable<NativeReviewPacket['heightObservations']>
  const omissionCount = (count: unknown) =>
    typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 && count <= 6000
  if (
    !hasOnlyKeys(heights, [
      'status',
      'refusalReason',
      'observations',
      'issues',
      'omissionCounts',
      ...('locations' in heights ? ['locations'] : []),
    ]) ||
    !Array.isArray(heights.observations) ||
    heights.observations.length > 100 ||
    !Array.isArray(heights.issues) ||
    heights.issues.length > 100 ||
    !heights.omissionCounts ||
    typeof heights.omissionCounts !== 'object' ||
    !hasOnlyKeys(heights.omissionCounts, ['skippedCurves', 'clippedPaths']) ||
    !omissionCount(heights.omissionCounts.skippedCurves) ||
    !omissionCount(heights.omissionCounts.clippedPaths) ||
    heights.omissionCounts.skippedCurves !== packet.extraction?.skippedCurves ||
    heights.omissionCounts.clippedPaths !== packet.extraction?.clippedPaths
  )
    return false
  if (heights.status === 'unresolved')
    return (
      isBoundedLabel(heights.refusalReason) &&
      heights.observations.length === 0 &&
      heights.issues.length === 0 &&
      isHeightLocations(heights, packet)
    )
  if (heights.status !== 'draft' || heights.refusalReason !== null) return false
  const originalText = (text: unknown): text is string =>
    typeof text === 'string' && !!text.trim() && text.length <= 200
  const observationOnlyCodes = new Set([
    'height-role-unclassified',
    'height-datum-unverified',
    'ambiguous-height-datum',
    'height-outside-model-range',
    'height-unit-ink-unverified',
  ])
  const observations = new Map<string, (typeof heights.observations)[number]>()
  const labelTexts = new Map<string, string>()
  let sharedUnits: string | undefined
  for (const observation of heights.observations) {
    if (
      !observation ||
      typeof observation !== 'object' ||
      !hasOnlyKeys(observation, [
        'labelId',
        'originalText',
        'valueMm',
        'quantityKind',
        'datum',
        'issueCodes',
        'mayAcceptFor3D',
        ...('unitEvidence' in observation ? ['unitEvidence'] : []),
      ]) ||
      !isBoundedLabel(observation.labelId) ||
      observations.has(observation.labelId) ||
      !originalText(observation.originalText) ||
      !Number.isFinite(observation.valueMm) ||
      ![
        'finished-ceiling',
        'opening-height',
        'beam-level',
        'threshold-level',
        'unclassified-height',
      ].includes(observation.quantityKind) ||
      !['unspecified', 'existing-floor', 'finished-floor'].includes(observation.datum) ||
      observation.mayAcceptFor3D !== false ||
      !Array.isArray(observation.issueCodes) ||
      observation.issueCodes.length > 20 ||
      !observation.issueCodes.every(isBoundedLabel) ||
      new Set(observation.issueCodes).size !== observation.issueCodes.length
    )
      return false
    const units = observation.unitEvidence
    let documentary = null
    if ('unitEvidence' in observation) {
      if (
        !units ||
        typeof units !== 'object' ||
        !hasOnlyKeys(units, [
          'kind',
          'labelId',
          'originalText',
          'nativeIndex',
          'inkSourceOperation',
          'source',
        ]) ||
        units.kind !== 'same-page-millimetre-declaration' ||
        !Number.isSafeInteger(units.nativeIndex) ||
        units.nativeIndex < 0 ||
        units.nativeIndex >= 1000 ||
        units.labelId !== `native-text-${units.nativeIndex}` ||
        units.labelId === observation.labelId ||
        !/^native-text-(?:0|[1-9]\d{0,2})$/u.test(observation.labelId) ||
        !originalText(units.originalText) ||
        nativeHeightMillimetreDeclarationIndex([units.originalText]) !== 0 ||
        (units.inkSourceOperation !== null &&
          (!Number.isSafeInteger(units.inkSourceOperation) || units.inkSourceOperation < 0)) ||
        !units.source ||
        typeof units.source !== 'object' ||
        !hasOnlyKeys(units.source, ['sha256', 'pdfPage', 'state']) ||
        units.source.sha256 !== packet.source.sha256 ||
        units.source.pdfPage !== packet.source.pdfPage ||
        units.source.state !== packet.source.state
      )
        return false
      const unitKey = JSON.stringify([
        units.labelId,
        units.originalText,
        units.nativeIndex,
        units.inkSourceOperation,
        units.source.sha256,
        units.source.pdfPage,
        units.source.state,
      ])
      if (sharedUnits !== undefined && sharedUnits !== unitKey) return false
      sharedUnits = unitKey
      documentary = nativeDocumentaryHeightCaption(observation.originalText)
      if (!documentary) return false
      if (units.inkSourceOperation === null)
        documentary.issueCodes.push('height-unit-ink-unverified')
    }
    const caption = documentary
      ? { status: 'observed' as const, observation: documentary }
      : nativeHeightCaption(observation.originalText)
    if (
      caption.status !== 'observed' ||
      caption.observation.valueMm !== observation.valueMm ||
      caption.observation.quantityKind !== observation.quantityKind ||
      caption.observation.datum !== observation.datum ||
      caption.observation.issueCodes.length !== observation.issueCodes.length ||
      caption.observation.issueCodes.some((code, index) => code !== observation.issueCodes[index])
    )
      return false
    observations.set(observation.labelId, observation)
    labelTexts.set(observation.labelId, observation.originalText)
  }
  const issueKeys = new Set<string>()
  const issueKey = (labelId: string, code: string) => JSON.stringify([labelId, code])
  for (const issue of heights.issues) {
    if (
      !issue ||
      typeof issue !== 'object' ||
      !hasOnlyKeys(issue, ['labelId', 'originalText', 'code']) ||
      !isBoundedLabel(issue.labelId) ||
      !originalText(issue.originalText) ||
      !isBoundedLabel(issue.code) ||
      issueKeys.has(issueKey(issue.labelId, issue.code))
    )
      return false
    const text = labelTexts.get(issue.labelId)
    const observation = observations.get(issue.labelId)
    const caption = observation ? null : nativeHeightCaption(issue.originalText)
    if (
      (text !== undefined && text !== issue.originalText) ||
      (observation && !observation.issueCodes.includes(issue.code)) ||
      (!observation &&
        (observationOnlyCodes.has(issue.code) ||
          caption?.status !== 'unresolved' ||
          caption.code !== issue.code))
    )
      return false
    labelTexts.set(issue.labelId, issue.originalText)
    issueKeys.add(issueKey(issue.labelId, issue.code))
  }
  return (
    heights.observations.every((observation) =>
      observation.issueCodes.every((code) => issueKeys.has(issueKey(observation.labelId, code))),
    ) && isHeightLocations(heights, packet)
  )
}

function isHeightObjects(value: unknown, packet: NativeReviewPacket): boolean {
  if (value === undefined) return true
  if (!value || typeof value !== 'object') return false
  const report = value as NonNullable<NativeReviewPacket['heightObjects']>
  if (
    !hasOnlyKeys(report, [
      'status',
      'refusalReason',
      'declarations',
      'unsupportedDeclarations',
      'bindings',
    ]) ||
    !Array.isArray(report.declarations) ||
    report.declarations.length > 100 ||
    !Array.isArray(report.unsupportedDeclarations) ||
    report.declarations.length + report.unsupportedDeclarations.length > 100 ||
    !Array.isArray(report.bindings) ||
    report.bindings.length > 100
  )
    return false
  if (report.status === 'unresolved')
    return (
      isBoundedLabel(report.refusalReason) &&
      !report.declarations.length &&
      !report.unsupportedDeclarations.length &&
      !report.bindings.length
    )
  const heights = packet.heightObservations
  const floor = packet.floorCavities
  if (
    report.status !== 'draft' ||
    report.refusalReason !== null ||
    heights?.status !== 'draft' ||
    floor?.status !== 'draft' ||
    report.bindings.length !== heights.observations.length
  )
    return false
  const declarations = new Map<string, (typeof report.declarations)[number]>()
  const knownNotes = new Map<string, string>()
  for (const row of [...heights.observations, ...heights.issues]) {
    if (nativeCeilingDatumDeclarationTopic(row.originalText))
      knownNotes.set(row.labelId, row.originalText)
  }
  const reportedNotes = new Map<string, string>()
  for (const row of report.unsupportedDeclarations) {
    if (
      !row ||
      typeof row !== 'object' ||
      !hasOnlyKeys(row, ['labelId', 'originalText', 'reason']) ||
      !isBoundedLabel(row.labelId) ||
      reportedNotes.has(row.labelId) ||
      typeof row.originalText !== 'string' ||
      !nativeCeilingDatumDeclarationTopic(row.originalText) ||
      nativeCeilingDatumDeclaration(row.originalText) !== null ||
      row.reason !== 'unsupported-ceiling-datum-declaration' ||
      knownNotes.get(row.labelId) !== row.originalText
    )
      return false
    reportedNotes.set(row.labelId, row.originalText)
  }
  const operations = new Set<number>()
  for (const row of report.declarations) {
    if (
      !row ||
      typeof row !== 'object' ||
      !hasOnlyKeys(row, [
        'labelId',
        'originalText',
        'scope',
        'datum',
        'minimumMm',
        'maximumMm',
        'status',
        'inkSourceOperation',
        'reason',
      ]) ||
      !isBoundedLabel(row.labelId) ||
      declarations.has(row.labelId) ||
      reportedNotes.has(row.labelId) ||
      knownNotes.get(row.labelId) !== row.originalText ||
      typeof row.originalText !== 'string'
    )
      return false
    const literal = nativeCeilingDatumDeclaration(row.originalText)
    if (
      !literal ||
      row.scope !== literal.scope ||
      row.datum !== literal.datum ||
      row.minimumMm !== literal.minimumMm ||
      row.maximumMm !== literal.maximumMm
    )
      return false
    if (row.inkSourceOperation !== null) {
      if (
        !Number.isSafeInteger(row.inkSourceOperation) ||
        row.inkSourceOperation < 0 ||
        operations.has(row.inkSourceOperation) ||
        heights.locations?.observations.some(
          (location) => location.inkSourceOperation === row.inkSourceOperation,
        )
      )
        return false
      operations.add(row.inkSourceOperation)
    }
    declarations.set(row.labelId, row)
    reportedNotes.set(row.labelId, row.originalText)
  }
  if (reportedNotes.size !== knownNotes.size) return false
  const first = report.declarations[0]
  const conflict =
    !!first &&
    report.declarations.some(
      (row) =>
        row.datum !== first.datum ||
        row.minimumMm !== first.minimumMm ||
        row.maximumMm !== first.maximumMm,
    )
  for (const row of report.declarations) {
    if (conflict) {
      if (row.status !== 'unresolved' || row.reason !== 'conflicting-ceiling-datum-declarations')
        return false
    } else if (row.inkSourceOperation !== null) {
      if (row.status !== 'verified' || row.reason !== null) return false
    } else if (
      row.status !== 'unresolved' ||
      !['height-datum-ink-unavailable', 'height-datum-ink-unverified'].includes(row.reason ?? '')
    )
      return false
  }
  const globalVerified =
    report.declarations.length > 0 && report.declarations.every((row) => row.status === 'verified')
  const locations = new Map(
    heights.locations?.status === 'draft'
      ? heights.locations.observations.map((row) => [row.labelId, row])
      : [],
  )
  const observations = new Map(heights.observations.map((row) => [row.labelId, row]))
  const cavities = new Map(floor.candidates.map((row) => [row.id, row]))
  const schedule = packet.roomSchedule
  const scheduleRows = schedule?.status === 'draft' ? schedule.rows : []
  const seen = new Set<string>()
  let targetsCount = 0
  for (const row of report.bindings) {
    if (
      !row ||
      typeof row !== 'object' ||
      !hasOnlyKeys(row, ['labelId', 'objectStatus', 'objectReason', 'targets', 'datumEvidence']) ||
      !isBoundedLabel(row.labelId) ||
      seen.has(row.labelId) ||
      !observations.has(row.labelId) ||
      !Array.isArray(row.targets) ||
      row.targets.length > 100 ||
      !row.datumEvidence ||
      typeof row.datumEvidence !== 'object' ||
      !hasOnlyKeys(row.datumEvidence, ['status', 'kind', 'sourceLabelIds', 'reason']) ||
      !Array.isArray(row.datumEvidence.sourceLabelIds) ||
      row.datumEvidence.sourceLabelIds.length > 101 ||
      !row.datumEvidence.sourceLabelIds.every(isBoundedLabel) ||
      new Set(row.datumEvidence.sourceLabelIds).size !== row.datumEvidence.sourceLabelIds.length
    )
      return false
    seen.add(row.labelId)
    targetsCount += row.targets.length
    if (targetsCount > 10000) return false
    const height = observations.get(row.labelId)
    if (!height) return false
    const location = locations.get(row.labelId)
    const eligible =
      height.quantityKind === 'finished-ceiling' && height.valueMm > 0 && height.valueMm <= 6000
    const hasInk = location && location.inkSourceOperation !== null
    let objectStatus: typeof row.objectStatus = 'unresolved'
    let objectReason: string | null = 'height-object-role-unresolved'
    let datumStatus: typeof row.datumEvidence.status = 'unresolved'
    let datumKind: typeof row.datumEvidence.kind = null
    let datumReason: string | null = 'height-object-role-unresolved'
    let datumRefs: string[] = []
    const expectedTargets: typeof row.targets = []
    if (eligible && !hasInk) objectReason = datumReason = 'height-caption-ink-unverified'
    if (eligible && hasInk) {
      const inline = height.datum === 'unspecified' ? null : height.datum
      datumRefs = [
        ...(inline ? [height.labelId] : []),
        ...report.declarations.map((item) => item.labelId),
        ...report.unsupportedDeclarations.map((item) => item.labelId),
      ]
      if (report.unsupportedDeclarations.length)
        datumReason = 'unsupported-ceiling-datum-declarations'
      else if (report.declarations.length && (!globalVerified || conflict))
        datumReason = conflict
          ? 'conflicting-ceiling-datum-declarations'
          : 'height-datum-ink-unverified'
      else if (inline && first && inline !== first.datum)
        datumReason = 'inline-global-height-datum-conflict'
      else if (
        report.declarations.some(
          (item) => height.valueMm < item.minimumMm || height.valueMm > item.maximumMm,
        )
      )
        datumReason = 'ceiling-height-outside-declared-range'
      else if (inline || globalVerified) {
        datumStatus = 'documentary'
        datumKind = inline ?? first?.datum ?? null
        datumReason = null
      } else datumReason = 'height-datum-unspecified'
      const leader = location.leader
      objectReason = leader?.reason ?? 'height-object-leader-unverified'
      if (leader?.status === 'linked' && leader.cavityIds.length === 1) {
        const cavity = cavities.get(leader.cavityIds[0] ?? '')
        if (!cavity || cavity.omittedBoundaryInkCount > 0)
          objectReason = 'height-object-floor-unverified'
        else {
          for (const markerLabelId of cavity.markerLabelIds)
            for (const link of scheduleRows)
              if (
                link.markerStatus === 'linked' &&
                link.markerLabelIds.length === 1 &&
                link.markerLabelIds[0] === markerLabelId
              )
                expectedTargets.push({
                  kind: 'finished-ceiling',
                  cavityId: cavity.id,
                  sourceRoomNumber: link.sourceNumber,
                  roomName: link.name,
                  markerLabelId,
                })
          if (
            expectedTargets.length === 1 &&
            cavity.markerStatus === 'unambiguous' &&
            cavity.markerLabelIds.length === 1 &&
            schedule?.status === 'draft'
          ) {
            objectStatus = 'proposed'
            objectReason = null
          } else if (expectedTargets.length > 1 || cavity.markerStatus === 'ambiguous') {
            objectStatus = 'ambiguous'
            objectReason = 'height-object-marker-ambiguous'
          } else objectReason = 'height-object-schedule-unverified'
        }
      }
    }
    if (
      row.objectStatus !== objectStatus ||
      row.objectReason !== objectReason ||
      row.datumEvidence.status !== datumStatus ||
      row.datumEvidence.kind !== datumKind ||
      row.datumEvidence.reason !== datumReason ||
      row.datumEvidence.sourceLabelIds.length !== datumRefs.length ||
      row.datumEvidence.sourceLabelIds.some((id, index) => id !== datumRefs[index]) ||
      row.targets.length !== expectedTargets.length
    )
      return false
    for (const [index, target] of row.targets.entries()) {
      const expected = expectedTargets[index]
      if (
        !target ||
        typeof target !== 'object' ||
        !expected ||
        !hasOnlyKeys(target, [
          'kind',
          'cavityId',
          'sourceRoomNumber',
          'roomName',
          'markerLabelId',
        ]) ||
        target.kind !== expected.kind ||
        target.cavityId !== expected.cavityId ||
        target.sourceRoomNumber !== expected.sourceRoomNumber ||
        target.roomName !== expected.roomName ||
        target.markerLabelId !== expected.markerLabelId
      )
        return false
    }
  }
  return seen.size === observations.size
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

function isPaintedRegionContext(packet: NativeReviewPacket): boolean {
  const report = packet.paintedRegionContext
  if (report === undefined) return true
  if (
    !report ||
    typeof report !== 'object' ||
    Object.keys(report).some((key) => !['status', 'refusalReason', 'regions'].includes(key)) ||
    !Array.isArray(report.regions) ||
    report.regions.length > 50 ||
    !Array.isArray(packet.faces) ||
    packet.faces.some((face) => !face || typeof face !== 'object') ||
    !packet.extraction ||
    ![packet.extraction.skippedCurves, packet.extraction.clippedPaths].every(
      (count) => Number.isSafeInteger(count) && count >= 0,
    )
  )
    return false
  if (report.status === 'unresolved')
    return (
      typeof report.refusalReason === 'string' &&
      report.refusalReason.length > 0 &&
      report.refusalReason.length <= 128 &&
      report.regions.length === 0
    )
  if (report.status !== 'draft' || report.refusalReason !== null) return false
  const fills = new Set(packet.faces.filter((face) => face.layer === 'fill').map((face) => face.id))
  if (fills.size !== report.regions.length) return false
  const seen = new Set<string>()
  return report.regions.every((region) => {
    if (
      !region ||
      typeof region !== 'object' ||
      Object.keys(region).some(
        (key) =>
          ![
            'candidateId',
            'sourceRef',
            'earlierPaintCount',
            'laterPaintCount',
            'unresolvedPaintCount',
            'possibleOmissionCount',
          ].includes(key),
      ) ||
      !fills.has(region.candidateId) ||
      seen.has(region.candidateId) ||
      !region.sourceRef ||
      typeof region.sourceRef !== 'object' ||
      Object.keys(region.sourceRef).some(
        (key) => !['operationIndex', 'subpathIndex'].includes(key),
      ) ||
      ![region.sourceRef.operationIndex, region.sourceRef.subpathIndex].every(
        (index) => Number.isSafeInteger(index) && index >= 0 && index < 100_000,
      ) ||
      region.candidateId !==
        `native-fill-${region.sourceRef.operationIndex}:${region.sourceRef.subpathIndex}` ||
      ![region.earlierPaintCount, region.laterPaintCount, region.unresolvedPaintCount].every(
        (count) => Number.isSafeInteger(count) && count >= 0 && count <= 3000,
      ) ||
      region.earlierPaintCount + region.laterPaintCount > 3000 ||
      region.unresolvedPaintCount > region.earlierPaintCount + region.laterPaintCount ||
      !Number.isSafeInteger(region.possibleOmissionCount) ||
      region.possibleOmissionCount < 0 ||
      region.possibleOmissionCount >
        packet.extraction.skippedCurves + packet.extraction.clippedPaths
    )
      return false
    seen.add(region.candidateId)
    return true
  })
}

function isOrderedPaint(packet: NativeReviewPacket): boolean {
  const report = packet.orderedPaint
  if (report === undefined) return true
  if (
    !report ||
    typeof report !== 'object' ||
    !hasOnlyKeys(report, ['status', 'refusalReason', 'regions']) ||
    !Array.isArray(report.regions) ||
    report.regions.length > 50 ||
    !Array.isArray(packet.faces) ||
    packet.faces.some((face) => !face || typeof face !== 'object')
  )
    return false
  if (report.status === 'unresolved')
    return (
      typeof report.refusalReason === 'string' &&
      report.refusalReason.length > 0 &&
      report.refusalReason.length <= 128 &&
      report.regions.length === 0
    )
  if (report.status !== 'diagnostic' || report.refusalReason !== null || !packet.extraction)
    return false
  const fills = new Set(packet.faces.filter((face) => face.layer === 'fill').map((face) => face.id))
  if (fills.size !== report.regions.length) return false
  const seen = new Set<string>()
  let pointCount = 0
  let pieceCount = 0
  const validRing = (ring: unknown): boolean => {
    if (
      !Array.isArray(ring) ||
      ring.length < 3 ||
      ring.length > 100 ||
      !ring.every((point) => isInImage(point, packet.image))
    )
      return false
    pointCount += ring.length
    return pointCount <= 10_000
  }
  return report.regions.every((region) => {
    if (
      !region ||
      typeof region !== 'object' ||
      !hasOnlyKeys(region, [
        'candidateId',
        'status',
        'refusalReason',
        'maskCount',
        'omittedStrokeCount',
        'boundaryInkComplete',
        'pieces',
      ]) ||
      !fills.has(region.candidateId) ||
      seen.has(region.candidateId) ||
      !Number.isSafeInteger(region.maskCount) ||
      region.maskCount < 0 ||
      region.maskCount > 3000 ||
      !Number.isSafeInteger(region.omittedStrokeCount) ||
      region.omittedStrokeCount < 0 ||
      region.omittedStrokeCount >
        packet.extraction.skippedCurves + packet.extraction.clippedPaths ||
      typeof region.boundaryInkComplete !== 'boolean' ||
      (region.omittedStrokeCount > 0 && region.boundaryInkComplete) ||
      !Array.isArray(region.pieces) ||
      region.pieces.length > 100
    )
      return false
    seen.add(region.candidateId)
    if (region.status === 'held')
      return (
        typeof region.refusalReason === 'string' &&
        region.refusalReason.length > 0 &&
        region.refusalReason.length <= 128 &&
        region.pieces.length === 0
      )
    if (region.status !== 'diagnostic' || region.refusalReason !== null) return false
    pieceCount += region.pieces.length
    if (pieceCount > 500) return false
    return region.pieces.every(
      (piece) =>
        piece &&
        typeof piece === 'object' &&
        hasOnlyKeys(piece, ['polygon', 'holes']) &&
        validRing(piece.polygon) &&
        Array.isArray(piece.holes) &&
        piece.holes.length <= 50 &&
        piece.holes.every(validRing),
    )
  })
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
    !isFilledPanelSymbols(packet.filledPanelSymbols, packet.image) ||
    !nativeSourceObjectReportsValid(packet) ||
    !isSourceLinks(packet.sourceLinks, packet) ||
    !isNumberCircles(packet.numberCircles) ||
    !isDimensionDiscovery(packet.dimensionDiscovery, packet) ||
    !isSourceCaptionBindings(packet.sourceCaptionBindings, packet) ||
    !isScaleEvidence(packet.scaleEvidence, packet) ||
    !isFloorCavities(packet.floorCavities, packet) ||
    !isHeightObservations(packet.heightObservations, packet) ||
    !isRoomSchedule(packet.roomSchedule, packet) ||
    !isHeightObjects(packet.heightObjects, packet) ||
    !isDimensionTargets(packet.dimensionTargets, packet) ||
    !isDimensionStrokeContacts(packet.dimensionStrokeContacts, packet) ||
    !isFloorOpeningSides(packet.floorOpeningSides, packet) ||
    !isSavedFrameRooms(packet.savedFrameRooms, packet) ||
    !isPaintedRegionContext(packet) ||
    !isOrderedPaint(packet) ||
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
