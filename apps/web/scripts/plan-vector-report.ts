// Free local vector probe of the existing measurement sheet; never imports an AI client.
// bun run scripts/plan-vector-report.ts <source-pdf>
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import sharp from 'sharp'
import reference from '../../../docs/qa/fixtures/apartment-74-77.json'
import labels from '../../../docs/qa/fixtures/apartment-74-77-native-labels.json'
import nativeLeaders from '../../../docs/qa/fixtures/apartment-74-77-native-leaders.json'
import annotated from '../../../docs/qa/fixtures/apartment-74-77-page-contours.json'
import {
  type PdfOpeningAnnotation,
  pdfDepthChain,
  pdfOpeningFromWidthChain,
  pdfWidthChain,
} from '../lib/projects/plan-pdf-dimension-chain'
import { pdfCalloutLeader } from '../lib/projects/plan-pdf-leaders'
import { extractPdfLinework } from '../lib/projects/plan-pdf-linework'
import {
  type PdfPlanSource,
  type PdfRoomContours,
  pdfRoomAtPoint,
} from '../lib/projects/plan-pdf-room-binding'

const source = process.argv[2]
if (!source || source.startsWith('--')) throw new Error('Укажите исходный обмерный PDF.')
const body = await readFile(resolve(source))
const sha256 = createHash('sha256').update(body).digest('hex')
if (sha256 !== reference.source.sha256) throw new Error('PDF отличается от контрольного источника.')
if (reference.source.state !== 'existing')
  throw new Error('Контрольный лист не является обмером существующего состояния.')
const pageSource: PdfPlanSource = {
  sha256,
  pdfPage: reference.source.pdfPage,
  state: reference.source.state,
}
const loading = pdfjs.getDocument({ data: new Uint8Array(body), disableFontFace: true })
try {
  const document = await loading.promise
  const page = await document.getPage(reference.source.pdfPage)
  const viewport = page.getViewport({ scale: 1 })
  const work = extractPdfLinework(await page.getOperatorList(), pdfjs.OPS, viewport)
  const contours = annotated as PdfRoomContours
  const text = await page.getTextContent()
  const actualLabels = text.items.flatMap((item) => {
    if (!('str' in item) || !item.str.trim()) return []
    const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5])
    return [
      {
        text: item.str.trim(),
        x: Math.round((x / viewport.width) * 1000),
        y: Math.round((y / viewport.height) * 1000),
        rotation: Math.round((Math.atan2(item.transform[1], item.transform[0]) * 180) / Math.PI),
      },
    ]
  })
  for (const expected of labels.items) {
    const actual = actualLabels[expected.index]
    if (
      !actual ||
      actual.text !== expected.text ||
      actual.x !== expected.x ||
      actual.y !== expected.y ||
      actual.rotation !== expected.rotation
    ) {
      throw new Error('Подпись не совпала с нативным эталоном.')
    }
  }
  for (const expected of [...nativeLeaders.paths, ...annotated.dimensionPaths]) {
    const actual = work.paths.find(
      (path) =>
        path.operationIndex === expected.operationIndex &&
        path.subpathIndex === expected.subpathIndex,
    )
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      throw new Error('Векторная фикстура не совпала с исходным PDF.')
  }
  for (const room of annotated.rooms) {
    for (const corner of room.polygon) {
      const found = work.paths.some(
        (path) =>
          room.wallOperations.includes(path.operationIndex) &&
          path.points.some((point) => point.x === corner.x && point.y === corner.y),
      )
      if (!found) throw new Error('Угол ручного контура не совпал с нативной стеной.')
    }
    const label = actualLabels[room.numberLabel.index]
    if (
      !label ||
      label.text !== room.numberLabel.text ||
      label.x !== room.numberLabel.x ||
      label.y !== room.numberLabel.y
    )
      throw new Error('Номер помещения не совпал с исходной подписью.')
    const owner = pdfRoomAtPoint(work, pageSource, contours, label)
    if (owner.status !== 'candidate' || owner.roomSourceNumber !== room.roomSourceNumber)
      throw new Error('Номер не находится внутри соответствующего ручного контура.')
  }
  const callouts = labels.items
    .filter((item) => item.text.includes('натяжной'))
    .map((item) => {
      const leader = pdfCalloutLeader(work, item)
      const roomBinding =
        leader.status === 'candidate'
          ? pdfRoomAtPoint(work, pageSource, contours, leader.arrow.tip)
          : { status: leader.status, roomSourceNumber: null, reason: leader.reason }
      return {
        textItemIndex: item.index,
        text: item.text,
        labelPoint: { x: item.x, y: item.y },
        leader,
        roomBinding,
      }
    })
  const nativeLabels = (indexes: number[]) =>
    indexes.map((index) => {
      const item = actualLabels[index]
      if (!item) throw new Error('Размерная подпись не найдена в PDF.')
      return { index, ...item }
    })
  const widthChains = annotated.rooms.map((room) => {
    const result = pdfWidthChain(
      work,
      pageSource,
      contours,
      room.roomSourceNumber,
      nativeLabels(room.widthLabels),
      room.widthMm,
    )
    if (result.status !== 'candidate')
      throw new Error(
        `Контрольная ширина помещения ${room.roomSourceNumber} не прошла: ${result.reason}`,
      )
    return result
  })
  const depthChains = annotated.rooms.map((room) => {
    const result = pdfDepthChain(
      work,
      pageSource,
      contours,
      room.roomSourceNumber,
      nativeLabels(room.depthLabels),
      room.depthMm,
    )
    if (result.status !== 'candidate')
      throw new Error(
        `Контрольная глубина помещения ${room.roomSourceNumber} не прошла: ${result.reason}`,
      )
    return result
  })
  const openingBindings = annotated.rooms.flatMap((room) =>
    room.openings.map((opening) => {
      const result = pdfOpeningFromWidthChain(
        work,
        pageSource,
        contours,
        room.roomSourceNumber,
        nativeLabels(room.widthLabels),
        room.widthMm,
        opening as PdfOpeningAnnotation,
      )
      if (result.status !== 'candidate')
        throw new Error(
          `Контрольный проём помещения ${room.roomSourceNumber} не прошёл: ${result.reason}`,
        )
      return result
    }),
  )
  for (const [index, expectedRoom] of [
    [186, 4],
    [188, 6],
  ] as const) {
    if (
      callouts.find((item) => item.textItemIndex === index)?.roomBinding.roomSourceNumber !==
      expectedRoom
    )
      throw new Error('Контрольная потолочная выноска потеряла свою комнату.')
  }
  for (const index of [182, 184]) {
    if (
      callouts.find((item) => item.textItemIndex === index)?.roomBinding.roomSourceNumber !== null
    )
      throw new Error('Неразмеченная общая зона получила выдуманный номер комнаты.')
  }
  const foreignLabels = annotated.rooms[0]?.widthLabels.map((index) => {
    const item = actualLabels[index]
    if (!item) throw new Error('Подпись чужой контрольной цепочки не найдена.')
    return { index, ...item }
  })
  if (!foreignLabels) throw new Error('Контрольная цепочка отсутствует.')
  const rejectedForeignChain = pdfWidthChain(work, pageSource, contours, 6, foreignLabels, 2985)
  if (
    rejectedForeignChain.status !== 'unresolved' ||
    rejectedForeignChain.reason !== 'dimension-outside-room'
  )
    throw new Error('Чужая цепочка с верной суммой не отклонена.')
  const bedroom = annotated.rooms.find((room) => room.roomSourceNumber === 4)
  const window = bedroom?.openings[0]
  if (!bedroom || !window) throw new Error('Контрольная спальня или её окно отсутствует.')
  const rejectedForeignDepth = pdfDepthChain(
    work,
    pageSource,
    contours,
    3,
    nativeLabels(bedroom.depthLabels),
    bedroom.depthMm,
  )
  if (
    rejectedForeignDepth.status !== 'unresolved' ||
    rejectedForeignDepth.reason !== 'dimension-outside-room'
  )
    throw new Error('Чужая вертикальная цепочка не отклонена.')
  const rejectedOppositeOpening = pdfOpeningFromWidthChain(
    work,
    pageSource,
    contours,
    4,
    nativeLabels(bedroom.widthLabels),
    bedroom.widthMm,
    { ...window, kind: 'window', wallEdgeIndex: 2 },
  )
  if (
    rejectedOppositeOpening.status !== 'unresolved' ||
    rejectedOppositeOpening.reason !== 'opening-edge-not-near-chain'
  )
    throw new Error('Окно ошибочно перенесено на противоположную стену.')
  const { paths, ...metadata } = work
  const report = {
    source: reference.source,
    pdfjsVersion: pdfjs.version,
    paidCalls: 0,
    ...metadata,
    pathCount: paths.length,
    pointCount: paths.reduce((sum, path) => sum + path.points.length, 0),
    verifiedNativeCalloutPaths: nativeLeaders.paths.length,
    verifiedNativeDimensionPaths: annotated.dimensionPaths.length,
    verifiedNativeLabels: labels.items.length,
    contourAnnotation: {
      review: contours.review,
      roomCount: contours.rooms.length,
      note: annotated.annotationNote,
    },
    callouts,
    widthChains,
    depthChains,
    openingBindings,
    rejectedForeignChain,
    rejectedForeignDepth,
    rejectedOppositeOpening,
    limitations: [
      'Векторные пути — не стены и не размеры в миллиметрах.',
      'Привязки четырёх помещений проверены относительно ручной разметки исходной страницы, не автоматически распознанных стен.',
      'Ручные контуры закрывают дверные/оконные разрывы по внутренним граням и не являются свободной площадью для мебели.',
      'Прихожая/коридор не разделены догадкой. Проверены по две оси четырёх помещений; санузлы и общие зоны ещё не привязаны.',
      'Шесть проёмов размечены вручную, ширина/отступ сверены по цепочке. Высота, подоконник и открывание не определены; это не готовые зоны безопасности.',
      'Кривые пропущены, формы/группы и не прямоугольные клипы не интерпретируются.',
      'Цвета, прозрачность и видимость PDF-слоёв не переносятся; диагностическая картинка не является копией исходного листа.',
      'Новые мерки не подставлены в проекты; точность AI-чтения заново не измерена.',
    ],
  }
  const highlighted = new Set(
    callouts.flatMap(({ leader }) =>
      leader.status === 'candidate'
        ? [leader.box, leader.arrow.path, ...leader.stem].map(
            (path) => `${path.operationIndex}:${path.subpathIndex}`,
          )
        : [],
    ),
  )
  const vectorPaths = paths
    .map((path) => {
      const key = `${path.operationIndex}:${path.subpathIndex}`
      const points = path.points.map((point) => `${point.x},${point.y}`).join(' ')
      const element = path.closed ? 'polygon' : 'polyline'
      const color = highlighted.has(key) ? '#be3b20' : '#646867'
      return `<${element} points="${points}" fill="${path.paint === 'stroke' ? 'none' : '#cdd0ca'}" stroke="${color}" stroke-width="${highlighted.has(key) ? 1.1 : 0.35}"/>`
    })
    .join('\n')
  const markers = callouts
    .map(({ leader }, index) =>
      leader.status === 'candidate'
        ? `<circle cx="${leader.arrow.tip.x}" cy="${leader.arrow.tip.y}" r="4" fill="#be3b20"/><text x="${leader.arrow.tip.x + 6}" y="${leader.arrow.tip.y - 3}" font-size="9" fill="#be3b20">${index + 1}</text>`
        : '',
    )
    .join('\n')
  const roomOverlays = annotated.rooms
    .map(
      (room) =>
        `<polygon points="${room.polygon.map((p) => `${p.x},${p.y}`).join(' ')}" fill="#2b6fba" fill-opacity="0.05" stroke="#2b6fba" stroke-width="1"/><text x="${room.numberLabel.x}" y="${room.numberLabel.y}" font-size="10" fill="#2b6fba">${room.roomSourceNumber}</text>`,
    )
    .join('\n')
  const dimensionOverlays = [...widthChains, ...depthChains]
    .map(
      (chain) =>
        `<line x1="${chain.ends[0].x}" y1="${chain.ends[0].y}" x2="${chain.ends[1].x}" y2="${chain.ends[1].y}" stroke="#23804a" stroke-width="1.5"/><text x="${chain.ends[0].x + 10}" y="${chain.ends[0].y - 5}" fill="#23804a" font-size="9">${chain.totalMm} mm</text>`,
    )
    .join('\n')
  const openingOverlays = openingBindings
    .map(
      (opening) =>
        `<line x1="${opening.start.x}" y1="${opening.start.y}" x2="${opening.end.x}" y2="${opening.end.y}" stroke="#ad238b" stroke-width="2.5"/>`,
    )
    .join('\n')
  // Source drawing only: omit the lower address/title block. This is not a new source PDF.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1772" viewBox="180 50 680 710" preserveAspectRatio="none"><rect x="180" y="50" width="680" height="710" fill="white"/>${vectorPaths}${roomOverlays}${dimensionOverlays}${openingOverlays}${markers}</svg>`
  const directory = resolve('../../output/quality-bench/plan-vector-74-77')
  await mkdir(directory, { recursive: true })
  await writeFile(resolve(directory, 'report.json'), JSON.stringify(report, null, 2))
  await writeFile(resolve(directory, 'linework.svg'), svg)
  await sharp(Buffer.from(svg)).png().toFile(resolve(directory, 'linework.png'))
  console.log(JSON.stringify(report, null, 2))
} finally {
  await loading.destroy()
}
