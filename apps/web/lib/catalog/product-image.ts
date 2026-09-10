import type { CatalogImage } from '@uyut/db'

/** Хост, на котором партнёрская сеть держит свои копии картинок товаров */
const NETWORK_IMAGE_HOST = 'imgng.gdeslon.ru'

/**
 * Какую картинку товара показывать.
 *
 * Сеть отдаёт две ссылки: свою копию и исходник с сайта магазина. Копия сети отвечает
 * за полсекунды, а часть ссылок не отвечает вовсе — в браузере это выходит рядом пустых
 * серых квадратов вместо мебели, что и увидел владелец. Замер на живых товарах: копия сети
 * 390–750 мс и обрывы, исходник магазина 120–220 мс без единой осечки.
 *
 * Поэтому копию сети берём только если другой нет.
 */
export function displayImage(images: readonly CatalogImage[]): string | undefined {
  return orderedImages(images)[0]
}

/**
 * Обе ссылки в порядке предпочтения: сначала фото магазина, следом копия сети.
 *
 * Отдаём обе, потому что ни одной нельзя доверять целиком. Копия сети отвечает за 400–750 мс,
 * но часть ссылок мертва совсем. Фото магазина обычно быстрее, но, например, mnogomebeli.com
 * не отдаёт их наружу вовсе. Выбор делает браузер: не загрузилась первая — берёт вторую.
 */
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
