import type { PlanPageContours } from '@uyut/db'
import { planPageContoursSchema } from './plan-page-review'
import type { PagePoint } from './plan-pdf-linework'
import { pdfContourKey, pdfPointDistance } from './plan-pdf-room-binding'
import type { PdfWallFacePair } from './plan-pdf-wall-faces'

export type PdfWallCoverageSpan = {
  contourKey: string
  wallEdgeIndex: number
  start: PagePoint
  end: PagePoint
  status:
    | 'paired'
    | 'opening'
    | 'unmatched'
    | 'unpaired-exterior'
    | 'ambiguous'
    | 'unsupported-angle'
    | 'conditional'
}

export type PdfExteriorOpening = {
  wallEdgeIndex: number
  start: PagePoint
  end: PagePoint
}

function pointOnEdge(point: PagePoint, start: PagePoint, end: PagePoint): boolean {
  const cross = (end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x)
  return (
    cross === 0 &&
    point.x >= Math.min(start.x, end.x) &&
    point.x <= Math.max(start.x, end.x) &&
    point.y >= Math.min(start.y, end.y) &&
    point.y <= Math.max(start.y, end.y)
  )
}

/** Review lengths use PDF points, not the independently normalized page axes. */
export function planPageWallReviewQueue(
  contours: PlanPageContours,
  spans: readonly PdfWallCoverageSpan[],
  cmPerPoint: number,
  scope: 'interior' | 'exterior' = 'interior',
): Array<PdfWallCoverageSpan & { lengthCm: number }> {
  if (!Number.isFinite(cmPerPoint) || cmPerPoint <= 0)
    throw new Error('Wall review requires a positive finite PDF scale.')
  return spans
    .filter((span) => {
      if (scope === 'exterior') {
        return (
          span.contourKey === 'exterior' &&
          ['unpaired-exterior', 'unsupported-angle', 'ambiguous'].includes(span.status)
        )
      }
      return (
        span.contourKey !== 'exterior' &&
        ['unmatched', 'unsupported-angle', 'ambiguous'].includes(span.status)
      )
    })
    .map((span) => ({
      ...span,
      lengthCm: pdfPointDistance(contours, span.start, span.end) * cmPerPoint,
    }))
    .sort((a, b) => b.lengthCm - a.lengthCm)
}

/** Diagnostics only: supplied exterior closures must be source-reviewed by the caller.
 * Local pairs and openings do not certify a complete physical wall model.
 */
export function classifyPlanPageWallSpans(
  contours: PlanPageContours,
  pairs: readonly PdfWallFacePair[],
  exteriorOpenings: readonly PdfExteriorOpening[] = [],
): PdfWallCoverageSpan[] {
  if (!planPageContoursSchema.safeParse(contours).success) return []
  if (exteriorOpenings.length > 32 || (exteriorOpenings.length && !contours.exterior)) {
    throw new Error('Exterior opening review requires a bounded exterior contour.')
  }
  for (const opening of exteriorOpenings) {
    const polygon = contours.exterior?.polygon
    const start = polygon?.[opening.wallEdgeIndex]
    const end = polygon?.[(opening.wallEdgeIndex + 1) % polygon.length]
    if (
      !Number.isInteger(opening.wallEdgeIndex) ||
      !start ||
      !end ||
      (opening.start.x === opening.end.x && opening.start.y === opening.end.y) ||
      !pointOnEdge(opening.start, start, end) ||
      !pointOnEdge(opening.end, start, end)
    ) {
      throw new Error('Reviewed exterior opening must lie on one declared boundary edge.')
    }
  }
  const zones = [
    ...contours.rooms.map((room) => ({
      key: pdfContourKey(room),
      polygon: room.polygon,
      openings: room.openings ?? [],
      conditionalEdges: room.conditionalEdges ?? [],
    })),
    ...(contours.exterior
      ? [
          {
            key: 'exterior',
            polygon: contours.exterior.polygon,
            openings: exteriorOpenings,
            conditionalEdges: [],
          },
        ]
      : []),
  ]
  const result: PdfWallCoverageSpan[] = []
  for (const zone of zones) {
    for (const [wallEdgeIndex, start] of zone.polygon.entries()) {
      const end = zone.polygon[(wallEdgeIndex + 1) % zone.polygon.length]
      if (!end) continue
      if (zone.conditionalEdges.some((edge) => edge.wallEdgeIndex === wallEdgeIndex)) {
        result.push({ contourKey: zone.key, wallEdgeIndex, start, end, status: 'conditional' })
        continue
      }
      const slanted = start.x !== end.x && start.y !== end.y
      const along = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y) ? 'x' : 'y'
      const across = along === 'x' ? 'y' : 'x'
      const low = Math.min(start[along], end[along])
      const high = Math.max(start[along], end[along])
      const pointAt = (position: number): PagePoint => {
        const fraction = (position - start[along]) / (end[along] - start[along])
        return {
          x: start.x + (end.x - start.x) * fraction,
          y: start.y + (end.y - start.y) * fraction,
        }
      }
      const openings = zone.openings
        .filter((opening) => opening.wallEdgeIndex === wallEdgeIndex)
        .map((opening): [number, number] => [
          Math.min(opening.start[along], opening.end[along]),
          Math.max(opening.start[along], opening.end[along]),
        ])
      const matched = pairs.flatMap((pair) =>
        pair.faces
          .filter((face) => face.contourKey === zone.key && face.wallEdgeIndex === wallEdgeIndex)
          .map((face): [number, number] => [
            Math.min(face.start[along], face.end[along]),
            Math.max(face.start[along], face.end[along]),
          ]),
      )
      const cuts = [...new Set([low, high, ...openings.flat(), ...matched.flat()])]
        .filter((value) => value >= low && value <= high)
        .sort((a, b) => a - b)
      for (let index = 1; index < cuts.length; index++) {
        const begin = cuts[index - 1]
        const finish = cuts[index]
        if (begin === undefined || finish === undefined || begin === finish) continue
        const midpoint = (begin + finish) / 2
        const openCount = openings.filter(([a, b]) => a <= midpoint && midpoint < b).length
        const pairCount = matched.filter(([a, b]) => a <= midpoint && midpoint < b).length
        const missingStatus = slanted
          ? 'unsupported-angle'
          : zone.key === 'exterior'
            ? 'unpaired-exterior'
            : 'unmatched'
        const status =
          openCount + pairCount > 1
            ? 'ambiguous'
            : openCount === 1
              ? 'opening'
              : pairCount === 1
                ? 'paired'
                : missingStatus
        result.push({
          contourKey: zone.key,
          wallEdgeIndex,
          start: slanted
            ? pointAt(begin)
            : ({ [along]: begin, [across]: start[across] } as PagePoint),
          end: slanted
            ? pointAt(finish)
            : ({ [along]: finish, [across]: start[across] } as PagePoint),
          status,
        })
      }
    }
  }
  return result
}
