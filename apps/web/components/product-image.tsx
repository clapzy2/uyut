'use client'

import { cn } from '@uyut/ui'
import { useEffect, useRef, useState } from 'react'

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
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const url = [src, fallback].find((candidate) => candidate && !failedUrls.includes(candidate))

  // Некоторые магазины не возвращают ошибку, а держат запрос открытым. Без тайм-аута
  // браузер навсегда показывает сломанный квадрат и не переходит к запасной ссылке.
  useEffect(() => {
    const image = imageRef.current
    if (!url || loadedUrl === url || !image) {
      return
    }
    if (image.complete && image.naturalWidth > 0) {
      setLoadedUrl(url)
      return
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    let active = true
    const startTimer = () => {
      if (!active || timer !== undefined) return
      timer = setTimeout(() => {
        if (image.complete && image.naturalWidth > 0) setLoadedUrl(url)
        else setFailedUrls((current) => [...new Set([...current, url])])
      }, 3_500)
    }
    // Native lazy loading may defer the request indefinitely while the card is offscreen.
    const observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
              startTimer()
              observer?.disconnect()
            }
          })
    const checkVisibility = () => {
      const rect = image.getBoundingClientRect()
      if (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < window.innerHeight &&
        rect.left < window.innerWidth
      )
        startTimer()
    }
    if (observer) observer.observe(image)
    else {
      checkVisibility()
      window.addEventListener('scroll', checkVisibility, true)
      window.addEventListener('resize', checkVisibility)
    }
    return () => {
      active = false
      clearTimeout(timer)
      observer?.disconnect()
      if (!observer) {
        window.removeEventListener('scroll', checkVisibility, true)
        window.removeEventListener('resize', checkVisibility)
      }
    }
  }, [loadedUrl, url])

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
      key={url}
      ref={imageRef}
      src={url}
      alt={alt}
      loading="lazy"
      className={cn(
        'block h-full w-full object-cover transition-opacity duration-300',
        loadedUrl === url ? 'opacity-100' : 'opacity-0',
        className,
      )}
      onLoad={() => setLoadedUrl(url)}
      onError={() => setFailedUrls((current) => [...new Set([...current, url])])}
    />
  )
}
