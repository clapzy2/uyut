import { createHash } from 'node:crypto'
import sharp from 'sharp'
import {
  nativeDocumentaryHeightCaption,
  nativeHeightCaption,
  nativeHeightMillimetreDeclarationIndex,
} from './plan-native-height-caption'
import {
  nativeCeilingDatumDeclarationTopic,
  nativeFinishedFloorHeightReferenceTopic,
} from './plan-native-height-datum-caption'
import {
  type NativeDimensionCaptionContext,
  nativeDimensionCaptionMillimetres,
} from './plan-pdf-caption-binding'
import { extractPdfLinework, type PdfLinework } from './plan-pdf-linework'
import { pdfNativePaintVisibilityIssue } from './plan-pdf-paint-visibility'
import { pdfStandardFontDataUrl } from './plan-pdf-standard-fonts'
import { type NativeNumericTextInk, nativeNumericTextInk } from './plan-pdf-text-ink'

export class PlanReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlanReadError'
  }
}

const READING_MAX_SIDE = 2000
const PDF_DPI = 150
const PDF_MAX_PIXELS = 12_000_000

export type NativeTextAnchors = {
  source: { sha256: string; page: number; width: number; height: number }
  complete: boolean
  originalPdfSha256?: string
  pageNormalizedScale?: { x: number; y: number }
  // Kept in the provider's compact-slot frame; the native bridge validates both identities.
  compactCaptionGeometry?: NativeDimensionCaptionContext
  // A hidden/composited vector must not become strict visible dimension evidence.
  vectorInkRefusal?: string
  // Separate from the numeric rail inventory: full height-caption glyph outlines.
  heightCaptionInk?: NativeNumericTextInk & {
    source: { sha256: string; pdfPage: number; pageWidth: number; pageHeight: number }
  }
  heightDatumInk?: NativeNumericTextInk & {
    source: { sha256: string; pdfPage: number; pageWidth: number; pageHeight: number }
  }
  heightFloorReferenceInk?: NativeNumericTextInk & {
    source: { sha256: string; pdfPage: number; pageWidth: number; pageHeight: number }
  }
  heightUnitInk?: NativeNumericTextInk & {
    source: { sha256: string; pdfPage: number; pageWidth: number; pageHeight: number }
  }
  // Baseline origins from PDF text transforms, not glyph boxes or inferred room centres.
  labels: {
    id: string
    name: string
    point: { x: number; y: number }
    nativeIndex?: number
    compactIndex?: number
    pagePoint?: { x: number; y: number }
    rotation?: number
  }[]
}

function nativeCaptionBaseline(
  item: { str: string; transform: number[]; width: number },
  label: { text: string; x: number; y: number; rotation: number },
  index: number,
  viewport: {
    width: number
    height: number
    convertToViewportPoint(x: number, y: number): number[]
  },
): NativeDimensionCaptionContext['items'][number] | undefined {
  if (
    item.str !== label.text ||
    item.transform.length !== 6 ||
    !item.transform.every(Number.isFinite) ||
    !Number.isFinite(item.width) ||
    item.width <= 0 ||
    ![viewport.width, viewport.height].every((value) => Number.isFinite(value) && value > 0)
  )
    return undefined
  const [dx = Number.NaN, dy = Number.NaN, , , x = Number.NaN, y = Number.NaN] = item.transform
  const length = Math.hypot(dx, dy)
  if (!Number.isFinite(length) || length <= 0) return undefined
  const [startX = Number.NaN, startY = Number.NaN] = viewport.convertToViewportPoint(x, y)
  const [endX = Number.NaN, endY = Number.NaN] = viewport.convertToViewportPoint(
    x + (item.width * dx) / length,
    y + (item.width * dy) / length,
  )
  const rotation = (-Math.atan2(endY - startY, endX - startX) * 180) / Math.PI
  const angleDelta = Math.abs((rotation - label.rotation) % 360)
  const angleDifference = Math.min(angleDelta, 360 - angleDelta)
  const baselineStart = {
    x: (startX / viewport.width) * 1000,
    y: (startY / viewport.height) * 1000,
  }
  const baselineEnd = { x: (endX / viewport.width) * 1000, y: (endY / viewport.height) * 1000 }
  if (
    (startX === endX && startY === endY) ||
    !Number.isFinite(angleDifference) ||
    angleDifference > 0.5 + 1e-9 ||
    [baselineStart.x, baselineStart.y, baselineEnd.x, baselineEnd.y].some(
      (value) => !Number.isFinite(value) || value < 0 || value > 1000,
    ) ||
    Math.round(baselineStart.x) !== label.x ||
    Math.round(baselineStart.y) !== label.y
  )
    return undefined
  return {
    index,
    text: label.text,
    rotation: label.rotation,
    origin: { x: label.x, y: label.y },
    baselineStart,
    baselineEnd,
  }
}

async function toJpeg(body: Buffer): Promise<{
  body: Buffer
  contentType: string
  width: number
  height: number
}> {
  const jpeg = await sharp(body)
    .resize({ width: READING_MAX_SIDE, height: READING_MAX_SIDE, fit: 'inside' })
    .jpeg({ quality: 88 })
    .toBuffer({ resolveWithObject: true })
  return {
    body: jpeg.data,
    contentType: 'image/jpeg',
    width: jpeg.info.width,
    height: jpeg.info.height,
  }
}

/** Только выбранная страница. Проверки выполняются до любого платного обращения. */
export async function preparePlanPage(
  body: Buffer,
  isPdf: boolean,
  pageNumber = 1,
  includeLinework = false,
  includeNativeTextAnchors = false,
): Promise<{
  image: { body: Buffer; contentType: string; width: number; height: number; planText?: string }
  pageNumber: number
  pageCount: number
  linework?: PdfLinework
  nativeCaptionGeometry?: NativeDimensionCaptionContext
  nativeTextAnchors?: NativeTextAnchors
  lineworkRasterSource?: NativeTextAnchors['source']
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
    standardFontDataUrl: pdfStandardFontDataUrl(import.meta.url),
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
    // Ordinary PDF chain checks and reviewed-page checks use the same selected native page.
    let linework: PdfLinework | undefined
    let nativeViewport: ReturnType<typeof page.getViewport> | undefined
    let nativeOperators: Parameters<typeof extractPdfLinework>[0] | undefined
    if (includeLinework) {
      try {
        nativeViewport = page.getViewport({ scale: 1 })
        nativeOperators = await page.getOperatorList()
        linework = extractPdfLinework(nativeOperators, pdfjs.OPS, nativeViewport)
      } catch {
        // The caller must refuse geometry verification; never reinterpret a missing layer as valid.
      }
    }
    const full = page.getViewport({ scale: PDF_DPI / 72 })
    const textContent = await page.getTextContent().catch(() => undefined)
    const optionalContentConfig =
      includeNativeTextAnchors && typeof document.getOptionalContentConfig === 'function'
        ? await document.getOptionalContentConfig({ intent: 'display' }).catch(() => undefined)
        : undefined
    const glyphInk =
      includeNativeTextAnchors && nativeOperators && nativeViewport && textContent
        ? nativeNumericTextInk({
            operatorList: nativeOperators,
            operators: pdfjs.OPS,
            textItems: textContent.items,
            viewport: nativeViewport,
            getFont: (fontName) => page.commonObjs.get(fontName),
            getGlyphPath: (fontName, fontChar) =>
              page.commonObjs.get(`${fontName}_path_${fontChar}`).path,
            isOptionalContentVisible: (properties) => optionalContentConfig?.isVisible(properties),
          })
        : undefined
    const heightUnitIndex =
      includeNativeTextAnchors && textContent && textContent.items.length <= 1000
        ? nativeHeightMillimetreDeclarationIndex(
            textContent.items.map((item) => ('str' in item ? item.str.trim() : '')),
          )
        : null
    const heightIndexes =
      includeNativeTextAnchors && textContent && textContent.items.length <= 1000
        ? textContent.items.flatMap((item, index) =>
            'str' in item &&
            item.str.length <= 200 &&
            (nativeHeightCaption(item.str.trim()).status === 'observed' ||
              (heightUnitIndex !== null && nativeDocumentaryHeightCaption(item.str.trim())))
              ? [index]
              : [],
          )
        : []
    const heightInk =
      includeNativeTextAnchors && nativeOperators && nativeViewport && textContent
        ? nativeNumericTextInk({
            operatorList: nativeOperators,
            operators: pdfjs.OPS,
            textItems: textContent.items,
            viewport: nativeViewport,
            selectedTextIndexes: heightIndexes,
            getFont: (fontName) => page.commonObjs.get(fontName),
            getGlyphPath: (fontName, fontChar) =>
              page.commonObjs.get(`${fontName}_path_${fontChar}`).path,
            isOptionalContentVisible: (properties) => optionalContentConfig?.isVisible(properties),
          })
        : undefined
    const heightUnitInk =
      heightUnitIndex !== null && nativeOperators && nativeViewport && textContent
        ? nativeNumericTextInk({
            operatorList: nativeOperators,
            operators: pdfjs.OPS,
            textItems: textContent.items,
            viewport: nativeViewport,
            selectedTextIndexes: [heightUnitIndex],
            getFont: (fontName) => page.commonObjs.get(fontName),
            getGlyphPath: (fontName, fontChar) =>
              page.commonObjs.get(`${fontName}_path_${fontChar}`).path,
            isOptionalContentVisible: (properties) => optionalContentConfig?.isVisible(properties),
          })
        : undefined
    const datumIndexes =
      includeNativeTextAnchors && textContent && textContent.items.length <= 1000
        ? textContent.items.flatMap((item, index) =>
            'str' in item &&
            item.str.length <= 200 &&
            nativeCeilingDatumDeclarationTopic(item.str.trim())
              ? [index]
              : [],
          )
        : []
    const datumInk =
      includeNativeTextAnchors && nativeOperators && nativeViewport && textContent
        ? nativeNumericTextInk({
            operatorList: nativeOperators,
            operators: pdfjs.OPS,
            textItems: textContent.items,
            viewport: nativeViewport,
            selectedTextIndexes: datumIndexes,
            getFont: (fontName) => page.commonObjs.get(fontName),
            getGlyphPath: (fontName, fontChar) =>
              page.commonObjs.get(`${fontName}_path_${fontChar}`).path,
            isOptionalContentVisible: (properties) => optionalContentConfig?.isVisible(properties),
          })
        : undefined
    const floorReferenceIndexes =
      includeNativeTextAnchors && textContent && textContent.items.length <= 1000
        ? textContent.items.flatMap((item, index) =>
            'str' in item && nativeFinishedFloorHeightReferenceTopic(item.str.trim())
              ? [index]
              : [],
          )
        : []
    const floorReferenceInk =
      floorReferenceIndexes.length && nativeOperators && nativeViewport && textContent
        ? nativeNumericTextInk({
            operatorList: nativeOperators,
            operators: pdfjs.OPS,
            textItems: textContent.items,
            viewport: nativeViewport,
            selectedTextIndexes: floorReferenceIndexes,
            getFont: (fontName) => page.commonObjs.get(fontName),
            getGlyphPath: (fontName, fontChar) =>
              page.commonObjs.get(`${fontName}_path_${fontChar}`).path,
            isOptionalContentVisible: (properties) => optionalContentConfig?.isVisible(properties),
          })
        : undefined
    const vectorInkRefusal =
      includeNativeTextAnchors && nativeOperators
        ? pdfNativePaintVisibilityIssue({
            operatorList: nativeOperators,
            operators: pdfjs.OPS,
            isOptionalContentVisible: (properties) => optionalContentConfig?.isVisible(properties),
          })
        : undefined
    const nativeCaptionGeometry: NativeDimensionCaptionContext | undefined = nativeViewport
      ? {
          source: {
            sha256: createHash('sha256').update(body).digest('hex'),
            pdfPage: pageNumber,
            pageWidth: nativeViewport.width,
            pageHeight: nativeViewport.height,
          },
          complete:
            textContent !== undefined &&
            [nativeViewport.width, nativeViewport.height].every(
              (value) => Number.isFinite(value) && value > 0,
            ),
          items: [],
        }
      : undefined
    const textItems: Array<{ text: string; x: number; y: number; rotation: number }> = []
    const nativeOrigins: Array<{
      index: number
      compactIndex: number
      name: string
      x: number
      y: number
      dx: number
      dy: number
    }> = []
    let nativeTextComplete = textContent !== undefined
    let textSize = 2
    for (const [index, item] of (textContent?.items ?? []).entries()) {
      if (!('str' in item) || !item.str.trim()) continue
      const [x, y] = full.convertToViewportPoint(item.transform[4], item.transform[5])
      const label = {
        text: item.str.trim().slice(0, 200),
        x: Math.round((x / full.width) * 1000),
        y: Math.round((y / full.height) * 1000),
        rotation: Math.round((Math.atan2(item.transform[1], item.transform[0]) * 180) / Math.PI),
      }
      textSize += JSON.stringify(label).length + 1
      if (textSize > 30_000 || textItems.length >= 1000) {
        nativeTextComplete = false
        if (nativeCaptionGeometry) nativeCaptionGeometry.complete = false
        break
      }
      const compactIndex = textItems.length
      textItems.push(label)
      if (nativeCaptionGeometry && nativeViewport) {
        if (item.str.trim().length > 200) nativeCaptionGeometry.complete = false
        if (nativeDimensionCaptionMillimetres(label.text) !== undefined) {
          const caption = nativeCaptionBaseline(item, label, compactIndex, nativeViewport)
          if (caption) nativeCaptionGeometry.items.push(caption)
          else nativeCaptionGeometry.complete = false
        }
      }
      if (includeNativeTextAnchors) {
        if (
          item.str.trim().length > 200 ||
          !Number.isFinite(item.transform[4]) ||
          !Number.isFinite(item.transform[5])
        ) {
          nativeTextComplete = false
          continue
        }
        nativeOrigins.push({
          index,
          compactIndex,
          name: item.str.trim(),
          x: item.transform[4],
          y: item.transform[5],
          dx: item.transform[0],
          dy: item.transform[1],
        })
      }
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
      ...(optionalContentConfig
        ? { optionalContentConfigPromise: Promise.resolve(optionalContentConfig) }
        : {}),
    }).promise
    const image = await toJpeg(canvas.toBuffer('image/png'))
    let nativeTextAnchors: NativeTextAnchors | undefined
    if (includeNativeTextAnchors) {
      const labels: NativeTextAnchors['labels'] = []
      for (const origin of nativeOrigins) {
        const [renderX, renderY] = viewport.convertToViewportPoint(origin.x, origin.y)
        const [directionX, directionY] = viewport.convertToViewportPoint(
          origin.x + origin.dx,
          origin.y + origin.dy,
        )
        const angle = (-Math.atan2(directionY - renderY, directionX - renderX) * 180) / Math.PI
        const rotation = angle
        const x = (renderX / canvas.width) * image.width
        const y = (renderY / canvas.height) * image.height
        if (
          !Number.isFinite(x) ||
          !Number.isFinite(y) ||
          !Number.isFinite(angle) ||
          (directionX === renderX && directionY === renderY) ||
          x < 0 ||
          x > image.width ||
          y < 0 ||
          y > image.height
        ) {
          nativeTextComplete = false
          continue
        }
        labels.push({
          id: `native-text-${origin.index}`,
          name: origin.name,
          point: { x, y },
          nativeIndex: origin.index,
          compactIndex: origin.compactIndex,
          pagePoint: {
            x: (renderX / viewport.width) * 1000,
            y: (renderY / viewport.height) * 1000,
          },
          rotation,
        })
      }
      nativeTextAnchors = {
        source: {
          sha256: createHash('sha256').update(image.body).digest('hex'),
          page: pageNumber,
          width: image.width,
          height: image.height,
        },
        complete: nativeTextComplete,
        originalPdfSha256: createHash('sha256').update(body).digest('hex'),
        pageNormalizedScale: {
          x: ((viewport.width / canvas.width) * image.width) / 1000,
          y: ((viewport.height / canvas.height) * image.height) / 1000,
        },
        ...(nativeCaptionGeometry
          ? { compactCaptionGeometry: structuredClone(nativeCaptionGeometry) }
          : {}),
        labels,
      }
      if (nativeTextAnchors.compactCaptionGeometry && glyphInk) {
        const inkByIndex = new Map(glyphInk.items.map((item) => [item.index, item]))
        const heldByIndex = new Map(glyphInk.unresolved.map((item) => [item.index, item.reason]))
        const labelBySlot = new Map(labels.map((label) => [label.compactIndex, label]))
        for (const caption of nativeTextAnchors.compactCaptionGeometry.items) {
          const label = labelBySlot.get(caption.index)
          const ink =
            label?.nativeIndex !== undefined ? inkByIndex.get(label.nativeIndex) : undefined
          if (ink && ink.text === caption.text) {
            caption.inkPolygon = structuredClone(ink.quad)
            caption.inkSourceOperation = ink.operationIndex
          } else {
            caption.inkRefusal =
              glyphInk.refusalReason ??
              (label?.nativeIndex !== undefined ? heldByIndex.get(label.nativeIndex) : undefined) ??
              'native-glyph-ink-unavailable'
          }
        }
      }
      if (vectorInkRefusal) nativeTextAnchors.vectorInkRefusal = vectorInkRefusal
      if (heightInk && nativeViewport)
        nativeTextAnchors.heightCaptionInk = {
          ...heightInk,
          source: {
            sha256: createHash('sha256').update(body).digest('hex'),
            pdfPage: pageNumber,
            pageWidth: nativeViewport.width,
            pageHeight: nativeViewport.height,
          },
        }
      if (heightUnitInk && nativeViewport)
        nativeTextAnchors.heightUnitInk = {
          ...heightUnitInk,
          source: {
            sha256: createHash('sha256').update(body).digest('hex'),
            pdfPage: pageNumber,
            pageWidth: nativeViewport.width,
            pageHeight: nativeViewport.height,
          },
        }
      if (floorReferenceInk && nativeViewport)
        nativeTextAnchors.heightFloorReferenceInk = {
          ...floorReferenceInk,
          source: {
            sha256: createHash('sha256').update(body).digest('hex'),
            pdfPage: pageNumber,
            pageWidth: nativeViewport.width,
            pageHeight: nativeViewport.height,
          },
        }
      if (datumInk && nativeViewport)
        nativeTextAnchors.heightDatumInk = {
          ...datumInk,
          source: {
            sha256: createHash('sha256').update(body).digest('hex'),
            pdfPage: pageNumber,
            pageWidth: nativeViewport.width,
            pageHeight: nativeViewport.height,
          },
        }
    }
    return {
      image: { ...image, ...(planText ? { planText } : {}) },
      pageNumber,
      pageCount: document.numPages,
      ...(linework ? { linework } : {}),
      ...(nativeCaptionGeometry ? { nativeCaptionGeometry } : {}),
      ...(nativeTextAnchors ? { nativeTextAnchors } : {}),
      ...(linework && nativeTextAnchors ? { lineworkRasterSource: nativeTextAnchors.source } : {}),
    }
  } finally {
    await loading.destroy()
  }
}
