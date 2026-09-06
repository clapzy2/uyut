'use client'

import { cn, toast } from '@uyut/ui'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { removeItem, setItemQuantity } from '@/actions/shopping'
import { formatPrice, sourceLabel } from '@/lib/concepts/format'
import { itemTotalKopecks } from '@/lib/estimate'
import type { ShoppingItemView } from '@/lib/shopping/repository'

type Group = { key: string; title: string; items: ShoppingItemView[] }

// Строки уже отсортированы по порядку комнат; товары без комнаты уходят в конец
function groupByRoom(items: ShoppingItemView[]): Group[] {
  const groups = new Map<string, Group>()
  for (const item of items) {
    const key = item.roomId ?? 'none'
    const group = groups.get(key) ?? {
      key,
      title: item.roomName ?? 'Без комнаты',
      items: [],
    }
    group.items.push(item)
    groups.set(key, group)
  }
  const ordered = [...groups.values()]
  const loose = ordered.findIndex((group) => group.key === 'none')
  if (loose >= 0) {
    ordered.push(...ordered.splice(loose, 1))
  }
  return ordered
}

function Row({ item }: { item: ShoppingItemView }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function run(work: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true)
    try {
      const result = await work()
      if (!result.ok) {
        toast({ title: result.error ?? 'Не получилось', tone: 'danger' })
        return
      }
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  const meta = [
    item.brand,
    sourceLabel(item.source),
    item.variant?.color,
    item.inStock ? null : 'нет в наличии',
  ].filter(Boolean)

  return (
    <li className={cn('flex items-center gap-3 py-3 sm:gap-4', busy && 'opacity-60')}>
      <span className="block h-16 w-16 shrink-0 overflow-hidden border border-line bg-muted">
        {item.imageUrl ? (
          // biome-ignore lint/performance/noImgElement: картинка товара живёт у магазина, оптимизатор next/image здесь не нужен
          <img src={item.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        <a
          href={item.affiliateUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block truncate text-[15px] text-ink decoration-accent decoration-1 underline-offset-4 hover:underline"
        >
          {item.title}
        </a>
        <span className="block truncate text-[13px] text-ink-2">{meta.join(' · ')}</span>
        <span className="mt-1 block font-mono text-[12px] text-ink-2 sm:hidden">
          {item.quantity > 1
            ? `${item.quantity} × ${formatPrice(item.variant?.priceKopecks ?? item.priceKopecks)}`
            : null}
        </span>
      </span>
      <span className="inline-flex h-8 shrink-0 items-stretch rounded-full border border-line-strong font-mono text-[13px] text-ink">
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(() => setItemQuantity(item.id, item.quantity - 1))}
          aria-label={item.quantity === 1 ? 'Убрать из списка' : 'Меньше на один'}
          className="w-8 text-ink-2 transition-colors duration-200 ease-ui hover:text-ink disabled:opacity-50"
        >
          −
        </button>
        <span className="grid min-w-7 place-items-center border-x border-line-strong px-1">
          {item.quantity}
        </span>
        <button
          type="button"
          disabled={busy || item.quantity >= 99}
          onClick={() => void run(() => setItemQuantity(item.id, item.quantity + 1))}
          aria-label="Больше на один"
          className="w-8 text-ink-2 transition-colors duration-200 ease-ui hover:text-ink disabled:opacity-50"
        >
          +
        </button>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <span className="font-mono text-[14px] text-ink">
          {formatPrice(
            itemTotalKopecks({
              priceKopecks: item.priceKopecks,
              quantity: item.quantity,
              variantPriceKopecks: item.variant?.priceKopecks ?? null,
            }),
          )}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(() => removeItem(item.id))}
          className="text-[12px] text-accent underline decoration-accent/40 underline-offset-4 transition-colors duration-200 ease-ui hover:decoration-accent disabled:opacity-50"
        >
          убрать
        </button>
      </span>
    </li>
  )
}

export function ShoppingRows({
  items,
  projectId,
}: {
  items: ShoppingItemView[]
  projectId: string
}) {
  if (items.length === 0) {
    return (
      <div className="border-y border-line py-8">
        <h2 className="font-serif text-2xl leading-tight text-ink">Список пока пуст.</h2>
        <p className="mt-2 max-w-md text-[15px] leading-relaxed text-ink-2">
          Откройте концепт комнаты, нажмите на предмет на рендере и выберите товар из подборки:
          кнопка «В список» под ценой добавит его сюда.
        </p>
        <Link
          href={`/projects/${projectId}`}
          className="mt-4 inline-block text-[15px] text-ink underline decoration-accent decoration-1 underline-offset-4"
        >
          К комнатам проекта
        </Link>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-8">
      {groupByRoom(items).map((group) => (
        <section key={group.key} aria-label={group.title}>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-2">
            {group.title}
          </p>
          <ul className="divide-y divide-line border-y border-line">
            {group.items.map((item) => (
              <Row key={item.id} item={item} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
