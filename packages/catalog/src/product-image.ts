import type { CatalogImage } from '@uyut/db'

import { gdeslonLampSpec } from './gdeslon-lamp-specs'

const NETWORK_IMAGE_HOST = 'imgng.gdeslon.ru'
// Для этих артикулов сверено фото, а данных для расстановки пока недостаточно.
const photosWithoutSizes = [
  {
    externalId: '95754-1453268-3371525462737917000',
    title: 'Торшер Nowodvorski Ida 11373 высота 800 мм',
    url: 'https://nowodvorski.com/app/uploads/nowodvorski-pim-images/2026/08/11373.webp',
  },
  {
    externalId: '95754-1614665-15185461308487930000',
    title: 'Торшер EVOLUCE Bagetti SL1142.505.01 цвет арматуры Белый, Коричневый',
    url: 'https://lightsnab.ru/cache/image/5/1024x1024/20240408140435366173.webp',
  },
]

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
    verified =
      gdeslonLampSpec(product.externalId, product.title)?.imageUrl ??
      photosWithoutSizes.find(
        (photo) => photo.externalId === product.externalId && photo.title === product.title,
      )?.url
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
