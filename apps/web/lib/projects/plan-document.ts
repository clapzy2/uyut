import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import sharp from 'sharp'

export class PlanReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlanReadError'
  }
}

const READING_MAX_SIDE = 2000
const PDF_DPI = 150
const PDF_MAX_PIXELS = 12_000_000

const standardFontDataUrl = (() => {
  try {
    const require_ = createRequire(import.meta.url)
    return `${join(dirname(require_.resolve('pdfjs-dist/package.json')), 'standard_fonts').replaceAll('\\', '/')}/`
  } catch {
    return undefined
  }
})()

async function toJpeg(body: Buffer): Promise<{ body: Buffer; contentType: string }> {
  const jpeg = await sharp(body)
    .resize({ width: READING_MAX_SIDE, height: READING_MAX_SIDE, fit: 'inside' })
    .jpeg({ quality: 88 })
    .toBuffer()
  return { body: jpeg, contentType: 'image/jpeg' }
}

/** Только выбранная страница. Проверки выполняются до любого платного обращения. */
export async function preparePlanPage(
  body: Buffer,
  isPdf: boolean,
  pageNumber = 1,
): Promise<{
  image: { body: Buffer; contentType: string; planText?: string }
  pageNumber: number
  pageCount: number
}> {
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    throw new PlanReadError('Номер страницы должен быть целым числом от 1.')
  }
  if (!isPdf) {
    if (pageNumber !== 1) throw new PlanReadError('У изображения только одна страница.')
    return { image: await toJpeg(body), pageNumber: 1, pageCount: 1 }
  }

  const [{ createCanvas }, pdfjs] = await Promise.all([
    import('@napi-rs/canvas'),
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    // Явный импорт нужен трассировщику Next, иначе worker отсутствует в production-образе.
    import('pdfjs-dist/legacy/build/pdf.worker.mjs'),
  ])
  const loading = pdfjs.getDocument({
    data: new Uint8Array(body),
    disableFontFace: true,
    useWorkerFetch: false,
    ...(standardFontDataUrl ? { standardFontDataUrl } : {}),
  })
  let document: Awaited<typeof loading.promise>
  try {
    document = await loading.promise
  } catch (error) {
    await loading.destroy()
    if (error instanceof Error && error.name === 'PasswordException') {
      throw new PlanReadError('PDF защищён паролем. Снимите пароль или пришлите скриншот плана.')
    }
    throw new PlanReadError('Этот PDF не открывается. Пришлите другой файл или скриншот плана.')
  }
  try {
    if (pageNumber > document.numPages) {
      throw new PlanReadError(
        `В PDF ${document.numPages} страниц. Выберите страницу из этого диапазона.`,
      )
    }
    const page = await document.getPage(pageNumber)
    const full = page.getViewport({ scale: PDF_DPI / 72 })
    const textContent = await page.getTextContent().catch(() => undefined)
    const textItems: Array<{ text: string; x: number; y: number; rotation: number }> = []
    let textSize = 2
    for (const item of textContent?.items ?? []) {
      if (!('str' in item) || !item.str.trim()) continue
      const [x, y] = full.convertToViewportPoint(item.transform[4], item.transform[5])
      const label = {
        text: item.str.trim().slice(0, 200),
        x: Math.round((x / full.width) * 1000),
        y: Math.round((y / full.height) * 1000),
        rotation: Math.round((Math.atan2(item.transform[1], item.transform[0]) * 180) / Math.PI),
      }
      textSize += JSON.stringify(label).length + 1
      if (textSize > 30_000 || textItems.length >= 1000) break
      textItems.push(label)
    }
    const planText = textItems.length > 0 ? JSON.stringify(textItems) : undefined
    const budget = Math.min(1, Math.sqrt(PDF_MAX_PIXELS / (full.width * full.height)))
    const viewport = page.getViewport({ scale: (PDF_DPI / 72) * budget })
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
    const context = canvas.getContext('2d')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({
      // biome-ignore lint/suspicious/noExplicitAny: napi-rs и pdf.js используют разные типы холста
      canvas: canvas as any,
      // biome-ignore lint/suspicious/noExplicitAny: то же для контекста
      canvasContext: context as any,
      viewport,
    }).promise
    return {
      image: { ...(await toJpeg(canvas.toBuffer('image/png'))), ...(planText ? { planText } : {}) },
      pageNumber,
      pageCount: document.numPages,
    }
  } finally {
    await loading.destroy()
  }
}
