import { cn } from '@uyut/ui'
import type { PhotoSlot } from '@/lib/landing/photos'

/**
 * Кадр лендинга. Пока фотографии нет, на её месте стоит рамка с описанием будущего снимка:
 * композиция страницы видна сразу, и понятно, что снимать, а выдуманной картинки нет.
 */
export function PhotoFrame({
  slot,
  className,
  priority = false,
}: {
  slot: PhotoSlot
  className?: string
  priority?: boolean
}) {
  if (!slot.src) {
    return (
      <div
        className={cn(
          'grid place-items-center border border-dashed border-line-strong bg-muted p-6 text-center',
          className,
        )}
      >
        <p className="max-w-xs text-[14px] leading-relaxed text-ink-2">
          <span className="block font-mono text-[11px] uppercase tracking-[0.12em]">
            Место для фотографии
          </span>
          <span className="mt-2 block">{slot.brief}</span>
        </p>
      </div>
    )
  }
  return (
    // biome-ignore lint/performance/noImgElement: кадры лендинга лежат рядом со страницей и уже сжаты
    <img
      src={slot.src}
      alt={slot.alt}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : 'auto'}
      className={cn('block object-cover', className)}
    />
  )
}
