'use client'

import { cn, toast } from '@uyut/ui'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { setConceptLike } from '@/actions/concepts'
import { categoryLabels, formatPrice, sourceLabel } from '@/lib/concepts/format'
import type { ConceptPageData, ObjectView } from '@/lib/concepts/objects'

function ObjectChip({
  object,
  selected,
  onSelect,
  onHover,
}: {
  object: ObjectView
  selected: boolean
  onSelect: () => void
  onHover: (hover: boolean) => void
}) {
  const { bbox } = object
  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
      aria-label={`${object.orderIndex + 1}. ${categoryLabels[object.category]}`}
      aria-pressed={selected}
      style={{ left: `${(bbox.x + bbox.w / 2) * 100}%`, top: `${(bbox.y + bbox.h / 2) * 100}%` }}
      className={cn(
        'absolute z-20 grid h-8 min-w-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 px-2 font-mono text-[13px] font-medium shadow-soft transition-transform duration-200 ease-ui hover:scale-110',
        selected
          ? 'border-on-accent bg-accent text-on-accent'
          : 'border-accent bg-paper/90 text-accent',
      )}
    >
      {object.orderIndex + 1}
    </button>
  )
}

function Highlight({ object, strong }: { object: ObjectView; strong: boolean }) {
  if (object.maskSrc) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-0 z-10 bg-accent transition-opacity duration-200 ease-ui',
          strong ? 'opacity-40' : 'opacity-25',
        )}
        style={{
          // Маска SAM — непрозрачный чёрно-белый PNG, поэтому режем по яркости, а не по альфе
          WebkitMaskImage: `url(${object.maskSrc})`,
          maskImage: `url(${object.maskSrc})`,
          WebkitMaskSize: '100% 100%',
          maskSize: '100% 100%',
          maskMode: 'luminance',
        }}
      />
    )
  }
  const { bbox } = object
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute z-10 border-2 border-accent"
      style={{
        left: `${bbox.x * 100}%`,
        top: `${bbox.y * 100}%`,
        width: `${bbox.w * 100}%`,
        height: `${bbox.h * 100}%`,
      }}
    />
  )
}

function MatchesPanel({ object }: { object: ObjectView | null }) {
  if (!object) {
    return (
      <p className="text-[15px] leading-relaxed text-ink-2">
        Нажмите на номер на картинке, чтобы увидеть похожие товары.
      </p>
    )
  }
  const label = categoryLabels[object.category]
  if (object.matches.length === 0) {
    return (
      <div>
        <p className="font-serif text-xl text-ink">{label}</p>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
          В каталоге пока нет товаров этой категории. Появятся вместе с фидами магазинов.
        </p>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-serif text-xl text-ink">
          {object.styleOnly
            ? `${label}: похожие по стилю`
            : `${label}: ${object.matches.length} похожих`}
        </p>
        {object.window ? (
          <span className="rounded-full border border-line-strong px-2.5 py-0.5 text-[12px] text-ink-2">
            до {formatPrice(object.window.maxKopecks)}
          </span>
        ) : null}
      </div>
      <ul className="flex flex-col divide-y divide-line border-y border-line">
        {object.matches.map((match) => (
          <li key={match.id}>
            <a
              href={match.affiliateUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                'flex items-center gap-3 py-3 transition-colors duration-200 ease-ui hover:bg-muted/60',
                match.overBudget && 'opacity-75',
              )}
            >
              <span className="block h-16 w-16 shrink-0 overflow-hidden border border-line bg-muted">
                {match.imageUrl ? (
                  // biome-ignore lint/performance/noImgElement: картинка товара живёт у магазина, оптимизатор next/image здесь не нужен
                  <img
                    src={match.imageUrl}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] text-ink">{match.title}</span>
                <span className="block truncate text-[13px] text-ink-2">
                  {[match.brand, sourceLabel(match.source)].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <span className="font-mono text-[14px] text-ink">
                  {formatPrice(match.priceKopecks)}
                </span>
                {match.overBudget ? (
                  <span className="rounded-full border border-danger px-2 py-0.5 text-[11px] text-danger">
                    выше бюджета
                  </span>
                ) : match.oldPriceKopecks ? (
                  <span className="font-mono text-[12px] text-ink-2 line-through">
                    {formatPrice(match.oldPriceKopecks)}
                  </span>
                ) : null}
              </span>
            </a>
          </li>
        ))}
      </ul>
      <p className="text-[13px] leading-relaxed text-ink-2">
        {object.styleOnly
          ? 'Точной копии в каталоге нет, это ближайшие по духу. Ссылка открывает магазин в новой вкладке.'
          : 'Похожие по форме и цвету, не точная копия. Ссылка открывает магазин в новой вкладке.'}
      </p>
    </div>
  )
}

export function ConceptViewer({ data }: { data: ConceptPageData }) {
  const router = useRouter()
  const { concept, objects } = data
  const [selectedId, setSelectedId] = useState<string | null>(objects[0]?.id ?? null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [liked, setLiked] = useState<boolean | null>(concept.likedByOwner)
  const selected = objects.find((object) => object.id === selectedId) ?? null
  const hovered = objects.find((object) => object.id === hoveredId) ?? null
  const searching = concept.objectsStatus === 'pending'

  // Пока предметы ищутся, страница сама обновляется; дольше минуты ждать нечего
  useEffect(() => {
    if (!searching) {
      return
    }
    let ticks = 0
    const timer = setInterval(() => {
      ticks += 1
      router.refresh()
      if (ticks >= 20) {
        clearInterval(timer)
      }
    }, 3000)
    return () => clearInterval(timer)
  }, [router, searching])

  function like(value: boolean) {
    setLiked(value)
    void setConceptLike(concept.id, value).then((result) => {
      if (!result.ok) {
        toast({ title: result.error, tone: 'danger' })
      }
    })
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,4fr)] lg:gap-12">
      <div>
        <div className="relative overflow-hidden border border-line bg-muted">
          {concept.renderSrc ? (
            // biome-ignore lint/performance/noImgElement: подписанная ссылка живёт час, оптимизатор next/image здесь не нужен
            <img src={concept.renderSrc} alt="Концепт комнаты" className="block w-full" />
          ) : (
            <div className="aspect-video" />
          )}
          {hovered && hovered.id !== selected?.id ? (
            <Highlight object={hovered} strong={false} />
          ) : null}
          {selected ? <Highlight object={selected} strong /> : null}
          {objects.map((object) => (
            <ObjectChip
              key={object.id}
              object={object}
              selected={object.id === selectedId}
              onSelect={() => setSelectedId(object.id)}
              onHover={(hover) => setHoveredId(hover ? object.id : null)}
            />
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-ink-2">
            {searching
              ? 'Ищем предметы на картинке, обычно 10–15 секунд.'
              : concept.objectsStatus === 'failed'
                ? 'Предметы не нашлись. Попробуйте открыть концепт позже.'
                : concept.objectsStatus === 'skipped'
                  ? 'Подбор товаров пока выключен.'
                  : objects.length === 0
                    ? 'Знакомых предметов на картинке не оказалось.'
                    : 'Наведите на номер, чтобы подсветить предмет, нажмите, чтобы увидеть товары.'}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => like(false)}
              aria-pressed={liked === false}
              className={cn(
                'h-9 rounded-full border px-3.5 text-sm transition-colors duration-200 ease-ui',
                liked === false
                  ? 'border-ink text-ink'
                  : 'border-line-strong text-ink-2 hover:text-ink',
              )}
            >
              Не нравится
            </button>
            <button
              type="button"
              onClick={() => like(true)}
              aria-pressed={liked === true}
              className={cn(
                'h-9 rounded-full border px-3.5 text-sm transition-colors duration-200 ease-ui',
                liked
                  ? 'border-accent bg-accent-tint text-accent'
                  : 'border-accent text-accent hover:bg-accent-tint',
              )}
            >
              ♥ Нравится
            </button>
          </div>
        </div>
      </div>

      <aside className="flex flex-col gap-4">
        {objects.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {objects.map((object) => (
              <button
                key={object.id}
                type="button"
                onClick={() => setSelectedId(object.id)}
                onMouseEnter={() => setHoveredId(object.id)}
                onMouseLeave={() => setHoveredId(null)}
                aria-pressed={object.id === selectedId}
                className={cn(
                  'h-8 rounded-full border px-3 text-[13px] transition-colors duration-200 ease-ui',
                  object.id === selectedId
                    ? 'border-accent bg-accent-tint text-accent'
                    : 'border-line-strong text-ink-2 hover:text-ink',
                )}
              >
                {object.orderIndex + 1} {categoryLabels[object.category]}
              </button>
            ))}
          </div>
        ) : null}
        <MatchesPanel object={selected} />
      </aside>
    </div>
  )
}
