'use client'

import { cn, toast } from '@uyut/ui'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { removeItem, setItemQuantity } from '@/actions/shopping'
import { AdDisclosure } from '@/components/ad-disclosure'
import { EmptyArt } from '@/components/empty-art'
import { fitLabel, formatPrice, sizeLabel, sourceLabel } from '@/lib/concepts/format'
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

function Row({ item, readOnly }: { item: ShoppingItemView; readOnly: boolean }) {
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
    sizeLabel(item.dimensionsCm),
    item.variant?.color,
    item.inStock ? null : 'нет в наличии',
  ].filter(Boolean)
  const fit = fitLabel(item.fit)

  return (
    <li
      className={cn(
        'motion-list-row group grid grid-cols-[64px_minmax(0,1fr)] items-start gap-x-3 gap-y-2 py-3 transition-[opacity,background-color,padding] duration-300 ease-appear hover:bg-muted/35 sm:flex sm:items-center sm:gap-4 sm:hover:px-2',
        busy && 'opacity-60',
      )}
    >
      <span className="block h-16 w-16 shrink-0 overflow-hidden border border-line bg-muted">
        {item.imageUrl ? (
          // biome-ignore lint/performance/noImgElement: картинка товара живёт у магазина, оптимизатор next/image здесь не нужен
          <img
            src={item.imageUrl}
            alt=""
            className="h-full w-full object-cover transition-transform duration-500 ease-appear group-hover:scale-[1.06]"
            loading="lazy"
          />
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
        {fit ? (
          <span
            className={cn(
              'block truncate text-[12px]',
              item.fit.state === 'tooWide' || item.fit.state === 'tooTall'
                ? 'text-danger'
                : 'text-ink-2',
            )}
          >
            {fit}
          </span>
        ) : null}
        <AdDisclosure text={item.adDisclosure} />
        <span className="mt-1 block font-mono text-[12px] text-ink-2 sm:hidden">
          {item.quantity > 1
            ? `${item.quantity} × ${formatPrice(item.variant?.priceKopecks ?? item.priceKopecks)}`
            : null}
        </span>
      </span>
      <span className="col-start-2 flex items-center justify-between gap-3 sm:contents">
        {readOnly ? (
          <span className="shrink-0 font-mono text-[13px] text-ink-2">× {item.quantity}</span>
        ) : (
          <span className="inline-flex h-8 shrink-0 items-stretch rounded-full border border-control font-mono text-[13px] text-ink">
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => setItemQuantity(item.id, item.quantity - 1))}
              aria-label={item.quantity === 1 ? 'Убрать из списка' : 'Меньше на один'}
              className="w-8 text-ink-2 transition-[color,background-color,transform] duration-200 ease-ui hover:bg-muted hover:text-ink active:scale-75 disabled:opacity-50"
            >
              −
            </button>
            <span className="grid min-w-7 place-items-center border-x border-control px-1">
              {item.quantity}
            </span>
            <button
              type="button"
              disabled={busy || item.quantity >= 99}
              onClick={() => void run(() => setItemQuantity(item.id, item.quantity + 1))}
              aria-label="Больше на один"
              className="w-8 text-ink-2 transition-[color,background-color,transform] duration-200 ease-ui hover:bg-muted hover:text-ink active:scale-75 disabled:opacity-50"
            >
              +
            </button>
          </span>
        )}
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className="font-mono text-[14px] text-ink">{formatPrice(item.totalKopecks)}</span>
          {readOnly ? null : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => removeItem(item.id))}
              className="py-1 text-[12px] text-accent underline decoration-accent/40 underline-offset-4 transition-colors duration-200 ease-ui hover:decoration-accent disabled:opacity-50"
            >
              убрать
            </button>
          )}
        </span>
      </span>
    </li>
  )
}

export function ShoppingRows({
  items,
  projectId,
  readOnly = false,
}: {
  items: ShoppingItemView[]
  projectId: string
  /** Второй участник видит список, но не меняет его */
  readOnly?: boolean
}) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col gap-5 border-y border-line py-8 sm:flex-row sm:items-start sm:gap-7">
        <EmptyArt kind="shopping" className="h-[68px] w-[90px] shrink-0 text-line-strong" />
        <div>
          <h2 className="font-serif text-2xl leading-tight text-ink">Список пока пуст.</h2>
          <p className="mt-2 max-w-md text-[15px] leading-relaxed text-ink-2">
            {readOnly
              ? 'Владелец проекта собирает его из подбора товаров к концептам. Как только что-то появится, вы увидите это здесь.'
              : 'Откройте концепт комнаты, нажмите на предмет на рендере и выберите товар из подборки: кнопка «В список» под ценой добавит его сюда.'}
          </p>
          <Link
            href={`/projects/${projectId}`}
            className="mt-4 inline-block text-[15px] text-ink underline decoration-accent decoration-1 underline-offset-4"
          >
            К комнатам проекта
          </Link>
        </div>
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
              <Row key={item.id} item={item} readOnly={readOnly} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
