import { hslToRgb, rgbToHsl } from './swatches'

// Перекраска предмета по маске. Чистая математика над массивами пикселей, без канвы:
// одинаково работает в браузере и в тестах. Тон меняется на целевой, насыщенность
// подтягивается к свотчу, светлота сдвигается на разницу средних, тени и складки остаются.

export type RecolorTarget = { h: number; s: number; l: number }

// Насыщенность почти целиком от свотча: иначе графит на бежевом диване уходит в сиреневый
const SATURATION_BLEND = 0.85

/** Средняя светлота предмета: вес пикселя равен яркости маски. */
export function meanLightness(pixels: Uint8ClampedArray, mask: Float32Array): number {
  let sum = 0
  let weight = 0
  for (let index = 0; index < mask.length; index += 1) {
    const w = mask[index] ?? 0
    if (w <= 0) {
      continue
    }
    const offset = index * 4
    const r = (pixels[offset] ?? 0) / 255
    const g = (pixels[offset + 1] ?? 0) / 255
    const b = (pixels[offset + 2] ?? 0) / 255
    sum += ((Math.max(r, g, b) + Math.min(r, g, b)) / 2) * w
    weight += w
  }
  return weight > 0 ? sum / weight : 0.5
}

/**
 * Маска из чёрно-белой картинки в веса 0..1 с растушёвкой края: размытие 3×3 в два прохода
 * убирает жёсткий контур между перекрашенным предметом и фоном.
 */
export function maskWeights(
  maskPixels: Uint8ClampedArray,
  width: number,
  height: number,
  passes = 2,
): Float32Array {
  let current = new Float32Array(width * height)
  for (let index = 0; index < current.length; index += 1) {
    current[index] = (maskPixels[index * 4] ?? 0) / 255
  }
  for (let pass = 0; pass < passes; pass += 1) {
    const next = new Float32Array(width * height)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let sum = 0
        let count = 0
        for (let dy = -1; dy <= 1; dy += 1) {
          const yy = y + dy
          if (yy < 0 || yy >= height) continue
          for (let dx = -1; dx <= 1; dx += 1) {
            const xx = x + dx
            if (xx < 0 || xx >= width) continue
            sum += current[yy * width + xx] ?? 0
            count += 1
          }
        }
        next[y * width + x] = sum / count
      }
    }
    current = next
  }
  return current
}

function morph(
  source: Float32Array,
  width: number,
  height: number,
  radius: number,
  pickMax: boolean,
): Float32Array {
  const result = new Float32Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = pickMax ? 0 : 1
      for (let dy = -radius; dy <= radius; dy += 1) {
        const yy = Math.min(height - 1, Math.max(0, y + dy))
        for (let dx = -radius; dx <= radius; dx += 1) {
          const xx = Math.min(width - 1, Math.max(0, x + dx))
          const sample = source[yy * width + xx] ?? 0
          value = pickMax ? Math.max(value, sample) : Math.min(value, sample)
        }
      }
      result[y * width + x] = value
    }
  }
  return result
}

/**
 * Морфологическое закрытие: расширение, затем сужение. Заполняет мелкие дырки маски, например
 * швы между подушками дивана, не меняя внешний контур предмета.
 */
export function closeMask(
  weights: Float32Array,
  width: number,
  height: number,
  radius = 3,
): Float32Array {
  return morph(morph(weights, width, height, radius, true), width, height, radius, false)
}

/** Перекрашивает пиксели на месте. Возвращает число затронутых пикселей. */
export function recolorPixels(
  pixels: Uint8ClampedArray,
  mask: Float32Array,
  target: RecolorTarget,
  sourceLightness: number,
): number {
  const lightnessShift = target.l - sourceLightness
  let touched = 0
  for (let index = 0; index < mask.length; index += 1) {
    const w = mask[index] ?? 0
    if (w <= 0.01) {
      continue
    }
    const offset = index * 4
    const r = (pixels[offset] ?? 0) / 255
    const g = (pixels[offset + 1] ?? 0) / 255
    const b = (pixels[offset + 2] ?? 0) / 255
    const { s, l } = rgbToHsl(r, g, b)
    const nextS = s * (1 - SATURATION_BLEND) + target.s * SATURATION_BLEND
    const nextL = Math.min(0.97, Math.max(0.03, l + lightnessShift))
    const [nr, ng, nb] = hslToRgb(target.h, nextS, nextL)
    pixels[offset] = Math.round((r * (1 - w) + nr * w) * 255)
    pixels[offset + 1] = Math.round((g * (1 - w) + ng * w) * 255)
    pixels[offset + 2] = Math.round((b * (1 - w) + nb * w) * 255)
    touched += 1
  }
  return touched
}
