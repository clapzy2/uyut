import {
  compareDecimalSums,
  cross,
  dot,
  integerPoints,
  onIntegerSegment,
  vector,
} from '@uyut/catalog/plan-exact-geometry'
import {
  currentOpeningFacePairs,
  currentWallFacePairs,
} from '@uyut/catalog/plan-opening-face-pairs'
import {
  inspectPlanThresholdSurfaces,
  planOpeningEndpoints,
} from '@uyut/catalog/plan-threshold-geometry'
import {
  signedPlanFloors,
  verticalReferenceReviewKey,
} from '@uyut/catalog/plan-vertical-floor-geometry'
import type { PlanGeometry, PlanOpeningFacePair, PlanPoint, PlanWall } from '@uyut/db'
import type { Polygon } from 'polygon-clipping'
import { enclosingTurnBounds } from './plan-transfer-enclosure'
import { inspectPlanVerticalDimensions } from './plan-vertical-dimensions'

export type TransferWallOpening = {
  polygon: Polygon
  openingIds: string[]
  bottomTerms: number[][]
  topTerms: number[][]
  thresholdElevationCm?: number
}
export type TransferWallSolids = {
  error?: string
  solids: Polygon[]
  openings: TransferWallOpening[]
}
/** Internal, current raw source gate backed by a separately acknowledged exterior survey. */
export type ExteriorOpeningWitness = {
  pair: PlanOpeningFacePair
  geometryKey: string
  referenceKey: string
  outerOpeningId: string
  outerBottomElevationCm: number
  outerTopElevationCm: number
  thresholdElevationCm: number
}
type Interval = { start: PlanPoint; end: PlanPoint }
const body = (points: PlanPoint[]): Polygon => [points.map(({ xCm, yCm }) => [xCm, yCm])]

/** Source faces enclose an actual strip, never a thickness inferred around one face. */
function stripPolygon(first: Interval, second: Interval): Polygon | undefined {
  const [a, b, c, d] = integerPoints([first.start, first.end, second.start, second.end])
  if (!a || !b || !c || !d) return undefined
  const along = vector(a, b)
  const opposite = vector(c, d)
  if (dot(along, along) === 0n || dot(opposite, opposite) === 0n || cross(along, opposite) !== 0n)
    return undefined
  const reversed = dot(along, opposite) < 0n
  const ring = [a, b, reversed ? c : d, reversed ? d : c]
  const turns = ring.map((point, index) => {
    const next = ring[(index + 1) % 4]
    const after = ring[(index + 2) % 4]
    if (!next || !after) throw new Error('Incomplete wall strip')
    return cross(vector(point, next), vector(next, after))
  })
  if (!turns.every((turn) => turn > 0n) && !turns.every((turn) => turn < 0n)) return undefined
  return body([
    first.start,
    first.end,
    reversed ? second.start : second.end,
    reversed ? second.end : second.start,
  ])
}

function coveredHost(wall: PlanWall, intervals: Interval[]): boolean {
  const [a, b, ...points] = integerPoints([
    wall.start,
    wall.end,
    ...intervals.flatMap(({ start, end }) => [start, end]),
  ])
  if (!a || !b || !points.every((point) => onIntegerSegment(point, a, b))) return false
  const direction = vector(a, b)
  const lengthSquared = dot(direction, direction)
  const spans = intervals.map((_interval, index) => {
    const start = points[index * 2]
    const end = points[index * 2 + 1]
    if (!start || !end) throw new Error('Incomplete wall interval')
    const first = dot(vector(a, start), direction)
    const second = dot(vector(a, end), direction)
    return first < second ? { low: first, high: second } : { low: second, high: first }
  })
  spans.sort((first, second) => (first.low < second.low ? -1 : first.low > second.low ? 1 : 0))
  let end = 0n
  for (const span of spans) {
    if (span.low > end || span.low === span.high) return false
    if (span.high > end) end = span.high
  }
  return lengthSquared > 0n && end === lengthSquared
}

/** Full-height wall occupancy plus separately gated source openings. Unknown means blocked. */
export function inspectTransferWallSolids(
  geometry: PlanGeometry,
  exterior?: ExteriorOpeningWitness,
): TransferWallSolids {
  const fail = (error: string): TransferWallSolids => ({ error, solids: [], openings: [] })
  try {
    const calibration = geometry.pdfCalibration
    if (
      geometry.walls.length > 200 ||
      geometry.openings.length > 200 ||
      geometry.rooms.length > 100 ||
      (calibration?.sourceWallFacePairs ?? calibration?.wallFacePairs ?? []).length > 2000 ||
      (calibration?.sourceOpeningFacePairs ?? calibration?.openingFacePairs ?? []).length > 200 ||
      (calibration?.openingFacePairs ?? []).length > 200
    )
      return fail('Превышен ограниченный объём проверки исходных стен и косяков.')
    if (
      new Set(geometry.walls.map((wall) => wall.id)).size !== geometry.walls.length ||
      new Set(geometry.openings.map((opening) => opening.id)).size !== geometry.openings.length ||
      geometry.walls.some(
        ({ start, end }) =>
          !start ||
          !end ||
          ![start.xCm, start.yCm, end.xCm, end.yCm].every(Number.isFinite) ||
          (start.xCm === end.xCm && start.yCm === end.yCm),
      )
    )
      return fail('Не подтверждены однозначные стены и их конечные координаты.')
    const verticalIssue = inspectPlanVerticalDimensions(geometry)[0]
    if (verticalIssue) return fail(verticalIssue.message)
    const solids: Polygon[] = []
    if (!calibration) {
      for (const wall of geometry.walls) {
        const thickness = wall.measuredThicknessCm
        if (
          thickness === undefined ||
          !Number.isFinite(thickness) ||
          thickness <= 0 ||
          thickness > 100
        )
          return fail('Физическая толщина и ось каждой стены должны быть отдельно сверены.')
        const first = enclosingTurnBounds(wall.start, thickness, 0, thickness)
        const last = enclosingTurnBounds(wall.end, thickness, 0, thickness)
        if (!first || !last) return fail('Не удалось оградить физический габарит стены.')
        const left = Math.min(first[0], last[0])
        const top = Math.min(first[1], last[1])
        const right = Math.max(first[2], last[2])
        const bottom = Math.max(first[3], last[3])
        solids.push(
          body([
            { xCm: left, yCm: top },
            { xCm: right, yCm: top },
            { xCm: right, yCm: bottom },
            { xCm: left, yCm: bottom },
          ]),
        )
      }
      // Axis openings stay closed: no physical jamb geometry is invented here.
      return { solids, openings: [] }
    }
    const sourceStrips = calibration.sourceWallFacePairs ?? calibration.wallFacePairs ?? []
    const strips = currentWallFacePairs(geometry)
    const pairs = currentOpeningFacePairs(geometry)
    const sourcePairs = calibration.sourceOpeningFacePairs ?? calibration.openingFacePairs ?? []
    if (exterior) {
      const signed = signedPlanFloors(geometry)
      const raw = currentOpeningFacePairs({
        ...geometry,
        pdfCalibration: { ...calibration, openingFacePairs: sourcePairs },
      })
      const currentCuts = raw.every(({ bindings }) =>
        bindings.every(({ opening, cut }) => {
          const ends = planOpeningEndpoints(geometry, opening.id)
          return (
            ends &&
            cut &&
            [ends, [ends[1], ends[0]]].some((candidate) =>
              cut.every(
                (point, index) =>
                  point.xCm === candidate[index]?.xCm && point.yCm === candidate[index]?.yCm,
              ),
            )
          )
        }),
      )
      const projectedInSource = pairs.every((projected) =>
        raw.some((source) =>
          projected.bindings.every(({ opening }) =>
            source.bindings.some((binding) => binding.opening.id === opening.id),
          ),
        ),
      )
      if (
        !signed?.ok ||
        exterior.geometryKey !== JSON.stringify(geometry) ||
        exterior.referenceKey !== verticalReferenceReviewKey(signed.reference) ||
        !raw.includes(exterior.pair) ||
        raw.length !== sourcePairs.length ||
        !currentCuts ||
        !projectedInSource ||
        !exterior.pair.bindings.some(({ opening }) => opening.id === exterior.outerOpeningId) ||
        ![
          exterior.outerBottomElevationCm,
          exterior.outerTopElevationCm,
          exterior.thresholdElevationCm,
        ].every(Number.isFinite) ||
        exterior.outerTopElevationCm <= exterior.outerBottomElevationCm
      )
        return fail('Наружная пара косяков не подтверждена текущим обмером и исходными связями.')
      if (!pairs.includes(exterior.pair)) pairs.push(exterior.pair)
    }
    if (strips.length !== sourceStrips.length || pairs.length !== sourcePairs.length)
      return fail('Грани стен или косяков PDF изменились; нужна повторная сверка исходных связей.')
    const intervals = new Map(geometry.walls.map((wall) => [wall.id, [] as Interval[]]))
    const addInterval = (wallId: string, interval: Interval) => {
      const host = intervals.get(wallId)
      if (!host) throw new Error('Missing source wall host')
      host.push(interval)
    }
    for (const pair of strips) {
      if (pair.faces[0].wall.id === pair.faces[1].wall.id)
        return fail('Одна грань PDF не образует физическую толщину стены.')
      const polygon = stripPolygon(pair.faces[0], pair.faces[1])
      if (!polygon) return fail('Исходные грани не ограждают однозначную полосу стены.')
      solids.push(polygon)
      for (const face of pair.faces) addInterval(face.wall.id, face)
    }
    const signed = signedPlanFloors(geometry)
    const reference = signed?.ok ? signed.reference : undefined
    const thresholds = inspectPlanThresholdSurfaces(geometry).surfaces
    const openings: TransferWallOpening[] = []
    const used = new Set<string>()
    for (const pair of pairs) {
      const ids = pair.bindings.map((binding) => binding.opening.id)
      if (ids[0] === ids[1] || ids.some((id) => used.has(id)))
        return fail('Связи косяков PDF неоднозначны.')
      const cuts = ids.map((id) => planOpeningEndpoints(geometry, id))
      if (!cuts[0] || !cuts[1]) return fail('Не подтверждены исходные концы обеих сторон проёма.')
      const first = { start: cuts[0][0], end: cuts[0][1] }
      const second = { start: cuts[1][0], end: cuts[1][1] }
      const polygon = stripPolygon(first, second)
      if (!polygon) return fail('Косяки не ограждают однозначный физический переход.')
      pair.bindings.forEach((binding, index) => {
        used.add(binding.opening.id)
        addInterval(binding.wall.id, index === 0 ? first : second)
      })
      const bottomTerms: number[][] = []
      const topTerms: number[][] = []
      for (const binding of pair.bindings) {
        if (exterior?.pair === pair && binding.opening.id === exterior.outerOpeningId) {
          const current = geometry.openings.find(({ id }) => id === binding.opening.id)
          const base = reference?.wallBases.find(({ wall }) => wall.id === binding.wall.id)
          const floor = reference?.floors.find(({ id }) => id === base?.floorId)
          if (
            !current ||
            !floor ||
            current.bottomCm === undefined ||
            current.heightCm === undefined ||
            compareDecimalSums(
              [exterior.outerBottomElevationCm],
              [floor.elevationCm, current.bottomCm],
            ) < 0 ||
            compareDecimalSums(
              [exterior.outerTopElevationCm],
              [floor.elevationCm, current.bottomCm, current.heightCm],
            ) > 0
          )
            return fail('Наружные отметки не могут ослаблять уже сверенные границы проёма.')
          bottomTerms.push([exterior.outerBottomElevationCm])
          topTerms.push([exterior.outerTopElevationCm])
          continue
        }
        const opening = geometry.openings.find((value) => value.id === binding.opening.id)
        const base = reference?.wallBases.find((value) => value.wall.id === binding.wall.id)
        const floor = reference?.floors.find((value) => value.id === base?.floorId)
        if (
          !opening ||
          floor?.surface !== 'finished-floor' ||
          opening.bottomCm === undefined ||
          !Number.isFinite(opening.bottomCm) ||
          opening.bottomCm < 0 ||
          opening.heightCm === undefined ||
          !Number.isFinite(opening.heightCm) ||
          opening.heightCm <= 0
        )
          continue
        bottomTerms.push([floor.elevationCm, opening.bottomCm])
        topTerms.push([floor.elevationCm, opening.bottomCm, opening.heightCm])
      }
      const thresholdOwner = reference?.thresholds.find(
        (value) =>
          value.bindings.length === 2 &&
          value.bindings.every((side) => ids.includes(side.opening.id)),
      )
      const threshold = thresholds.find((value) => value.id === thresholdOwner?.id)
      openings.push({
        polygon,
        openingIds: ids,
        bottomTerms: bottomTerms.length === 2 ? bottomTerms : [],
        topTerms: topTerms.length === 2 ? topTerms : [],
        ...(exterior?.pair === pair
          ? {
              thresholdElevationCm: Math.max(
                exterior.thresholdElevationCm,
                threshold?.elevationCm ?? -Infinity,
              ),
            }
          : threshold
            ? { thresholdElevationCm: threshold.elevationCm }
            : {}),
      })
    }
    if (geometry.walls.some((wall) => !coveredHost(wall, intervals.get(wall.id) ?? [])))
      return fail(
        'Не все исходные грани PDF полностью покрыты подтверждёнными полосами стен и косяками. Неизвестная толщина не заменяется линией.',
      )
    return { solids, openings }
  } catch {
    return fail('Не удалось подтвердить полный физический контур стен и проёмов.')
  }
}
