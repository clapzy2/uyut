import type { CatalogImage } from '@uyut/db'

import { gdeslonLampSpec } from './gdeslon-lamp-specs'

const NETWORK_IMAGE_HOST = 'imgng.gdeslon.ru'

/** Сначала фото магазина, затем копия партнёрской сети, которая иногда недоступна. */
export function orderedImages(
  images: readonly CatalogImage[],
  product?: { source: string; externalId: string; title: string },
): string[] {
  const isNetworkCopy = (url: string): boolean => {
    try {
      return new URL(url).hostname === NETWORK_IMAGE_HOST
    } catch {
      return false
    }
  }
  const urls = images.map((image) => image.url).filter(Boolean)
  const verified =
    product?.source === 'gdeslon'
      ? gdeslonLampSpec(product.externalId, product.title)?.imageUrl
      : undefined
  return [
    ...new Set([
      ...urls.filter((url) => !isNetworkCopy(url)),
      ...(verified ? [verified] : []),
      ...urls.filter(isNetworkCopy),
    ]),
  ]
}

export function displayImage(images: readonly CatalogImage[]): string | undefined {
  return orderedImages(images)[0]
}
