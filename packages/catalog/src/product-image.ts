import type { CatalogImage } from '@uyut/db'

const NETWORK_IMAGE_HOST = 'imgng.gdeslon.ru'

/** Сначала фото магазина, затем копия партнёрской сети, которая иногда недоступна. */
export function orderedImages(images: readonly CatalogImage[]): string[] {
  const isNetworkCopy = (url: string): boolean => {
    try {
      return new URL(url).hostname === NETWORK_IMAGE_HOST
    } catch {
      return false
    }
  }
  const urls = images.map((image) => image.url).filter(Boolean)
  return [...urls.filter((url) => !isNetworkCopy(url)), ...urls.filter(isNetworkCopy)]
}

export function displayImage(images: readonly CatalogImage[]): string | undefined {
  return orderedImages(images)[0]
}
