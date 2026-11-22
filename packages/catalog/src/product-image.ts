import type { CatalogImage } from '@uyut/db'

import { gdeslonLampSpec } from './gdeslon-lamp-specs'

const NETWORK_IMAGE_HOST = 'imgng.gdeslon.ru'
// Фото уличного светильника из каталога Nowodvorski. Размеры для расстановки
// этого артикула в комнате по-прежнему отсутствуют.
const idaPhoto = {
  externalId: '95754-1453268-3371525462737917000',
  title: 'Торшер Nowodvorski Ida 11373 высота 800 мм',
  url: 'https://nowodvorski.com/app/uploads/nowodvorski-pim-images/2026/08/11373.webp',
}

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
  let verified: string | undefined
  if (product?.source === 'gdeslon') {
    verified = gdeslonLampSpec(product.externalId, product.title)?.imageUrl
    if (product.externalId === idaPhoto.externalId && product.title === idaPhoto.title) {
      verified = idaPhoto.url
    }
  }
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
