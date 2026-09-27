import { createHash } from 'node:crypto'
import { parsePlanGeometry, planMeasurementTextItems, validatePlanMeasurement } from '@uyut/ai'
import type { PlanGeometry, PlanPageContours, PlanPoint, PlanReading } from '@uyut/db'
import { verifyPlanPageOpenings } from './plan-page-feature-checks'
import {
  planPageContoursSchema,
  planPageFeaturesIssue,
  planPageReviewIssue,
} from './plan-page-review'
import { type PdfDimensionChain, pdfDepthChain, pdfWidthChain } from './plan-pdf-dimension-chain'
import { pdfVectorArrow } from './plan-pdf-leaders'
import type { PagePoint, PdfLinework } from './plan-pdf-linework'
import { type PdfPlanSource, pdfPointDistance } from './plan-pdf-room-binding'

type Context = {
  source: PdfPlanSource
  linework: PdfLinework
  planText?: string
  contours: PlanPageContours
}
type Result = { ok: true; geometry: PlanGeometry } | { ok: false; error: string }
type Candidate = Extract<PdfDimensionChain, { status: 'candidate' }>

const roundCm = (value: number) => Math.round(value * 10) / 10
const nameKey = (name: string) => name.trim().toLocaleLowerCase('ru').replaceAll('ё', 'е')
// Two independently extracted PDF endpoints may differ by 0.12 physical points each.
// This allowance is never a room-specific scale, endpoint correction or fitting budget.
const toleranceCm = (scale: number) => Math.min(0.5, 0.24 * scale + 0.05)

/** Bound the legacy chain verifier before it enumerates compatible arrow pairs. */
function chainWorkIsBounded(work: PdfLinework): boolean {
  if (
    work.paths.length > 3000 ||
    work.paths.reduce((sum, path) => sum + path.points.length, 0) > 20_000
  )
    return false
  const arrows = work.paths.flatMap((path) => {
    const arrow = pdfVectorArrow(work, path)
    return arrow ? [arrow] : []
  })
  let possiblePairs = 0
  for (const along of ['x', 'y'] as const) {
    const across = along === 'x' ? 'y' : 'x'
    const acrossScale = (across === 'x' ? work.pageWidth : work.pageHeight) / 1000
    const axial = arrows.filter(
      (arrow) => Math.abs(arrow.tip[across] - arrow.base[across]) * acrossScale <= 0.12,
    )
    for (const path of work.paths) {
      if (path.closed || path.paint !== 'stroke' || path.points.length !== 2) continue
      const [start, end] = [...path.points].sort((a, b) => a[along] - b[along])
      if (
        !start ||
        !end ||
        start[along] === end[along] ||
        Math.abs(start[across] - end[across]) * acrossScale > 0.12
      )
        continue
      let left = 0
      let right = 0
      for (const arrow of axial) {
        if (arrow.tip[along] < start[along] && pdfPointDistance(work, arrow.base, start) <= 0.12)
          left++
        if (arrow.tip[along] > end[along] && pdfPointDistance(work, arrow.base, end) <= 0.12)
          right++
      }
      possiblePairs += left * right
      if (possiblePairs > 2000) return false
    }
  }
  return true
}

/** A draft from two perpendicular printed chains, not a bounding-box/area estimate. */
export function planPageMetricDraft(
  reading: PlanReading,
  context: Context,
  roomNumbers: number[],
): Result {
  const fail = (error: string): Result => ({ ok: false, error })
  if (
    roomNumbers.length < 1 ||
    roomNumbers.length > 12 ||
    new Set(roomNumbers).size !== roomNumbers.length ||
    roomNumbers.some((number) => !Number.isSafeInteger(number) || number < 1 || number > 50)
  )
    return fail('Выберите от одной до двенадцати разных комнат с номерами исходного плана.')
  const { source, linework, contours } = context
  if (
    source.state !== 'existing' ||
    !planPageContoursSchema.safeParse(contours).success ||
    planPageReviewIssue(contours, reading, source, linework) ||
    planPageFeaturesIssue(contours, { checkRoomOverlap: true })
  )
    return fail('Сверьте разметку с исходным обмерным листом: источник или вершины не совпали.')
  const selected = [...roomNumbers]
    .sort((a, b) => a - b)
    .map((number) => ({
      number,
      contour: contours.rooms.find((room) => room.roomSourceNumber === number),
      room: reading.rooms.find((room) => room.sourceNumber === number),
    }))
  if (
    selected.some(
      ({ contour, room }) =>
        !contour ||
        !room?.name.trim() ||
        room.name.trim().length > 40 ||
        reading.rooms.filter((other) => nameKey(other.name) === nameKey(room.name)).length !== 1,
    )
  )
    return fail('Каждая выбранная комната должна иметь один номер, уникальное название и контур.')

  const textItems = planMeasurementTextItems(context.planText)
  if (!textItems) return fail('Для масштаба нужны подписи размеров из текстового слоя этого PDF.')
  if (!chainWorkIsBounded(linework))
    return fail(
      'Размерный слой содержит слишком много конкурирующих стрелок. Уточните исходный PDF.',
    )
  const chains: Candidate[] = []
  const usedLabels = new Set<number>()
  for (const { number, room } of selected) {
    if (!room) return fail('Комната отсутствует в прочитанном плане.')
    for (const side of ['width', 'depth'] as const) {
      const value = side === 'width' ? room.widthCm : room.depthCm
      if (
        value === undefined ||
        !Number.isFinite(value) ||
        value <= 0 ||
        room.estimated?.includes(side) ||
        room.chainMismatch?.includes(side)
      )
        return fail(
          `Комната ${number}: нужны обе подписанные размерные цепочки, без оценки по площади.`,
        )
      const evidence = validatePlanMeasurement(
        room.measurementEvidence?.[side],
        value * 10,
        side,
        { name: room.name, sourceNumber: number, uniqueName: true },
        textItems,
      )
      const indexes = evidence?.textItemIndexes
      if (!evidence || !indexes || indexes.some((index) => usedLabels.has(index)))
        return fail(`Комната ${number}: проверьте подписи и принадлежность размерных цепочек.`)
      const labels = indexes.flatMap((index) => {
        const label = textItems[index]
        return label && label.x !== undefined && label.y !== undefined
          ? [{ ...label, index, x: label.x, y: label.y }]
          : []
      })
      const check = side === 'width' ? pdfWidthChain : pdfDepthChain
      const chain = check(linework, source, contours, number, labels, value * 10)
      if (
        chain.status !== 'candidate' ||
        chain.segments.length !== evidence.segmentsMm.length ||
        indexes.some(
          (index, position) =>
            chain.segments.find((segment) => segment.labelIndex === index)?.valueMm !==
            evidence.segmentsMm[position],
        )
      )
        return fail(
          `Комната ${number}: подписи не образуют однозначную цепочку между её границами.`,
        )
      for (const index of indexes) usedLabels.add(index)
      chains.push(chain)
    }
  }
  const reference = chains[0]
  if (!reference) return fail('Нет проверенной горизонтальной цепочки для масштаба.')
  const scale = reference.totalMm / 10 / pdfPointDistance(linework, ...reference.ends)
  if (!Number.isFinite(scale) || scale <= 0)
    return fail('Не удалось установить конечный масштаб исходного листа.')
  const agrees = (lengthPt: number, lengthCm: number) =>
    Math.abs(lengthPt * scale - lengthCm) <= toleranceCm(scale)
  if (
    chains.some(
      (chain) =>
        !agrees(pdfPointDistance(linework, ...chain.ends), chain.totalMm / 10) ||
        chain.segments.some(
          (segment) =>
            !agrees(pdfPointDistance(linework, segment.start, segment.end), segment.valueMm / 10),
        ),
    )
  )
    return fail('Размерные цепочки не подтверждают единый масштаб листа. Уточните исходный чертёж.')

  const points = selected.flatMap(({ contour }) => contour?.polygon ?? [])
  const origin = {
    x: Math.min(...points.map((point) => point.x)),
    y: Math.min(...points.map((point) => point.y)),
  }
  const convert = (point: PagePoint): PlanPoint => ({
    xCm: roundCm(((point.x - origin.x) * linework.pageWidth * scale) / 1000),
    yCm: roundCm(((point.y - origin.y) * linework.pageHeight * scale) / 1000),
  })
  const id = (room: number, type: string, identity: string | number) =>
    `manual_${createHash('sha256')
      .update(JSON.stringify([source, room, type, identity]))
      .digest('hex')
      .slice(0, 24)}`
  const geometry: PlanGeometry = {
    version: 1,
    source: 'manual',
    status: 'draft',
    widthCm: Math.max(100, Math.ceil(Math.max(...points.map((point) => convert(point).xCm)))),
    heightCm: Math.max(100, Math.ceil(Math.max(...points.map((point) => convert(point).yCm)))),
    walls: [],
    openings: [],
    obstacles: [],
    rooms: [],
    warnings: [
      'Черновик содержит только выбранные контуры: дополните остальные комнаты, внешний контур и неразмеченные проёмы.',
      'Начало координат — левый верхний угол выбранной разметки, не геодезическая привязка здания.',
      'Масштаб проверен по двум направлениям подписанных цепочек; натурный и чистовой обмер подтверждаются отдельно.',
      'Высота проёмов, подоконники и зоны открывания не назначены: уточните их перед расстановкой.',
    ],
  }
  if (geometry.widthCm > 5000 || geometry.heightCm > 5000)
    return fail('Размер схемы превышает допустимое полотно. Проверьте масштаб и выбранные комнаты.')
  const checks = verifyPlanPageOpenings(linework, source, contours, context.planText)
  for (const { number, contour, room } of selected) {
    if (!contour || !room) return fail('Отсутствует выбранный контур.')
    const polygon = contour.polygon.map(convert)
    geometry.rooms.push({ name: room.name.trim(), sourceNumber: number, polygon })
    polygon.forEach((start, index) => {
      const end = polygon[(index + 1) % polygon.length]
      if (end) geometry.walls.push({ id: id(number, 'wall', index), start, end, kind: 'inner' })
    })
    for (const opening of contour.openings ?? []) {
      const check = checks.find(
        (item) => item.roomSourceNumber === number && item.openingId === opening.id,
      )
      if (
        check?.status !== 'candidate' ||
        !agrees(pdfPointDistance(linework, opening.start, opening.end), check.widthMm / 10)
      )
        return fail(
          `Комната ${number}: ширина размеченного проёма не подтверждена в общем масштабе.`,
        )
      const wallStart = contour.polygon[opening.wallEdgeIndex]
      const wallEnd = contour.polygon[(opening.wallEdgeIndex + 1) % contour.polygon.length]
      if (!wallStart || !wallEnd) return fail('Не найдена стена проёма.')
      const along = wallStart.y === wallEnd.y ? 'x' : 'y'
      const near =
        Math.abs(opening.start[along] - wallStart[along]) <
        Math.abs(opening.end[along] - wallStart[along])
          ? opening.start
          : opening.end
      geometry.openings.push({
        id: id(number, 'opening', opening.id),
        type: opening.kind,
        wallId: id(number, 'wall', opening.wallEdgeIndex),
        offsetCm: roundCm(pdfPointDistance(linework, wallStart, near) * scale),
        widthCm: roundCm(pdfPointDistance(linework, opening.start, opening.end) * scale),
      })
    }
    for (const obstacle of contour.obstacles ?? []) {
      const xs = [...new Set(obstacle.polygon.map((point) => point.x))]
      const ys = [...new Set(obstacle.polygon.map((point) => point.y))]
      if (
        obstacle.polygon.length !== 4 ||
        xs.length !== 2 ||
        ys.length !== 2 ||
        obstacle.polygon.some((point, index) => {
          const next = obstacle.polygon[(index + 1) % obstacle.polygon.length]
          return !next || (point.x !== next.x && point.y !== next.y)
        })
      )
        return fail(
          `Комната ${number}: этот контур препятствия требует многоугольной модели, не прямоугольной замены.`,
        )
      const corner = convert({ x: Math.min(...xs), y: Math.min(...ys) })
      const opposite = convert({ x: Math.max(...xs), y: Math.max(...ys) })
      geometry.obstacles?.push({
        id: id(number, 'obstacle', obstacle.id),
        kind: obstacle.kind,
        ...corner,
        widthCm: roundCm(opposite.xCm - corner.xCm),
        depthCm: roundCm(opposite.yCm - corner.yCm),
      })
    }
  }
  if (
    geometry.walls.length > 200 ||
    geometry.openings.length > 200 ||
    (geometry.obstacles?.length ?? 0) > 100
  )
    return fail('В разметке слишком много объектов для одной схемы.')
  // The existing geometry parser may discard unsupported objects. Refuse the complete
  // draft instead: no room, notch, door or obstacle may disappear during conversion.
  const mmPoint = (point: PlanPoint) => ({ xMm: point.xCm * 10, yMm: point.yCm * 10 })
  const checked = parsePlanGeometry({
    widthMm: geometry.widthCm * 10,
    heightMm: geometry.heightCm * 10,
    walls: geometry.walls.map((wall) => ({
      ...wall,
      start: mmPoint(wall.start),
      end: mmPoint(wall.end),
    })),
    rooms: geometry.rooms.map((room) => ({ ...room, polygon: room.polygon.map(mmPoint) })),
    openings: geometry.openings.map((opening) => ({
      ...opening,
      offsetMm: opening.offsetCm * 10,
      widthMm: opening.widthCm * 10,
    })),
    obstacles: geometry.obstacles?.map((obstacle) => ({
      ...obstacle,
      xMm: obstacle.xCm * 10,
      yMm: obstacle.yCm * 10,
      widthMm: obstacle.widthCm * 10,
      depthMm: obstacle.depthCm * 10,
    })),
  })
  if (
    !checked ||
    checked.warnings.length > 0 ||
    checked.walls.length !== geometry.walls.length ||
    checked.rooms.length !== geometry.rooms.length ||
    checked.openings.length !== geometry.openings.length ||
    checked.obstacles.length !== geometry.obstacles?.length
  )
    return fail(
      'Один из объектов не прошёл проверку 2D-схемы. Разметка сохранена; черновик не создан.',
    )
  return { ok: true, geometry }
}
