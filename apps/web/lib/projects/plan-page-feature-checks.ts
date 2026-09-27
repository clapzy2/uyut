import { planMeasurementTextItems } from '@uyut/ai'
import type { PlanPageContours, PlanPageOpeningCheck } from '@uyut/db'
import { createPdfOpeningSpanVerifier } from './plan-pdf-dimension-chain'
import type { PdfLinework } from './plan-pdf-linework'
import {
  type PdfPlanSource,
  pdfBoundaryDistance,
  pdfContourIdentity,
  pdfPointInside,
} from './plan-pdf-room-binding'

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
      const possibleLabels = labels.filter(
        (label) =>
          label.rotation === (horizontal ? 0 : 90) &&
          label[along] > low &&
          label[along] < high &&
          pdfPointInside(label, room.polygon) &&
          pdfBoundaryDistance(work, label, room.polygon) > 0.5,
      )
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
  return result
}
