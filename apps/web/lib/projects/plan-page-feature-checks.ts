import { planMeasurementTextItems } from '@uyut/ai'
import type { PlanPageContours, PlanPageOpening, PlanPageOpeningCheck } from '@uyut/db'
import { planPageFeaturesIssue } from './plan-page-review'
import { createPdfOpeningSpanVerifier } from './plan-pdf-dimension-chain'
import type { PdfLinework } from './plan-pdf-linework'
import {
  type PdfPlanSource,
  pdfBoundaryDistance,
  pdfContourIdentity,
  pdfContourKey,
  pdfPointInside,
} from './plan-pdf-room-binding'

const pointKey = (point: { x: number; y: number }) => `${point.x}:${point.y}`
const cutKey = (opening: PlanPageOpening) => {
  const ends = [pointKey(opening.start), pointKey(opening.end)].sort()
  return `${opening.kind}:${ends.join('|')}`
}

type OpeningLabel = { index: number; text: string; rotation: number; x: number; y: number }

/** Transfer one verified label across a coincident declared door cut, never across a nearby wall. */
function transferOppositeOpeningWidths(
  result: PlanPageOpeningCheck[],
  contours: PlanPageContours,
  labels: OpeningLabel[],
  verify: ReturnType<typeof createPdfOpeningSpanVerifier>,
): PlanPageOpeningCheck[] {
  if (planPageFeaturesIssue(contours, { checkRoomOverlap: true })) return result
  const declared = contours.rooms.flatMap((room) =>
    (room.openings ?? []).map((opening) => ({ room, opening })),
  )
  const byCut = new Map<string, typeof declared>()
  for (const entry of declared) {
    const key = cutKey(entry.opening)
    const peers = byCut.get(key) ?? []
    peers.push(entry)
    byCut.set(key, peers)
  }
  return result.map((check) => {
    if (check.status !== 'unresolved' || check.reason !== 'no-connected-opening-dimension')
      return check
    const target = declared.find(
      ({ room, opening }) =>
        pdfContourKey(room) === pdfContourKey(check) && opening.id === check.openingId,
    )
    if (target?.opening.kind !== 'door') return check
    const peers = byCut.get(cutKey(target.opening))
    if (peers?.length !== 2) return check
    const donor = peers.find(({ room }) => pdfContourKey(room) !== pdfContourKey(target.room))
    if (!donor) return check
    const evidence = result.find(
      (candidate) =>
        candidate.status === 'candidate' &&
        pdfContourKey(candidate) === pdfContourKey(donor.room) &&
        candidate.openingId === donor.opening.id,
    )
    if (evidence?.status !== 'candidate') return check
    const label = labels.find((item) => item.index === evidence.labelIndex)
    if (!label) return check
    const opposite = verify(pdfContourIdentity(target.room), label, target.opening)
    if (opposite.status !== 'unresolved' || opposite.reason !== 'opening-label-outside-room')
      return check
    return {
      ...pdfContourIdentity(target.room),
      openingId: target.opening.id,
      status: 'candidate',
      widthMm: evidence.widthMm,
      labelIndex: evidence.labelIndex,
      sameOpeningAs: { ...pdfContourIdentity(donor.room), openingId: donor.opening.id },
    }
  })
}

/** Derived from this file's text/vector layer, not from browser-supplied dimensions. */
export function verifyPlanPageOpenings(
  work: PdfLinework,
  source: PdfPlanSource,
  contours: PlanPageContours,
  planText: string | undefined,
): PlanPageOpeningCheck[] {
  const labels = (planMeasurementTextItems(planText) ?? []).flatMap((item, index) =>
    item.x !== undefined && item.y !== undefined && /^\d{1,5}$/.test(item.text)
      ? [{ ...item, index, x: item.x, y: item.y }]
      : [],
  )
  const result: PlanPageOpeningCheck[] = []
  const verify = createPdfOpeningSpanVerifier(work, source, contours)
  for (const room of contours.rooms) {
    for (const opening of room.openings ?? []) {
      const identity = { ...pdfContourIdentity(room), openingId: opening.id }
      const a = room.polygon[opening.wallEdgeIndex]
      const b = room.polygon[(opening.wallEdgeIndex + 1) % room.polygon.length]
      if (!a || !b || (a.x !== b.x && a.y !== b.y)) {
        result.push({ ...identity, status: 'unresolved', reason: 'opening-edge-not-axis-aligned' })
        continue
      }
      const horizontal = a.y === b.y
      const along = horizontal ? 'x' : 'y'
      const low = Math.min(opening.start[along], opening.end[along])
      const high = Math.max(opening.start[along], opening.end[along])
      const possibleLabels = labels.filter((label) => {
        if (label.rotation !== (horizontal ? 0 : 90) || label[along] <= low || label[along] >= high)
          return false
        const boundaryDistance = pdfBoundaryDistance(work, label, room.polygon)
        return pdfPointInside(label, room.polygon) ? boundaryDistance > 0.5 : boundaryDistance <= 50
      })
      if (possibleLabels.length > 8) {
        result.push({ ...identity, status: 'ambiguous', reason: 'too-many-opening-labels' })
        continue
      }
      const bindings = possibleLabels.map((label) =>
        verify(pdfContourIdentity(room), label, opening),
      )
      const candidates = bindings.filter((binding) => binding.status === 'candidate')
      if (candidates.length > 1 || bindings.some((binding) => binding.status === 'ambiguous')) {
        result.push({ ...identity, status: 'ambiguous', reason: 'competing-opening-dimensions' })
      } else if (candidates[0]?.status === 'candidate') {
        result.push({
          ...identity,
          status: 'candidate',
          widthMm: candidates[0].widthMm,
          labelIndex: candidates[0].labelIndex,
        })
      } else {
        result.push({ ...identity, status: 'unresolved', reason: 'no-connected-opening-dimension' })
      }
    }
  }
  return transferOppositeOpeningWidths(result, contours, labels, verify)
}
