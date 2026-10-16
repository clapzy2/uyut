import type { PlanPageContours, PlanReading } from '@uyut/db'
import { planEditRevision } from './plan-edit-revision'
import { pageReviewRoomsMatch, planPageReviewIssue } from './plan-page-review'
import { planPageSourceFloors } from './plan-page-source-floors'
import type { PagePoint, PdfLinework } from './plan-pdf-linework'
import type { PdfPlanSource } from './plan-pdf-room-binding'
import { pdfContourIdentity } from './plan-pdf-room-binding'

type Input = {
  contours: PlanPageContours
  reading: PlanReading
  source: PdfPlanSource
  linework: PdfLinework
  evidence?: Parameters<typeof planPageSourceFloors>[0]['evidence']
}

const sameRing = (first: readonly PagePoint[], second: readonly PagePoint[]) =>
  first.length === second.length &&
  first.every((point, index) => point.x === second[index]?.x && point.y === second[index]?.y)

const sameKeys = (first: readonly string[], second: readonly string[]) =>
  first.length === second.length && first.every((key, index) => key === second[index])

/** Save source-only snapshots without passing their rounded display rings to physical consumers. */
export function sourceTopologyDraftIssue(input: Input): string | undefined {
  const { contours, reading, source, linework } = input
  const selected: PlanPageContours['rooms'] = []
  for (const room of contours.rooms) {
    if (room.sourceTopology) selected.push(room)
    else if (room.sourceTrace)
      selected.push({
        ...pdfContourIdentity(room),
        polygon: room.sourceTrace.polygon,
        sourceTopology: room.sourceTrace.sourceTopology,
      })
  }
  if (!selected.length) return planPageReviewIssue(contours, reading, source, linework)
  if (!pageReviewRoomsMatch(contours, reading)) return 'unknown-room-number'
  const numbers = contours.rooms.flatMap(
    (room) => room.roomSourceNumbers ?? [room.roomSourceNumber],
  )
  if (new Set(numbers).size !== numbers.length) return 'duplicate-room-membership'

  // Keep all existing source/frame/feature checks, including when every room is source-only.
  const legacyIssue = planPageReviewIssue(
    { ...contours, rooms: contours.rooms.filter((room) => room.sourceTopology === undefined) },
    reading,
    source,
    linework,
  )
  if (legacyIssue) return legacyIssue
  for (const room of contours.rooms.filter((room) => room.sourceTopology)) {
    if (
      room.roomSourceNumbers !== undefined ||
      ['vertexProofs', 'conditionalEdges', 'dimensionEdges', 'openings', 'obstacles'].some(
        (field) => Object.hasOwn(room, field),
      )
    )
      return 'source-topology-features-not-supported'
  }

  const fresh = planPageSourceFloors({
    source,
    // This internal reference is not a client/CAS revision or a new authorization token.
    sourceRevision: planEditRevision(null, reading),
    pageWidth: contours.pageWidth,
    pageHeight: contours.pageHeight,
    reading,
    evidence: input.evidence,
  })
  if (fresh.status !== 'checked') return fresh.reason ?? 'source-topology-evidence-unavailable'
  for (const room of selected) {
    const topology = room.sourceTopology
    if (topology?.kind !== 'unclassified-source-paint') return 'invalid-source-topology'
    const matches = fresh.floors.filter((floor) => floor.id === topology.floorId)
    const floor = matches[0]
    if (matches.length !== 1 || !floor || floor.sourceRoomKey !== String(room.roomSourceNumber))
      return 'source-topology-owner-mismatch'
    if (
      !sameRing(room.polygon, floor.polygon) ||
      !sameKeys(topology.exactPointKeys, floor.exactPointKeys) ||
      topology.holes.length !== floor.holes.length ||
      topology.holeExactPointKeys.length !== floor.holeExactPointKeys.length ||
      topology.holes.some((ring, index) => !sameRing(ring, floor.holes[index] ?? [])) ||
      topology.holeExactPointKeys.some(
        (keys, index) => !sameKeys(keys, floor.holeExactPointKeys[index] ?? []),
      )
    )
      return 'source-topology-snapshot-mismatch'
  }
  return undefined
}
