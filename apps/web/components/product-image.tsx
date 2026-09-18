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
  const [failedUrls, setFailedUrls] = useState<string[]>([])
  const url = [src, fallback].find((candidate) => candidate && !failedUrls.includes(candidate))
  if (!url) {
    return (
      <span
        role="img"
        aria-label={alt || 'Фото товара недоступно'}
        className="grid h-full w-full place-items-center bg-muted text-line-strong"
      >
        <svg
          viewBox="0 0 48 48"
          aria-hidden="true"
          className="h-8 w-8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
        >
          <path d="M8 12h32v24H8z" />
          <path d="m9 33 9-9 7 7 5-5 9 9" />
          <circle cx="31" cy="19" r="3" />
          <path d="M14 9h20" opacity=".45" />
        </svg>
      </span>
    )
  }
  return (
    // biome-ignore lint/performance/noImgElement: картинка живёт у магазина, оптимизатор next/image здесь не нужен
    <img
      src={url}
      alt={alt}
      loading="lazy"
      className={cn('block h-full w-full object-cover', className)}
      onError={() => setFailedUrls((current) => [...new Set([...current, url])])}
    />
  )
}
