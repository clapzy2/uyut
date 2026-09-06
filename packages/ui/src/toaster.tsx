'use client'

import { useEffect } from 'react'
import { cn } from './cn'
import { Icon } from './icons'
import { type ToastItem, useToastStore } from './toast-store'

const AUTO_DISMISS_MS = 6000

function ToastCard({ item }: { item: ToastItem }) {
  const dismiss = useToastStore((state) => state.dismiss)

  useEffect(() => {
    const timer = setTimeout(() => dismiss(item.id), AUTO_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [dismiss, item.id])

  return (
    <div
      role="status"
      className={cn(
        'pointer-events-auto w-[min(360px,calc(100vw-2rem))] rounded-md border bg-paper p-4 shadow-soft',
        'animate-[toast-in_350ms_var(--ease-appear)]',
        item.tone === 'danger' ? 'border-danger/50' : 'border-line',
      )}
    >
      <div className="flex items-start gap-3">
        {item.tone !== 'neutral' ? (
          <Icon
            name={item.tone === 'danger' ? 'warning' : 'check'}
            className={cn(
              'mt-0.5 size-4 flex-none',
              item.tone === 'danger' ? 'text-danger' : 'text-success',
            )}
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-medium leading-snug text-ink">{item.title}</p>
          {item.description ? (
            <p className="mt-1 text-sm leading-snug text-ink-2">{item.description}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => dismiss(item.id)}
          className="-mr-1 -mt-1 grid size-7 flex-none place-items-center rounded-full text-ink-2 transition-colors duration-200 ease-ui hover:text-ink"
          aria-label="Закрыть уведомление"
        >
          <Icon name="close" className="size-3.5" />
        </button>
      </div>
    </div>
  )
}

export function Toaster() {
  const items = useToastStore((state) => state.items)
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
      {items.map((item) => (
        <ToastCard key={item.id} item={item} />
      ))}
    </div>
  )
}
