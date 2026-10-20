import type { PlanPageDimensionEdge, PlanPageRoomIdentity, PlanPageSegmentRef } from '@uyut/db'
import { planPageFeaturesIssue, polygonsOverlap, segmentEntersPolygon } from './plan-page-review'
import {
  nativeDimensionMillimetres,
  type PdfNativePageDimensionChain,
  pdfNativePageDimensionChain,
} from './plan-pdf-dimension-chain'
import type { Bounds, PagePoint, PdfLinework } from './plan-pdf-linework'
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
        /** Other source strokes with exactly the same endpoints as the reviewed wall. */
        equivalentWallRefs?: PlanPageSegmentRef[]
        endpointRefs: [PlanPageSegmentRef, PlanPageSegmentRef]
        /** Other source strokes with exactly the same endpoints as a chosen connection. */
        equivalentEndpointRefs?: [PlanPageSegmentRef[], PlanPageSegmentRef[]]
      })
  | { status: 'unresolved' | 'ambiguous'; reason: string }

const ref = ({
  operationIndex,
  subpathIndex,
  segmentIndex,
}: NativePageSegment): PlanPageSegmentRef => ({
  operationIndex,
  subpathIndex,
  segmentIndex,
})

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
  // Пропуски учитываются по рамкам, поэтому их перечень должен быть полным и исправным.
  const brokenOmissions = (items: typeof work.clippedPathBounds) =>
    items?.some(
      ({ operationIndex, bounds }) =>
        !Number.isSafeInteger(operationIndex) ||
        operationIndex < 0 ||
        !bounds ||
        ![bounds.left, bounds.top, bounds.right, bounds.bottom].every(Number.isFinite) ||
        bounds.left > bounds.right ||
        bounds.top > bounds.bottom,
    )
  if (
    work.clippedPathBoundsTruncated ||
    (work.clippedPathBounds?.length ?? 0) !== work.clippedPaths ||
    brokenOmissions(work.clippedPathBounds)
  )
    return fail('clipped-edge-evidence')
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
  // Only omissions near this wall, its dimension rail or its two endpoint connections
  // can change the proof. A clipped symbol elsewhere on the sheet cannot.
  //
  // Пропущенный штрих способен подменить доказательство лишь тогда, когда он может
  // вместить его целиком: конкурирующая стена, размерная линия, звено цепи или
  // выносная линия существует только вместе с обоими своими концами. Рамка, которая
  // накрывает лишь часть грани, не может оказаться такой же гранью, поэтому общий
  // прямоугольник вокруг всего доказательства удерживал грани без причины: на листе
  // Мухановой мелкие обрезанные символы внутри комнаты блокировали все стороны.
  // Подпись — точка, для неё близости по-прежнему достаточно.
  const marginX = (6 * 1000) / work.pageWidth
  const marginY = (6 * 1000) / work.pageHeight
  const covered = (bounds: Bounds, points: readonly PagePoint[]) =>
    points.every(
      (point) =>
        point.x >= bounds.left - marginX &&
        point.x <= bounds.right + marginX &&
        point.y >= bounds.top - marginY &&
        point.y <= bounds.bottom + marginY,
    )
  const impersonations: PagePoint[][] = [
    [a, b],
    [...chain.ends],
    ...chain.segments.map((segment) => [segment.start, segment.end]),
    ...[a, b].flatMap((wallEnd) => chain.ends.map((railEnd) => [wallEnd, railEnd])),
    ...labels.map((label) => [{ x: label.x, y: label.y }]),
  ]
  if (
    work.clippedPathBounds?.some(({ bounds }) =>
      impersonations.some((points) => covered(bounds, points)),
    )
  )
    return fail('clipped-edge-evidence')
  const physical = (p: PagePoint) => ({
    x: (p.x * work.pageWidth) / 1000,
    y: (p.y * work.pageHeight) / 1000,
  })
  const start = physical(chain.ends[0])
  const end = physical(chain.ends[1])
  const length = Math.hypot(end.x - start.x, end.y - start.y)
  if (length === 0) return fail('invalid-dimension-edge')
  const direction = {
    x: (end.x - start.x) / length,
    y: (end.y - start.y) / length,
  }
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
  const wallGroups = new Map<string, NativePageSegment[]>()
  for (const segment of wallSegments) {
    const ends = [segment.start, segment.end].map((point) => `${point.x}:${point.y}`).sort()
    const key = ends.join('|')
    const group = wallGroups.get(key) ?? []
    group.push(segment)
    wallGroups.set(key, group)
  }
  if (wallGroups.size !== 1)
    return fail(
      wallGroups.size > 1 ? 'multiple-native-wall-edges' : 'no-continuous-native-wall-edge',
      wallGroups.size > 1 ? 'ambiguous' : 'unresolved',
    )
  const wallGroup = [...wallGroups.values()][0]
  if (!wallGroup?.length) return fail('no-continuous-native-wall-edge')
  // A review may encounter a thin construction line painted again as a wall.
  // Prefer the strongest intact solid stroke as the primary provenance, while
  // retaining every exact duplicate. Pen weight alone never proves wall role.
  const penWidth = (segment: NativePageSegment) => {
    const path = work.paths.find(
      (item) =>
        item.operationIndex === segment.operationIndex &&
        item.subpathIndex === segment.subpathIndex,
    )
    const ink = path?.strokeInk
    return ink && !ink.refusalReason && ink.dashArray.length === 0 && ink.lineWidth > 0
      ? ink.lineWidth
      : 0
  }
  wallGroup.sort(
    (left, right) =>
      penWidth(right) - penWidth(left) ||
      left.operationIndex - right.operationIndex ||
      left.subpathIndex - right.subpathIndex ||
      left.segmentIndex - right.segmentIndex,
  )
  // A real perpendicular wall stroke can connect a dimension tip to the corner too.
  // These refs prove bounded geometric connections, not the drafting role of each stroke.
  const connections: NativePageSegment[] = []
  const equivalentConnections: [PlanPageSegmentRef[], PlanPageSegmentRef[]] = [[], []]
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
    // A PDF may paint the same physical connector twice in opposite directions.
    // Only identical native endpoints are interchangeable; overlapping or nearby
    // strokes must still leave the measurement ambiguous.
    const connectionGroups = new Map<string, NativePageSegment[]>()
    for (const segment of matching) {
      const ends = [segment.start, segment.end].map((end) => `${end.x}:${end.y}`).sort()
      const key = ends.join('|')
      const group = connectionGroups.get(key) ?? []
      group.push(segment)
      connectionGroups.set(key, group)
    }
    if (connectionGroups.size !== 1)
      return fail(
        connectionGroups.size > 1
          ? 'multiple-endpoint-connections'
          : 'missing-bounded-endpoint-connection',
        connectionGroups.size > 1 ? 'ambiguous' : 'unresolved',
      )
    const group = [...connectionGroups.values()][0]
    if (!group?.[0]) return fail('missing-bounded-endpoint-connection')
    group.sort(
      (left, right) =>
        left.operationIndex - right.operationIndex ||
        left.subpathIndex - right.subpathIndex ||
        left.segmentIndex - right.segmentIndex,
    )
    connections.push(group[0])
    equivalentConnections[index] = group.slice(1).map(ref)
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
  const firstWall = wallGroup[0]
  if (!firstConnection || !lastConnection || !firstWall)
    return fail('missing-bounded-endpoint-connection')
  return {
    ...chain,
    ...pdfContourIdentity(room),
    wallEdgeIndex: annotation.wallEdgeIndex,
    sourceEdge: [a, b],
    wallRef: ref(firstWall),
    ...(wallGroup.length > 1 ? { equivalentWallRefs: wallGroup.slice(1).map(ref) } : {}),
    endpointRefs: [ref(firstConnection), ref(lastConnection)],
    ...(equivalentConnections.some((group) => group.length > 0)
      ? { equivalentEndpointRefs: equivalentConnections }
      : {}),
  }
}
