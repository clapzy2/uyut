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
  const fromShop = images.find((image) => {
    try {
      return new URL(image.url).hostname !== NETWORK_IMAGE_HOST
    } catch {
      return false
    }
  })
  return (fromShop ?? images[0])?.url
}
