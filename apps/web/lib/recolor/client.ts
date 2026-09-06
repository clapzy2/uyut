'use client'

import {
  closeMask,
  isApproximate,
  maskWeights,
  meanLightness,
  recolorPixels,
  type Swatch,
} from '@uyut/ai'

// Перекраска в браузере. Рендер и маска читаются через наш домен (/api/object), чтобы канва
// могла отдать пиксели: картинки с другого адреса браузер для чтения закрывает.

export type RecolorBase = {
  width: number
  height: number
  pixels: Uint8ClampedArray
  weights: Float32Array
  sourceLightness: number
}

export type RecolorResult = { blob: Blob; url: string; approximate: boolean }

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`не загрузилась картинка ${src}`))
    image.src = src
  })
}

function draw(image: HTMLImageElement, width: number, height: number): ImageData {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    throw new Error('канва недоступна')
  }
  context.drawImage(image, 0, 0, width, height)
  return context.getImageData(0, 0, width, height)
}

function feather(weights: Float32Array, width: number, height: number): Float32Array {
  // Растушёвка через тот же размытый проход, что и в maskWeights: переводим веса в пиксели и обратно
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < weights.length; index += 1) {
    pixels[index * 4] = Math.round((weights[index] ?? 0) * 255)
  }
  return maskWeights(pixels, width, height, 2)
}

/** Готовит предмет к перекраске один раз: пиксели, растушёванная маска, средняя светлота. */
export async function prepareRecolor(renderKey: string, maskKey: string): Promise<RecolorBase> {
  const [render, mask] = await Promise.all([
    loadImage(`/api/object?key=${encodeURIComponent(renderKey)}`),
    loadImage(`/api/object?key=${encodeURIComponent(maskKey)}`),
  ])
  const width = render.naturalWidth
  const height = render.naturalHeight
  const pixels = draw(render, width, height).data
  const maskPixels = draw(mask, width, height).data
  // Сначала закрываем мелкие дырки маски, потом растушёвываем край
  const closed = closeMask(maskWeights(maskPixels, width, height, 0), width, height, 3)
  const weights = feather(closed, width, height)
  return { width, height, pixels, weights, sourceLightness: meanLightness(pixels, weights) }
}

/** Применяет свотч к заготовке и отдаёт картинку. Заготовка не меняется, можно звать много раз. */
export async function applySwatch(base: RecolorBase, swatch: Swatch): Promise<RecolorResult> {
  const canvas = document.createElement('canvas')
  canvas.width = base.width
  canvas.height = base.height
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('канва недоступна')
  }
  const copy = new Uint8ClampedArray(base.pixels)
  recolorPixels(copy, base.weights, swatch.hsl, base.sourceLightness)
  context.putImageData(new ImageData(copy, base.width, base.height), 0, 0)
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error('канва не отдала картинку'))),
      'image/webp',
      0.9,
    )
  })
  return {
    blob,
    url: URL.createObjectURL(blob),
    approximate: isApproximate(base.sourceLightness, swatch),
  }
}
