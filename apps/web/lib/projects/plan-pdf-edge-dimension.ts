import type { PlanPageDimensionEdge, PlanPageRoomIdentity, PlanPageSegmentRef } from '@uyut/db'
import { planPageFeaturesIssue, polygonsOverlap, segmentEntersPolygon } from './plan-page-review'
import {
  nativeDimensionMillimetres,
  type PdfNativePageDimensionChain,
  pdfNativePageDimensionChain,
} from './plan-pdf-dimension-chain'
import type { PagePoint, PdfLinework } from './plan-pdf-linework'
import { type NativePageSegment, nativePageSegments } from './plan-pdf-opening-endpoint'
import {
  type PdfPlanSource,
  type PdfRoomContours,
  pdfContourIdentity,
  pdfContourIssue,
  pdfContourKey,
  pdfPointDistance,
} from './plan-pdf-room-binding'

export type PdfEdgeDimension =
  | (Extract<PdfNativePageDimensionChain, { status: 'candidate' }> &
      PlanPageRoomIdentity & {
        wallEdgeIndex: number
        sourceEdge: [PagePoint, PagePoint]
        wallRef: PlanPageSegmentRef
        endpointRefs: [PlanPageSegmentRef, PlanPageSegmentRef]
      })
  | { status: 'unresolved' | 'ambiguous'; reason: string }

const ref = ({
  operationIndex,
  subpathIndex,
  segmentIndex,
}: NativePageSegment): PlanPageSegmentRef => ({ operationIndex, subpathIndex, segmentIndex })

/** Строгая связь всей физической грани с цепью: без продления и подгонки координат. */
export function pdfDimensionForEdge(
  work: PdfLinework,
  source: PdfPlanSource,
  contours: PdfRoomContours,
  identity: PlanPageRoomIdentity,
  annotation: PlanPageDimensionEdge,
  labels: Parameters<typeof pdfNativePageDimensionChain>[2],
): PdfEdgeDimension {
  const fail = (
    reason: string,
    status: 'unresolved' | 'ambiguous' = 'unresolved',
  ): PdfEdgeDimension => ({ status, reason })
  const issue =
    pdfContourIssue(work, source, contours) ??
    planPageFeaturesIssue(contours, { checkRoomOverlap: true })
  if (issue) return fail(issue)
  if (work.clippedPaths > 0) return fail('clipped-edge-evidence')
  const room = contours.rooms.find((item) => pdfContourKey(item) === pdfContourKey(identity))
  if (!room) return fail('no-annotated-room')
  if (!Number.isSafeInteger(annotation.wallEdgeIndex) || annotation.wallEdgeIndex < 0)
    return fail('invalid-dimension-edge')
  const a = room.polygon[annotation.wallEdgeIndex]
  const b = room.polygon[(annotation.wallEdgeIndex + 1) % room.polygon.length]
  if (!a || !b) return fail('invalid-dimension-edge')
  if (room.conditionalEdges?.some((edge) => edge.wallEdgeIndex === annotation.wallEdgeIndex))
    return fail('dimension-edge-not-physical-wall')
  if (room.openings?.some((opening) => opening.wallEdgeIndex === annotation.wallEdgeIndex))
    return fail('dimension-edge-has-opening')
  if (
    annotation.labelIndexes.length !== labels.length ||
    new Set(annotation.labelIndexes).size !== labels.length ||
    labels.some((label) => !annotation.labelIndexes.includes(label.index))
  )
    return fail('different-dimension-labels')
  // Читаем только целые миллиметры из подписей; клиент не передаёт длину.
  if (labels.some((label) => nativeDimensionMillimetres(label.text) === undefined))
    return fail('invalid-dimension-labels')
  const totalMm = labels.reduce(
    (sum, label) => sum + (nativeDimensionMillimetres(label.text) ?? 0),
    0,
  )
  const chain = pdfNativePageDimensionChain(work, source, labels, totalMm, 'aligned')
  if (chain.status !== 'candidate') return chain
  const physical = (p: PagePoint) => ({
    x: (p.x * work.pageWidth) / 1000,
    y: (p.y * work.pageHeight) / 1000,
  })
  const start = physical(chain.ends[0])
  const end = physical(chain.ends[1])
  const length = Math.hypot(end.x - start.x, end.y - start.y)
  if (length === 0) return fail('invalid-dimension-edge')
  const direction = { x: (end.x - start.x) / length, y: (end.y - start.y) / length }
  const project = (p: PagePoint) => {
    const point = physical(p)
    const dx = point.x - start.x
    const dy = point.y - start.y
    return {
      along: dx * direction.x + dy * direction.y,
      across: -dx * direction.y + dy * direction.x,
    }
  }
  const ordered = [a, b].sort((left, right) => project(left).along - project(right).along) as [
    PagePoint,
    PagePoint,
  ]
  const low = project(ordered[0])
  const high = project(ordered[1])
  if (
    Math.abs(low.along) > 0.12 ||
    Math.abs(high.along - length) > 0.12 ||
    Math.abs(low.across - high.across) > 0.12
  )
    return fail('dimension-does-not-span-declared-edge')
  if (Math.abs(low.across) <= 0.12) return fail('dimension-line-coincides-with-wall')
  const segments = nativePageSegments(work)
  const nativePoints = new Set(
    work.paths.flatMap((path) => path.points.map((point) => `${point.x}:${point.y}`)),
  )
  if (![a, b].every((point) => nativePoints.has(`${point.x}:${point.y}`)))
    return fail('non-native-dimension-edge-vertex')
  // Нативные вершины не доказывают непрерывную стену между ними.
  const wallSegments = segments.filter(
    (segment) =>
      (pdfPointDistance(work, segment.start, a) <= 0.12 &&
        pdfPointDistance(work, segment.end, b) <= 0.12) ||
      (pdfPointDistance(work, segment.start, b) <= 0.12 &&
        pdfPointDistance(work, segment.end, a) <= 0.12),
  )
  if (wallSegments.length !== 1 || !wallSegments[0])
    return fail(
      wallSegments.length > 1 ? 'multiple-native-wall-edges' : 'no-continuous-native-wall-edge',
      wallSegments.length > 1 ? 'ambiguous' : 'unresolved',
    )
  // A real perpendicular wall stroke can connect a dimension tip to the corner too.
  // These refs prove bounded geometric connections, not the drafting role of each stroke.
  const connections: NativePageSegment[] = []
  for (const [index, point] of ordered.entries()) {
    const wall = project(point)
    const tip = project(chain.ends[index] as PagePoint)
    // A perpendicular wall can be a witness only on its uninterrupted portion.
    // Do not connect through a door/window already marked on a neighbouring edge.
    const blockedConnection = contours.rooms.some((contour) =>
      (contour.openings ?? []).some((opening) => {
        const first = project(opening.start)
        const last = project(opening.end)
        return (
          Math.abs(first.along - wall.along) <= 0.12 &&
          Math.abs(last.along - wall.along) <= 0.12 &&
          Math.min(Math.max(first.across, last.across), Math.max(wall.across, tip.across)) -
            Math.max(Math.min(first.across, last.across), Math.min(wall.across, tip.across)) >
            0.12
        )
      }),
    )
    if (blockedConnection) return fail('endpoint-connection-crosses-opening')
    const matching = segments.filter((segment) => {
      const first = project(segment.start)
      const last = project(segment.end)
      return (
        Math.abs(first.along - wall.along) <= 0.12 &&
        Math.abs(last.along - wall.along) <= 0.12 &&
        Math.abs(first.across - last.across) > 0.12 &&
        [wall.across, tip.across].every(
          (position) =>
            position >= Math.min(first.across, last.across) - 0.12 &&
            position <= Math.max(first.across, last.across) + 0.12,
        )
      )
    })
    if (matching.length !== 1 || !matching[0])
      return fail(
        matching.length > 1
          ? 'multiple-endpoint-connections'
          : 'missing-bounded-endpoint-connection',
        matching.length > 1 ? 'ambiguous' : 'unresolved',
      )
    connections.push(matching[0])
  }
  const strip = [chain.ends[0], chain.ends[1], ordered[1], ordered[0]]
  for (const other of contours.rooms) {
    if (
      other !== room &&
      (polygonsOverlap(strip, other.polygon) ||
        strip.some((p, index) => {
          const next = strip[(index + 1) % strip.length]
          return next && segmentEntersPolygon(p, next, other.polygon)
        }))
    )
      return fail('dimension-crosses-other-room')
    for (let index = 0; index < other.polygon.length; index++) {
      if (other === room && index === annotation.wallEdgeIndex) continue
      const first = other.polygon[index]
      const last = other.polygon[(index + 1) % other.polygon.length]
      if (!first || !last) continue
      const ends = [project(first), project(last)].sort((left, right) => left.along - right.along)
      const [near, far] = ends
      if (
        !near ||
        !far ||
        Math.abs(near.along) > 0.12 ||
        Math.abs(far.along - length) > 0.12 ||
        Math.abs(near.across - far.across) > 0.12
      )
        continue
      if (Math.abs(near.across) <= Math.abs(low.across) + 0.12)
        return fail('competing-dimension-edge', 'ambiguous')
    }
  }
  const firstConnection = connections[0]
  const lastConnection = connections[1]
  if (!firstConnection || !lastConnection) return fail('missing-bounded-endpoint-connection')
  return {
    ...chain,
    ...pdfContourIdentity(room),
    wallEdgeIndex: annotation.wallEdgeIndex,
    sourceEdge: [a, b],
    wallRef: ref(wallSegments[0]),
    endpointRefs: [ref(firstConnection), ref(lastConnection)],
  }
}
