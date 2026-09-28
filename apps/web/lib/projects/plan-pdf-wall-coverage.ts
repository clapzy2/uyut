import type { PlanPageContours } from '@uyut/db'
import { planPageContoursSchema } from './plan-page-review'
import type { PagePoint } from './plan-pdf-linework'
import { pdfContourKey } from './plan-pdf-room-binding'
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

/** Diagnostics only: source-backed local pairs do not certify a complete physical wall model. */
export function classifyPlanPageWallSpans(
  contours: PlanPageContours,
  pairs: readonly PdfWallFacePair[],
): PdfWallCoverageSpan[] {
  if (!planPageContoursSchema.safeParse(contours).success) return []
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
            openings: [],
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
