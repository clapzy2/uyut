import { createHash } from 'node:crypto'
import { parsePlanGeometry, planMeasurementTextItems, validatePlanMeasurement } from '@uyut/ai'
import type {
  PlanGeometry,
  PlanOpeningWidthProof,
  PlanPageContours,
  PlanPoint,
  PlanReading,
  PlanWallFacePair,
} from '@uyut/db'
import { verifyPlanPageOpenings } from './plan-page-feature-checks'
import {
  planPageContoursSchema,
  planPageFeaturesIssue,
  planPageReviewIssue,
} from './plan-page-review'
import { type PdfDimensionChain, pdfDepthChain, pdfWidthChain } from './plan-pdf-dimension-chain'
import { pdfVectorArrow } from './plan-pdf-leaders'
import type { PagePoint, PdfLinework } from './plan-pdf-linework'
import { pairPlanPageOpeningFaces } from './plan-pdf-opening-faces'
import {
  type PdfPlanSource,
  pdfContourKey,
  pdfContourRoomNumbers,
  pdfPointDistance,
} from './plan-pdf-room-binding'
import { pairPlanPageWallFaces } from './plan-pdf-wall-faces'

type Context = {
  source: PdfPlanSource
  linework: PdfLinework
  planText?: string
  contours: PlanPageContours
  /** Explicit anchors for one page-wide scale; absent keeps the legacy strict path. */
  calibrationRoomNumbers?: number[]
}
type Result = { ok: true; geometry: PlanGeometry } | { ok: false; error: string }
type Candidate = Extract<PdfDimensionChain, { status: 'candidate' }>

/** Stable correspondence between a source annotation and its metric element. */
export function planPageGeometryElementId(
  source: PdfPlanSource,
  room: number | string,
  type: string,
  identity: string | number,
): string {
  return `manual_${createHash('sha256')
    .update(JSON.stringify([source, room, type, identity]))
    .digest('hex')
    .slice(0, 24)}`
}

const roundCm = (value: number) => Math.round(value * 10) / 10
const nameKey = (name: string) => name.trim().toLocaleLowerCase('ru').replaceAll('ё', 'е')
const polygonAreaM2 = (polygon: PlanPoint[]) =>
  Math.abs(
    polygon.reduce((sum, point, index) => {
      const next = polygon[(index + 1) % polygon.length]
      return next ? sum + point.xCm * next.yCm - next.xCm * point.yCm : sum
    }, 0),
  ) / 20_000
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
  const selected = contours.rooms
    .filter((contour) =>
      pdfContourRoomNumbers(contour).some((number) => roomNumbers.includes(number)),
    )
    .sort(
      (left, right) =>
        Math.min(...pdfContourRoomNumbers(left)) - Math.min(...pdfContourRoomNumbers(right)),
    )
  if (
    roomNumbers.some(
      (number) => !selected.some((contour) => pdfContourRoomNumbers(contour).includes(number)),
    ) ||
    selected.some((contour) =>
      pdfContourRoomNumbers(contour).some((number) => {
        const matches = reading.rooms.filter((room) => room.sourceNumber === number)
        const room = matches[0]
        return (
          matches.length !== 1 ||
          !room?.name.trim() ||
          room.name.trim().length > 40 ||
          reading.rooms.filter((other) => nameKey(other.name) === nameKey(room.name)).length !== 1
        )
      }),
    )
  )
    return fail('Каждая выбранная комната должна иметь один номер, уникальное название и контур.')

  const globalCalibration = context.calibrationRoomNumbers !== undefined
  const anchorNumbers = context.calibrationRoomNumbers ?? roomNumbers
  if (
    anchorNumbers.length < 1 ||
    anchorNumbers.length > 12 ||
    new Set(anchorNumbers).size !== anchorNumbers.length ||
    anchorNumbers.some(
      (number) =>
        !Number.isSafeInteger(number) ||
        !contours.rooms.some((contour) => contour.roomSourceNumber === number),
    )
  )
    return fail('Для общего масштаба выберите отдельную комнату с двумя подписанными цепочками.')

  const textItems = planMeasurementTextItems(context.planText)
  if (!textItems) return fail('Для масштаба нужны подписи размеров из текстового слоя этого PDF.')
  if (!chainWorkIsBounded(linework))
    return fail(
      'Размерный слой содержит слишком много конкурирующих стрелок. Уточните исходный PDF.',
    )
  const chains: Candidate[] = []
  const usedLabels = new Set<number>()
  for (const number of anchorNumbers) {
    const room = reading.rooms.find((room) => room.sourceNumber === number)
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

  const points = [
    ...selected.flatMap((contour) => contour.polygon),
    ...(globalCalibration ? (contours.exterior?.polygon ?? []) : []),
    ...(globalCalibration ? (contours.voids?.flatMap((item) => item.polygon) ?? []) : []),
  ]
  const origin = {
    x: Math.min(...points.map((point) => point.x)),
    y: Math.min(...points.map((point) => point.y)),
  }
  const convert = (point: PagePoint): PlanPoint => ({
    xCm: roundCm(((point.x - origin.x) * linework.pageWidth * scale) / 1000),
    yCm: roundCm(((point.y - origin.y) * linework.pageHeight * scale) / 1000),
  })
  const id = (room: number | string, type: string, identity: string | number) =>
    planPageGeometryElementId(source, room, type, identity)
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
  const derivedOpeningIds: string[] = []
  const openingCuts = new Map<string, [PlanPoint, PlanPoint]>()
  const areaWarnings: string[] = []
  for (const contour of selected) {
    const numbers = pdfContourRoomNumbers(contour)
    const number = pdfContourKey(contour)
    const names = numbers.map((number) =>
      reading.rooms.find((room) => room.sourceNumber === number)?.name.trim(),
    )
    const name = names.join(' / ')
    if (!name || name.length > 80) return fail('Уточните название общей зоны перед переносом.')
    const polygon = contour.polygon.map(convert)
    geometry.rooms.push({
      name,
      polygon,
      ...(numbers.length === 1 ? { sourceNumber: numbers[0] } : { sourceNumbers: [...numbers] }),
    })
    const printedAreas = numbers.map(
      (sourceNumber) => reading.rooms.find((room) => room.sourceNumber === sourceNumber)?.areaM2,
    )
    if (printedAreas.every((area): area is number => area !== undefined && area > 0)) {
      const printedAreaM2 = printedAreas.reduce((sum, area) => sum + area, 0)
      const contourAreaM2 = polygonAreaM2(polygon)
      if (Math.abs(contourAreaM2 - printedAreaM2) > Math.max(0.1, printedAreaM2 * 0.02)) {
        areaWarnings.push(
          `${name}: площадь по контуру ${contourAreaM2.toFixed(2)} м², на плане ${printedAreaM2.toFixed(2)} м². Сверьте границы помещения.`,
        )
      }
    }
    polygon.forEach((start, index) => {
      const end = polygon[(index + 1) % polygon.length]
      if (end && !contour.conditionalEdges?.some((edge) => edge.wallEdgeIndex === index)) {
        geometry.walls.push({ id: id(number, 'wall', index), start, end, kind: 'inner' })
      }
    })
    for (const opening of contour.openings ?? []) {
      const check = checks.find(
        (item) => pdfContourKey(item) === number && item.openingId === opening.id,
      )
      const printedWidth = check?.status === 'candidate'
      if (
        printedWidth &&
        !agrees(pdfPointDistance(linework, opening.start, opening.end), check.widthMm / 10)
      )
        return fail(`Комната ${number}: подписанная ширина проёма расходится с общим масштабом.`)
      if (!printedWidth && !globalCalibration)
        return fail(
          `Комната ${number}: ширина размеченного проёма не подтверждена в общем масштабе.`,
        )
      if (!printedWidth) derivedOpeningIds.push(id(number, 'opening', opening.id))
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
      openingCuts.set(id(number, 'opening', opening.id), [
        convert(opening.start),
        convert(opening.end),
      ])
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
  if (globalCalibration) {
    const exterior = contours.exterior?.polygon.map(convert)
    if (exterior) {
      geometry.footprint = exterior
      // Keep the native face references used by wall-strip proofs. They are not
      // construction centre-lines; the separate footprint owns floor containment.
      exterior.forEach((start, index) => {
        const end = exterior[(index + 1) % exterior.length]
        if (end)
          geometry.walls.push({ id: id('exterior', 'wall', index), start, end, kind: 'outer' })
      })
    }
    if (contours.voids?.length) {
      geometry.voids = contours.voids.map((item) => ({
        id: item.id,
        polygon: item.polygon.map(convert),
      }))
    }
    geometry.pdfCalibration = {
      sourceSha256: source.sha256,
      pdfPage: source.pdfPage,
      cmPerPoint: scale,
      origin,
      anchorRoomNumbers: [...anchorNumbers],
      labelIndexes: [...usedLabels].sort((a, b) => a - b),
      derivedOpeningIds,
      openingWidthProofs: checks.flatMap((check): PlanOpeningWidthProof[] => {
        if (check.status !== 'candidate') return []
        const opening = geometry.openings.find(
          (item) => item.id === id(pdfContourKey(check), 'opening', check.openingId),
        )
        const wall = geometry.walls.find((item) => item.id === opening?.wallId)
        const sameOpeningAs = check.sameOpeningAs
        const opposite = sameOpeningAs
          ? geometry.openings.find(
              (item) =>
                item.id === id(pdfContourKey(sameOpeningAs), 'opening', sameOpeningAs.openingId),
            )
          : undefined
        const oppositeWall = geometry.walls.find((item) => item.id === opposite?.wallId)
        return opening && wall
          ? [
              {
                opening: structuredClone(opening),
                wall: structuredClone(wall),
                cut: structuredClone(openingCuts.get(opening.id)),
                labelIndex: check.labelIndex,
                ...(check.sameOpeningAs ? { sameOpeningAs: check.sameOpeningAs } : {}),
                ...(opposite && oppositeWall
                  ? {
                      oppositeBinding: structuredClone({
                        opening: opposite,
                        wall: oppositeWall,
                        cut: openingCuts.get(opposite.id),
                      }),
                    }
                  : {}),
              },
            ]
          : []
      }),
      openingFacePairs: pairPlanPageOpeningFaces(linework, source, contours).flatMap((pair) => {
        const bindings = pair.openings.flatMap((ref) => {
          const opening = geometry.openings.find(
            (item) => item.id === id(pdfContourKey(ref), 'opening', ref.openingId),
          )
          const wall = geometry.walls.find((item) => item.id === opening?.wallId)
          return opening && wall
            ? [structuredClone({ opening, wall, cut: openingCuts.get(opening.id) })]
            : []
        })
        if (bindings.length !== 2 || !bindings[0] || !bindings[1]) return []
        const refs = pair.jambs.map(
          ({ operationIndex, subpathIndex, segmentIndex, strokeSegment }) => ({
            operationIndex,
            subpathIndex,
            segmentIndex,
            ...(strokeSegment ? { strokeSegment } : {}),
          }),
        )
        if (!refs[0] || !refs[1]) return []
        return [{ bindings: [bindings[0], bindings[1]], jambs: [refs[0], refs[1]] }]
      }),
      wallFacePairs: pairPlanPageWallFaces(linework, source, contours).flatMap((pair) => {
        const faces = pair.faces.flatMap((face) => {
          const wall = geometry.walls.find(
            (item) => item.id === id(face.contourKey, 'wall', face.wallEdgeIndex),
          )
          return wall
            ? [
                {
                  wall: structuredClone(wall),
                  start: convert(face.start),
                  end: convert(face.end),
                  nativeSegment: face.nativeSegment,
                  ...(face.strokeSegment ? { strokeSegment: face.strokeSegment } : {}),
                },
              ]
            : []
        })
        if (!faces[0] || !faces[1]) return []
        const saved: PlanWallFacePair = {
          faces: [faces[0], faces[1]],
          openings: structuredClone(
            geometry.openings.filter((opening) =>
              faces.some((face) => face.wall.id === opening.wallId),
            ),
          ),
        }
        return [saved]
      }),
      wallFaceRoomPolygons: structuredClone(geometry.rooms.map((room) => room.polygon)),
    }
    geometry.pdfCalibration.sourceWallFacePairs = structuredClone(
      geometry.pdfCalibration.wallFacePairs ?? [],
    )
    geometry.pdfCalibration.sourceOpeningFacePairs = structuredClone(
      geometry.pdfCalibration.openingFacePairs ?? [],
    )
    geometry.warnings = [
      'Координаты черновика перенесены из нативных линий PDF в едином масштабе. Подписанные мерки комнат сохранены отдельно и не заменены габаритами контуров.',
      ...(contours.exterior ? [] : ['Дополните внешний контур квартиры.']),
      ...(derivedOpeningIds.length
        ? [
            'Часть ширин проёмов перенесена по масштабу линий, без отдельной подписанной мерки. Подтвердите их обмером перед расстановкой.',
          ]
        : []),
      'Сверьте все проёмы, неподвижные объекты, открывание дверей и высоты подоконников перед подтверждением. Неразмеченные элементы автоматически не добавляются.',
    ]
  }
  geometry.warnings.push(...areaWarnings)
  if (contours.voids?.length) {
    geometry.warnings.push(
      globalCalibration
        ? 'Технические пустоты перенесены как исходные многоугольники. Сверьте их на обмерном плане перед подтверждением.'
        : 'Технические пустоты сохранены в разметке исходного листа, но для метрического переноса требуется общий масштаб.',
    )
  }
  if (selected.some((room) => room.conditionalEdges?.length)) {
    geometry.warnings.push(
      'Условные границы открытых зон показывают разделение площадей, но не являются стенами. Сверьте их положение на исходном плане перед расстановкой.',
    )
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
  const checked = parsePlanGeometry(
    {
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
    },
    { allowFullSpanOpenings: true },
  )
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
