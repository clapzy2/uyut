import { isPlanRoomSourceNumber } from '@uyut/db/source-room-number'
import { z } from 'zod'
import { exactNativePointKey } from '@/lib/projects/plan-native-exact-intersections'
import { nativeFaceRationalPredicates } from '@/lib/projects/plan-native-face-rational'
import type { SourceFloorReference } from '@/lib/projects/plan-page-source-floors'
import type { PageContourDraft, PlanPagePreview } from './plan-page-contour-editor-model'

const point = z.strictObject({ x: z.number().min(0).max(1000), y: z.number().min(0).max(1000) })
const ring = z.array(point).min(3).max(100)
const exactKey = z
  .string()
  .max(256)
  .regex(/^(0|[1-9]\d*)\/[1-9]\d*:(0|[1-9]\d*)\/[1-9]\d*$/)
const keys = z.array(exactKey).min(3).max(100)
const sourceRef = z.strictObject({
  operationIndex: z.number().int().min(0).max(99999),
  subpathIndex: z.number().int().min(0).max(3000),
  segmentIndex: z.number().int().min(0).max(20000),
})
const openingInspection = z.strictObject({
  status: z.enum(['checked', 'held']),
  reason: z.string().min(1).max(256).nullable(),
  completeOpeningInventory: z.literal(false),
  physicalJambAccepted: z.literal(false),
  physicalPassageAccepted: z.literal(false),
  finalPaintVisibilityProved: z.literal(false),
  targets: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(200),
        objectId: z.string().min(1).max(128),
        kind: z.enum(['frame-side', 'frame-jamb', 'panel-end']),
        sourceRef,
        startKey: exactKey,
        endKey: exactKey,
        frameInteriorSide: z.enum(['left', 'right']).nullable(),
        independentSourceRefs: z.array(sourceRef).max(100),
        sourceEndStatus: z
          .enum(['matched', 'partial', 'ambiguous', 'unobserved', 'unresolved'])
          .nullable(),
        omittedInkCount: z.number().int().min(0).max(6000),
        laterPaintCount: z.number().int().min(0).max(20000).nullable(),
        status: z.enum(['matched', 'partial', 'ambiguous', 'unobserved', 'unresolved']),
        coverage: z.enum(['complete', 'partial', 'unproved']),
        contacts: z
          .array(
            z.strictObject({
              floorId: z.string().min(1).max(128),
              ringIndex: z.number().int().min(0).max(50),
              edgeIndex: z.number().int().min(0).max(99),
              startKey: exactKey,
              endKey: exactKey,
              regionSide: z.enum(['left', 'right']),
            }),
          )
          .max(100),
      }),
    )
    .max(600),
})
const boundarySupport = z.strictObject({
  ringIndex: z.number().int().min(0).max(50),
  edgeIndex: z.number().int().min(0).max(99),
  sourceRegionSide: z.enum(['left', 'right']),
  status: z.enum(['linked', 'partial', 'ambiguous', 'unobserved']),
  coverage: z.enum(['complete', 'partial', 'unproved']),
  reason: z
    .enum([
      'partial-source-span',
      'competing-source-sides',
      'competing-source-spans',
      'missing-source-span',
    ])
    .nullable(),
  omittedInkCount: z.number().int().min(0).max(6000),
  contacts: z
    .array(
      z.strictObject({
        operationIndex: z.number().int().min(0).max(99999),
        subpathIndex: z.number().int().min(0).max(3000),
        segmentIndex: z.number().int().min(0).max(20000),
        startKey: exactKey,
        endKey: exactKey,
        paintSide: z.enum(['selected-region', 'opposite-region']),
      }),
    )
    .max(100),
})
const referenceSchema = z.strictObject({
  version: z.literal(1),
  coordinateSystem: z.literal('page-0-1000'),
  source: z.strictObject({
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    pdfPage: z.number().int().positive(),
    state: z.literal('existing'),
  }),
  sourceRevision: z.string().regex(/^[a-f0-9]{64}$/),
  pageWidth: z.number().positive().max(100000),
  pageHeight: z.number().positive().max(100000),
  status: z.enum(['not-saved', 'held', 'checked']),
  reason: z.string().max(256).nullable(),
  readOnly: z.literal(true),
  physicalBoundariesAccepted: z.literal(false),
  boundaryInspection: z
    .strictObject({
      status: z.enum(['checked', 'held']),
      reason: z.string().min(1).max(256).nullable(),
    })
    .optional(),
  openingInspection: openingInspection.optional(),
  floors: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(128),
        sourceRoomKey: z.string().min(1).max(32),
        name: z.string().min(1).max(200),
        polygon: ring,
        holes: z.array(ring).max(50),
        exactPointKeys: keys,
        holeExactPointKeys: z.array(keys).max(50),
        nonDecimalVertices: z.number().int().min(0).max(5100),
        omittedStrokeCount: z.number().int().min(0).max(6000),
        boundaryInkComplete: z.boolean(),
        boundarySupports: z.array(boundarySupport).max(5100).optional(),
      }),
    )
    .max(50),
})

export function sourceFloorReferenceFromResponse(
  value: unknown,
  page: PlanPagePreview,
  revision: string,
): SourceFloorReference | null {
  const parsed = referenceSchema.safeParse(value)
  if (!parsed.success) return null
  const report = parsed.data
  if (
    report.source.sha256 !== page.sha256 ||
    report.source.pdfPage !== page.page ||
    report.sourceRevision !== revision ||
    report.pageWidth !== page.width ||
    report.pageHeight !== page.height ||
    (report.status !== 'checked' && report.floors.length !== 0) ||
    (report.status === 'held' ? !report.reason : report.reason !== null)
  )
    return null
  const inspection = report.boundaryInspection
  if (
    inspection &&
    (report.status !== 'checked' ||
      (inspection.status === 'held' ? !inspection.reason : inspection.reason !== null))
  )
    return null
  let pointCount = 0
  let contactCount = 0
  let workLeft = 300_000
  const exact = nativeFaceRationalPredicates()
  const owners = new Set<string>()
  const ids = new Set<string>()
  for (const floor of report.floors) {
    const number = Number(floor.sourceRoomKey)
    if (
      !isPlanRoomSourceNumber(number) ||
      String(number) !== floor.sourceRoomKey ||
      owners.has(floor.sourceRoomKey) ||
      ids.has(floor.id)
    )
      return null
    owners.add(floor.sourceRoomKey)
    ids.add(floor.id)
    if (
      floor.exactPointKeys.length !== floor.polygon.length ||
      floor.holeExactPointKeys.length !== floor.holes.length
    )
      return null
    let nonDecimal = 0
    for (const [index, polygon] of [floor.polygon, ...floor.holes].entries()) {
      const sourceKeys = index === 0 ? floor.exactPointKeys : floor.holeExactPointKeys[index - 1]
      if (!sourceKeys || sourceKeys.length !== polygon.length) return null
      pointCount += polygon.length
      nonDecimal += polygon.filter(
        (point, vertexIndex) => exactNativePointKey(point) !== sourceKeys[vertexIndex],
      ).length
    }
    if (
      pointCount > 10000 ||
      nonDecimal !== floor.nonDecimalVertices ||
      floor.boundaryInkComplete !== (floor.omittedStrokeCount === 0)
    )
      return null
    const supports = floor.boundarySupports
    if (inspection?.status !== 'checked') {
      if (supports !== undefined) return null
      continue
    }
    const rings = [floor.exactPointKeys, ...floor.holeExactPointKeys]
    if (!supports || supports.length !== rings.reduce((sum, ring) => sum + ring.length, 0))
      return null
    const seenEdges = new Set<string>()
    const sides = rings.map((ring, index) => exact.winding(ring) * (index === 0 ? 1 : -1))
    for (const support of supports) {
      const ring = rings[support.ringIndex]
      const start = ring?.[support.edgeIndex]
      const end = ring?.[(support.edgeIndex + 1) % ring.length]
      const edgeId = `${support.ringIndex}:${support.edgeIndex}`
      const side = sides[support.ringIndex]
      if (
        !start ||
        !end ||
        !side ||
        seenEdges.has(edgeId) ||
        support.sourceRegionSide !== (side > 0 ? 'left' : 'right')
      )
        return null
      seenEdges.add(edgeId)
      contactCount += support.contacts.length
      workLeft -= support.contacts.length
      if (contactCount > 10000) return null
      const refs = new Set<string>()
      for (const contact of support.contacts) {
        const ref = `${contact.operationIndex}:${contact.subpathIndex}:${contact.segmentIndex}`
        const overlap = exact.sharedSpan(start, end, contact.startKey, contact.endKey)
        if (
          refs.has(ref) ||
          overlap?.startKey !== contact.startKey ||
          overlap.endKey !== contact.endKey
        )
          return null
        refs.add(ref)
      }
      const complete = exact.coversSpan(start, end, support.contacts)
      const competingSides = new Set(support.contacts.map((contact) => contact.paintSide)).size > 1
      const competingSpans = support.contacts.some((contact, index) =>
        support.contacts.slice(index + 1).some((other) => {
          if (--workLeft < 0) return false
          return (
            (contact.operationIndex !== other.operationIndex ||
              contact.subpathIndex !== other.subpathIndex) &&
            exact.sharedSpan(contact.startKey, contact.endKey, other.startKey, other.endKey) !==
              null
          )
        }),
      )
      if (workLeft < 0) return null
      const reason = competingSides
        ? 'competing-source-sides'
        : competingSpans
          ? 'competing-source-spans'
          : complete
            ? null
            : support.contacts.length
              ? 'partial-source-span'
              : 'missing-source-span'
      const status =
        competingSides || competingSpans
          ? 'ambiguous'
          : complete
            ? 'linked'
            : support.contacts.length
              ? 'partial'
              : 'unobserved'
      const coverage = complete ? 'complete' : support.contacts.length ? 'partial' : 'unproved'
      if (support.status !== status || support.reason !== reason || support.coverage !== coverage)
        return null
    }
  }
  const opening = report.openingInspection
  if (opening) {
    if (
      report.status !== 'checked' ||
      (opening.status === 'held'
        ? !opening.reason || opening.targets.length !== 0
        : opening.reason !== null) ||
      (opening.status === 'checked' && inspection?.status !== 'checked')
    )
      return null
    const targetIds = new Set<string>()
    let openingContacts = 0
    for (const target of opening.targets) {
      if (
        targetIds.has(target.id) ||
        target.id !== `${target.objectId}:${target.kind}:${target.sourceRef.segmentIndex}` ||
        !exact.sharedSpan(target.startKey, target.endKey, target.startKey, target.endKey) ||
        (target.kind === 'panel-end'
          ? target.frameInteriorSide !== null ||
            target.sourceEndStatus === null ||
            target.laterPaintCount === null
          : target.frameInteriorSide === null ||
            target.sourceEndStatus !== null ||
            target.laterPaintCount !== null) ||
        (target.kind === 'frame-side' && target.independentSourceRefs.length !== 0)
      )
        return null
      targetIds.add(target.id)
      const refs = target.independentSourceRefs.map(
        (ref) => `${ref.operationIndex}:${ref.subpathIndex}:${ref.segmentIndex}`,
      )
      if (new Set(refs).size !== refs.length) return null
      const contacts = new Set<string>()
      for (const contact of target.contacts) {
        if (++openingContacts > 10000) return null
        const floor = report.floors.find((floor) => floor.id === contact.floorId)
        const ring = floor && [floor.exactPointKeys, ...floor.holeExactPointKeys][contact.ringIndex]
        const start = ring?.[contact.edgeIndex]
        const end = ring?.[(contact.edgeIndex + 1) % ring.length]
        const contactId = `${contact.floorId}:${contact.ringIndex}:${contact.edgeIndex}`
        if (!ring || !start || !end || contacts.has(contactId)) return null
        contacts.add(contactId)
        const span = exact.sharedSpan(target.startKey, target.endKey, start, end)
        const axis = exact.compareAxis(target.startKey, target.endKey, 'x') === 0 ? 'y' : 'x'
        const side =
          exact.winding(ring) *
          (contact.ringIndex === 0 ? 1 : -1) *
          exact.compareAxis(start, end, axis) *
          exact.compareAxis(target.startKey, target.endKey, axis)
        if (
          !side ||
          contact.regionSide !== (side > 0 ? 'left' : 'right') ||
          span?.startKey !== contact.startKey ||
          span.endKey !== contact.endKey
        )
          return null
      }
      const complete = exact.coversSpan(target.startKey, target.endKey, target.contacts)
      const competing =
        new Set(target.contacts.map((contact) => contact.floorId)).size > 1 ||
        new Set(target.contacts.map((contact) => contact.regionSide)).size > 1
      const sameInterior =
        target.kind === 'frame-side' &&
        target.contacts.some((contact) => contact.regionSide === target.frameInteriorSide)
      const endHeld =
        target.kind === 'panel-end' &&
        target.sourceEndStatus !== 'matched' &&
        target.contacts.length > 0
      const status =
        competing || (target.contacts.length > 0 && target.sourceEndStatus === 'ambiguous')
          ? 'ambiguous'
          : sameInterior || endHeld
            ? 'unresolved'
            : complete
              ? 'matched'
              : target.contacts.length
                ? 'partial'
                : 'unobserved'
      const coverage = complete ? 'complete' : target.contacts.length ? 'partial' : 'unproved'
      if (target.status !== status || target.coverage !== coverage) return null
    }
  }
  return report
}

export type SourceFloorDraftResult =
  | { kind: 'candidate'; draft: PageContourDraft }
  | {
      kind: 'held'
      reason: 'missing-selection' | 'holes' | 'rational-precision' | 'unproved-vertex'
    }

/** Whole-ring copy only. No holes become voids, and no nearby node replaces a source vertex. */
export function sourceFloorDraft(
  floor: SourceFloorReference['floors'][number] | undefined,
): SourceFloorDraftResult {
  if (!floor) return { kind: 'held', reason: 'missing-selection' }
  return {
    kind: 'candidate',
    draft: {
      roomSourceNumber: Number(floor.sourceRoomKey),
      polygon: structuredClone(floor.polygon),
      closed: true,
      sourceTopology: {
        kind: 'unclassified-source-paint',
        floorId: floor.id,
        exactPointKeys: [...floor.exactPointKeys],
        holes: structuredClone(floor.holes),
        holeExactPointKeys: structuredClone(floor.holeExactPointKeys),
      },
    },
  }
}

export function sourceFloorReferencePath(
  floor: Pick<SourceFloorReference['floors'][number], 'polygon' | 'holes'>,
): string {
  return [floor.polygon, ...floor.holes]
    .map(
      (ring) =>
        ring.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ') +
        ' Z',
    )
    .join(' ')
}
