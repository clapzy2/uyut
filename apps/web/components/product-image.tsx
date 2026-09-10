'use client'

import { cn } from '@uyut/ui'
import { useState } from 'react'

/**
 * Картинка товара с запасной ссылкой.
 *
 * У товара их две: копия партнёрской сети и фото с сайта магазина. Ни одной нельзя доверять
 * целиком — замеряли обе. Копия сети отвечает за 400–750 мс, но часть ссылок мертва совсем.
 * Фото магазина обычно быстрее, 120–220 мс, но, например, mnogomebeli.com не отдаёт их наружу
 * вовсе: три запроса из трёх висят до обрыва.
 *
 * Поэтому выбор делает не сервер, а браузер: не загрузилась первая — пробуем вторую.
 */
export function ProductImage({
  src,
  fallback,
  alt,
  className,
}: {
  src: string | null
  fallback?: string | null
  alt: string
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  const url = failed ? fallback : src
  if (!url) {
    return null
  }
  return (
    // biome-ignore lint/performance/noImgElement: картинка живёт у магазина, оптимизатор next/image здесь не нужен
    <img
      src={url}
      alt={alt}
      loading="lazy"
      className={cn('block h-full w-full object-cover', className)}
      onError={() => {
        if (!failed && fallback) {
          setFailed(true)
        }
      }}
    />
  )
}
