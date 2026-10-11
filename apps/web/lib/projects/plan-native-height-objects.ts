import { nativeFloorCavityCandidates } from './plan-native-floor-cavities'
import {
  nativeCeilingDatumDeclaration,
  nativeCeilingDatumDeclarationTopic,
} from './plan-native-height-datum-caption'
import { nativeHeightSourceLocations } from './plan-native-height-locations'
import { nativeHeightObservations } from './plan-native-height-observations'
import { nativeRoomNumberScheduleLinks } from './plan-native-room-number-links'
import { nativeCaptionInkIssue } from './plan-pdf-caption-binding'
import type { PagePoint } from './plan-pdf-linework'
import { pdfPolygonIsValid } from './plan-pdf-room-binding'

type Input = Parameters<typeof nativeHeightObservations>[0]
type Datum = 'existing-floor' | 'finished-floor'
export type NativeHeightObjectReport = {
  status: 'draft' | 'unresolved'
  refusalReason: string | null
  unsupportedDeclarations: {
    labelId: string
    originalText: string
    reason: 'unsupported-ceiling-datum-declaration'
  }[]
  declarations: {
    labelId: string
    originalText: string
    scope: 'apartment-finished-ceilings'
    datum: Datum
    minimumMm: number
    maximumMm: number
    status: 'verified' | 'unresolved'
    inkSourceOperation: number | null
    reason: string | null
  }[]
  bindings: {
    labelId: string
    objectStatus: 'proposed' | 'ambiguous' | 'unresolved'
    objectReason: string | null
    targets: {
      kind: 'finished-ceiling'
      cavityId: string
      sourceRoomNumber: number
      roomName: string
      markerLabelId: string
    }[]
    datumEvidence: {
      status: 'documentary' | 'unresolved'
      kind: Datum | null
      sourceLabelIds: string[]
      reason: string | null
    }
  }[]
}

const validPoint = (point: PagePoint | undefined): point is PagePoint =>
  !!point &&
  [point.x, point.y].every((value) => Number.isFinite(value) && value >= 0 && value <= 1000)

/** Source-object proposals and documentary reference kinds, never accepted height ownership or a shared zero. */
export function nativeHeightObjectEvidence(input: Input) {
  const report: NativeHeightObjectReport = {
    status: 'draft',
    refusalReason: null,
    unsupportedDeclarations: [],
    declarations: [],
    bindings: [],
  }
  const finish = (reason: string | null) => ({
    ...structuredClone(
      reason
        ? {
            ...report,
            status: 'unresolved' as const,
            refusalReason: reason,
            declarations: [],
            unsupportedDeclarations: [],
            bindings: [],
          }
        : report,
    ),
    source: { ...input.source },
    image: { ...input.native.source },
    readOnly: true as const,
    commonZeroConfirmed: false as const,
    geometryOwnersConfirmed: false as const,
    mayTransfer2D3D: false as const,
  })
  const heights = nativeHeightObservations(input)
  if (heights.refusalReason) return finish(heights.refusalReason)
  if (heights.observations.length > 100 || input.native.labels.length > 1000)
    return finish('height-object-budget-exceeded')
  const locations = nativeHeightSourceLocations(input)
  // Source/provenance failures cannot be converted to a partial positive report.
  if (
    locations.refusalReason &&
    !['height-caption-ink-unavailable'].includes(locations.refusalReason)
  )
    return finish(locations.refusalReason)
  const floor = nativeFloorCavityCandidates(input)
  if (floor.refusalReason) return finish(floor.refusalReason)
  const schedule = nativeRoomNumberScheduleLinks(input).report
  const labels = new Map(input.native.labels.map((label) => [label.nativeIndex, label]))
  for (const label of input.native.labels) {
    if (!nativeCeilingDatumDeclarationTopic(label.name)) continue
    const declaration = nativeCeilingDatumDeclaration(label.name)
    if (!declaration) {
      report.unsupportedDeclarations.push({
        labelId: label.id,
        originalText: label.name,
        reason: 'unsupported-ceiling-datum-declaration',
      })
      continue
    }
    report.declarations.push({
      labelId: label.id,
      originalText: label.name,
      ...declaration,
      status: 'unresolved',
      inkSourceOperation: null,
      reason: 'height-datum-ink-unavailable',
    })
  }
  if (report.declarations.length + report.unsupportedDeclarations.length > 100)
    return finish('height-datum-budget-exceeded')
  const ink = input.native.heightDatumInk
  if (ink) {
    if (
      !ink.source ||
      ink.source.sha256 !== input.source.sha256 ||
      ink.source.pdfPage !== input.source.pdfPage ||
      ink.source.pageWidth !== input.work.pageWidth ||
      ink.source.pageHeight !== input.work.pageHeight
    )
      return finish('different-height-datum-source')
    if (
      !Array.isArray(ink.items) ||
      !Array.isArray(ink.unresolved) ||
      ink.items.length + ink.unresolved.length > 100 ||
      typeof ink.complete !== 'boolean' ||
      (ink.refusalReason !== null && typeof ink.refusalReason !== 'string')
    )
      return finish('invalid-height-datum-inventory')
    if (ink.refusalReason) return finish(ink.refusalReason)
    const expected = new Set(
      [...report.declarations, ...report.unsupportedDeclarations].map((row) =>
        Number(row.labelId.slice('native-text-'.length)),
      ),
    )
    const indexes = new Set<number>()
    for (const item of [...ink.items, ...ink.unresolved]) {
      if (
        !item ||
        !Number.isSafeInteger(item.index) ||
        !expected.has(item.index) ||
        indexes.has(item.index)
      )
        return finish('invalid-height-datum-inventory')
      indexes.add(item.index)
    }
    if (indexes.size !== expected.size || ink.complete !== (ink.unresolved.length === 0))
      return finish('incomplete-height-datum-inventory')
    if (
      ink.unresolved.some(
        (row) => typeof row.reason !== 'string' || !row.reason || row.reason.length > 200,
      )
    )
      return finish('invalid-height-datum-inventory')
    const operations = new Set<number>()
    for (const item of ink.items) {
      const label = labels.get(item.index)
      if (
        !label?.pagePoint ||
        item.text !== label.name ||
        !Number.isSafeInteger(item.operationIndex) ||
        item.operationIndex < 0 ||
        operations.has(item.operationIndex) ||
        !Array.isArray(item.quad) ||
        item.quad.length !== 4 ||
        !item.quad.every(validPoint) ||
        !pdfPolygonIsValid(item.quad) ||
        !validPoint(item.baselineStart) ||
        !validPoint(item.baselineEnd) ||
        Math.abs(item.baselineStart.x - label.pagePoint.x) > 1e-7 ||
        Math.abs(item.baselineStart.y - label.pagePoint.y) > 1e-7
      )
        return finish('invalid-height-datum-provenance')
      const dx = (item.baselineEnd.x - item.baselineStart.x) * input.work.pageWidth
      const dy = (item.baselineEnd.y - item.baselineStart.y) * input.work.pageHeight
      const delta = Math.abs(
        ((-Math.atan2(dy, dx) * 180) / Math.PI - (label.rotation as number)) % 360,
      )
      if ((dx === 0 && dy === 0) || Math.min(delta, 360 - delta) > 1e-6)
        return finish('invalid-height-datum-provenance')
      operations.add(item.operationIndex)
    }
    if (
      nativeCaptionInkIssue(
        {
          source: ink.source,
          complete: ink.complete,
          items: ink.items.map((item) => ({
            index: item.index,
            text: item.text,
            rotation: labels.get(item.index)?.rotation as number,
            origin: item.baselineStart,
            baselineStart: item.baselineStart,
            baselineEnd: item.baselineEnd,
            inkPolygon: item.quad,
            inkSourceOperation: item.operationIndex,
          })),
        },
        input.work,
      )
    )
      return finish('invalid-height-datum-provenance')
    for (const row of report.declarations) {
      const index = Number(row.labelId.slice('native-text-'.length))
      const item = ink.items.find((item) => item.index === index)
      row.status = item ? 'verified' : 'unresolved'
      row.inkSourceOperation = item?.operationIndex ?? null
      row.reason = item ? null : 'height-datum-ink-unverified'
    }
  }
  const first = report.declarations[0]
  const conflict =
    !!first &&
    report.declarations.some(
      (row) =>
        row.datum !== first.datum ||
        row.minimumMm !== first.minimumMm ||
        row.maximumMm !== first.maximumMm,
    )
  if (conflict)
    for (const row of report.declarations) {
      row.status = 'unresolved'
      row.reason = 'conflicting-ceiling-datum-declarations'
    }
  const globalVerified =
    report.declarations.length > 0 && report.declarations.every((row) => row.status === 'verified')
  let workRemaining = 500_000
  for (const height of heights.observations) {
    const row: NativeHeightObjectReport['bindings'][number] = {
      labelId: height.labelId,
      objectStatus: 'unresolved',
      objectReason: 'height-object-role-unresolved',
      targets: [],
      datumEvidence: {
        status: 'unresolved',
        kind: null,
        sourceLabelIds: [],
        reason: 'height-object-role-unresolved',
      },
    }
    report.bindings.push(row)
    if (height.quantityKind !== 'finished-ceiling' || height.valueMm <= 0 || height.valueMm > 6000)
      continue
    const location = locations.observations.find((item) => item.labelId === height.labelId)
    if (location?.inkSourceOperation === null || !location) {
      row.objectReason = row.datumEvidence.reason = 'height-caption-ink-unverified'
      continue
    }
    const inline = height.datum === 'unspecified' ? null : height.datum
    const globalIds = [...report.declarations, ...report.unsupportedDeclarations].map(
      (item) => item.labelId,
    )
    const refs = [...(inline ? [height.labelId] : []), ...globalIds]
    row.datumEvidence.sourceLabelIds = refs
    if (report.unsupportedDeclarations.length) {
      row.datumEvidence.reason = 'unsupported-ceiling-datum-declarations'
    } else if (report.declarations.length && (!globalVerified || conflict)) {
      row.datumEvidence.reason = conflict
        ? 'conflicting-ceiling-datum-declarations'
        : 'height-datum-ink-unverified'
    } else if (inline && first && inline !== first.datum) {
      row.datumEvidence.reason = 'inline-global-height-datum-conflict'
    } else if (
      report.declarations.some(
        (item) => height.valueMm < item.minimumMm || height.valueMm > item.maximumMm,
      )
    ) {
      row.datumEvidence.reason = 'ceiling-height-outside-declared-range'
    } else if (inline || globalVerified) {
      row.datumEvidence.status = 'documentary'
      row.datumEvidence.kind = inline ?? first?.datum ?? null
      row.datumEvidence.reason = null
    } else row.datumEvidence.reason = 'height-datum-unspecified'
    const leader = location.leader
    row.objectReason = leader?.reason ?? 'height-object-leader-unverified'
    if (leader?.status !== 'linked' || leader.cavityIds.length !== 1) continue
    const cavity = floor.cavities.find((item) => item.id === leader.cavityIds[0])
    // Unknown interior strokes include annotation frames and dimension lines.
    // A documentary owner proposal does not assert a clear or accepted floor.
    if (!cavity || cavity.omittedBoundaryInkCount > 0) {
      row.objectReason = 'height-object-floor-unverified'
      continue
    }
    for (const markerLabelId of cavity.markerLabelIds) {
      for (const link of schedule.rows) {
        if (--workRemaining < 0) return finish('height-object-work-limit')
        if (
          link.markerStatus !== 'linked' ||
          link.markerLabelIds.length !== 1 ||
          link.markerLabelIds[0] !== markerLabelId
        )
          continue
        row.targets.push({
          kind: 'finished-ceiling',
          cavityId: cavity.id,
          sourceRoomNumber: link.sourceNumber,
          roomName: link.name,
          markerLabelId,
        })
      }
    }
    if (row.targets.length > 100) return finish('height-object-target-budget-exceeded')
    if (
      row.targets.length === 1 &&
      cavity.markerStatus === 'unambiguous' &&
      cavity.markerLabelIds.length === 1 &&
      !schedule.refusalReason
    ) {
      row.objectStatus = 'proposed'
      row.objectReason = null
    } else if (row.targets.length > 1 || cavity.markerStatus === 'ambiguous') {
      row.objectStatus = 'ambiguous'
      row.objectReason = 'height-object-marker-ambiguous'
    } else row.objectReason = 'height-object-schedule-unverified'
  }
  return finish(null)
}
