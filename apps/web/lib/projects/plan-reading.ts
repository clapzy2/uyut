import 'server-only'

import {
  applyRecheck,
  createFalPlanReader,
  createFalSideReader,
  mergeReadings,
  needsRecheck,
  type PlanReading,
  type PlanRoom,
  type SideReader,
} from '@uyut/ai'
import sharp from 'sharp'
import { getEnv } from '@/lib/env'
import { getObject } from '@/lib/storage'

export class PlanReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlanReadError'
  }
}

/**
 * Сторона картинки, которую отправляем модели. План хранится до 4000 пикселей, и в таком виде
 * он весит мегабайты: в base64 это лишние секунды на каждой отправке. Замер на трудном плане
 * по три прогона на размер: 1400 — 100%, 2000 — 96%, 3000 — 100%. Разницы между ними нет,
 * ошибка чтения от числа пикселей не зависит, поэтому берём середину.
 */
const READING_MAX_SIDE = 2000

/** Разрешение растеризации PDF. Меньше 150 точек на дюйм размерные линии становятся кашей. */
const PDF_DPI = 150

/**
 * Сколько страниц PDF смотреть. План почти всегда на первой, но у БТИ бывает титульный лист,
 * а у застройщика — буклет. Три страницы покрывают эти случаи и не превращают чтение
 * договора на двадцать листов в двадцать запросов к модели.
 */
const PDF_MAX_PAGES = 3

/** Сколько комнат перечитывать по отрезкам за один план: дальше это уже не помощь, а счёт. */
const MAX_RECHECKS = 6

function isPdf(key: string): boolean {
  return key.toLowerCase().endsWith('.pdf')
}

async function toJpeg(body: Buffer): Promise<{ body: Buffer; contentType: string }> {
  const jpeg = await sharp(body)
    .resize({ width: READING_MAX_SIDE, height: READING_MAX_SIDE, fit: 'inside' })
    .jpeg({ quality: 88 })
    .toBuffer()
  return { body: jpeg, contentType: 'image/jpeg' }
}

/**
 * Страницы PDF картинками.
 *
 * Из БТИ и от застройщика план чаще всего приходит именно в PDF, а зрячая модель принимает
 * только картинку: на PDF она отвечает отказом. Рисуем через pdf.js на холст napi-rs —
 * обе библиотеки под разрешительной лицензией, в отличие от mupdf и ghostscript, которые
 * под AGPL и на сетевой сервис накладывают обязательство раскрыть исходники.
 */
async function pdfPages(body: Buffer): Promise<Array<{ body: Buffer; contentType: string }>> {
  const [{ createCanvas }, pdfjs] = await Promise.all([
    import('@napi-rs/canvas'),
    import('pdfjs-dist/legacy/build/pdf.mjs'),
  ])
  const document = await pdfjs.getDocument({
    data: new Uint8Array(body),
    // Шрифты внутри файла нам не нужны: размерные линии мы всё равно читаем моделью,
    // а системные шрифты в контейнере всё равно другие
    disableFontFace: true,
    useWorkerFetch: false,
  }).promise
  const count = Math.min(document.numPages, PDF_MAX_PAGES)
  const pages: Array<{ body: Buffer; contentType: string }> = []
  for (let index = 1; index <= count; index += 1) {
    const page = await document.getPage(index)
    const viewport = page.getViewport({ scale: PDF_DPI / 72 })
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
    const context = canvas.getContext('2d')
    // Без заливки прозрачный фон станет чёрным при переводе в JPEG
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({
      // biome-ignore lint/suspicious/noExplicitAny: холст napi-rs и типы pdf.js описаны по-разному
      canvas: canvas as any,
      // biome-ignore lint/suspicious/noExplicitAny: то же самое для контекста
      canvasContext: context as any,
      viewport,
    }).promise
    pages.push(await toJpeg(canvas.toBuffer('image/png')))
  }
  return pages
}

async function planPages(key: string): Promise<Array<{ body: Buffer; contentType: string }>> {
  const object = await getObject(key)
  const body = Buffer.from(object.body)
  return isPdf(key) ? pdfPages(body) : [await toJpeg(body)]
}

/**
 * Перечёт сомнительных сторон.
 *
 * Когда подписанная площадь не сходится с прочитанными сторонами, одно из трёх чисел неверно.
 * Просить модель «проверь себя» бесполезно: на замере она шесть раз из шести настояла на своём
 * числе. А вот отдельный вопрос про одну комнату и одну сторону с просьбой перечислить отрезки
 * цепочки дал верный ответ пять раз из пяти. Поэтому перечитываем обе стороны сомнительной
 * комнаты и берём новые числа только если после них площадь сошлась.
 */
async function recheckRooms(
  reading: PlanReading,
  pages: ReadonlyArray<{ body: Buffer; contentType: string }>,
  readSide: SideReader,
): Promise<PlanReading> {
  const page = pages[0]
  const doubtful = reading.rooms.filter(needsRecheck).slice(0, MAX_RECHECKS)
  if (!page || doubtful.length === 0) {
    return reading
  }
  const fixes = new Map<string, PlanRoom>()
  await Promise.all(
    doubtful.map(async (room) => {
      const [widthCm, depthCm] = await Promise.all([
        readSide(page, room.name, 'width').catch(() => undefined),
        readSide(page, room.name, 'depth').catch(() => undefined),
      ])
      const fixed = applyRecheck(room, { widthCm, depthCm })
      if (fixed) {
        fixes.set(room.name, fixed)
      }
    }),
  )
  if (fixes.size === 0) {
    return reading
  }
  return { ...reading, rooms: reading.rooms.map((room) => fixes.get(room.name) ?? room) }
}

export async function readPlanFromStorage(key: string): Promise<PlanReading> {
  const apiKey = getEnv().FAL_KEY
  if (!apiKey) {
    throw new PlanReadError('Чтение планов пока не подключено: в настройках сервиса нет ключа.')
  }
  let reading: PlanReading
  let pages: Array<{ body: Buffer; contentType: string }> = []
  try {
    pages = await planPages(key)
    if (pages.length === 0) {
      throw new Error('в файле нет страниц')
    }
    const read = createFalPlanReader(apiKey)
    const readings = await Promise.all(pages.map((page) => read(page)))
    reading = mergeReadings(readings)
  } catch (error) {
    console.error(error)
    throw new PlanReadError('Не получилось прочитать план. Попробуйте ещё раз через минуту.')
  }
  if (reading.rooms.length === 0) {
    throw new PlanReadError(
      'На плане не нашлось ни одного размера. Так бывает с рекламными планировками застройщика: на них есть названия комнат, но нет размерных линий. Впишите размеры руками.',
    )
  }
  // Перечёт — улучшение, а не обязанность: если он упал, отдаём то, что прочитали общим проходом
  return await recheckRooms(reading, pages, createFalSideReader(apiKey)).catch((error) => {
    console.error(error)
    return reading
  })
}
