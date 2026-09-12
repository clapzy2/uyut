import type { HTMLAttributes } from 'react'
import { cn } from './cn'

/**
 * Заглушка загрузки повторяет геометрию будущего блока, а не рисует «строки текста»:
 * так при появлении данных ничего не прыгает. Пульсацию гасит prefers-reduced-motion.
 */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div aria-hidden="true" className={cn('skeleton-shimmer bg-muted', className)} {...props} />
  )
}

/** Обёртка экрана загрузки: скринридер слышит одно сообщение вместо набора пустых блоков */
export function SkeletonScreen({
  label = 'Загружаем',
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { label?: string }) {
  return (
    <div role="status" aria-label={label} aria-live="polite" className={className} {...props}>
      {children}
    </div>
  )
}
