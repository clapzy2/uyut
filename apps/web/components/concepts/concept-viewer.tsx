'use client'

import { findSwatch, isApproximate, type Swatch } from '@uyut/ai'
import { cn, toast } from '@uyut/ui'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { setConceptLike } from '@/actions/concepts'
import { resetRecolor, saveRecolor } from '@/actions/recolor'
import { addItem } from '@/actions/shopping'
import { AdDisclosure } from '@/components/ad-disclosure'
import { SwatchPicker } from '@/components/concepts/swatch-picker'
import { categoryLabels, formatPrice, sourceLabel } from '@/lib/concepts/format'
import type { ConceptPageData, MatchView, ObjectView } from '@/lib/concepts/objects'
import { applySwatch, prepareRecolor, type RecolorBase } from '@/lib/recolor/client'
import { pluralItems } from '@/lib/shopping/format'

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

function MatchesPanel({
  object,
  quantities,
  adding,
  onAdd,
  canAdd,
}: {
  object: ObjectView | null
  /** Сколько каждого товара уже в списке покупок проекта */
  quantities: Record<string, number>
  adding: string | null
  onAdd: (match: MatchView, object: ObjectView) => void
  canAdd: boolean
}) {
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
          <span className="rounded-full border border-control px-2.5 py-0.5 text-[12px] text-ink-2">
            до {formatPrice(object.window.maxKopecks)}
          </span>
        ) : null}
      </div>
      <ul className="flex flex-col divide-y divide-line border-y border-line">
        {object.matches.map((match) => {
          const inList = quantities[match.id] ?? 0
          return (
            <li key={match.id} className={cn('py-3', match.overBudget && 'opacity-75')}>
              <div className="flex items-center gap-3">
                <a
                  href={match.affiliateUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-w-0 flex-1 items-center gap-3 transition-colors duration-200 ease-ui hover:bg-muted/60"
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
                </a>
                <span className="flex shrink-0 flex-col items-end gap-1.5">
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
                  {!canAdd ? (
                    inList > 0 ? (
                      <span className="font-mono text-[12px] text-ink-2">в списке · {inList}</span>
                    ) : null
                  ) : (
                    <button
                      type="button"
                      disabled={adding !== null}
                      aria-label={
                        inList > 0
                          ? `${match.title}: в списке ${inList}, добавить ещё`
                          : `Добавить в список: ${match.title}`
                      }
                      onClick={() => onAdd(match, object)}
                      className={cn(
                        'h-8 rounded-full border px-3 text-[12px] transition-colors duration-200 ease-ui disabled:opacity-50',
                        inList > 0
                          ? 'border-accent bg-accent-tint text-accent'
                          : 'border-control text-ink-2 hover:border-accent hover:text-accent',
                      )}
                    >
                      {adding === match.id
                        ? 'Добавляем…'
                        : inList > 0
                          ? `В списке · ${inList}`
                          : 'В список'}
                    </button>
                  )}
                </span>
              </div>
              <AdDisclosure text={match.adDisclosure} />
            </li>
          )
        })}
      </ul>
      <p className="text-[13px] leading-relaxed text-ink-2">
        {object.styleOnly
          ? 'Точной копии в каталоге нет, это ближайшие по духу. Ссылка открывает магазин в новой вкладке, «В список» кладёт товар в покупки проекта.'
          : 'Похожие по форме и цвету, не точная копия. Ссылка открывает магазин в новой вкладке, «В список» кладёт товар в покупки проекта.'}
      </p>
    </div>
  )
}

export function ConceptViewer({ data }: { data: ConceptPageData }) {
  const router = useRouter()
  const { concept, objects } = data
  const canEdit = data.role === 'owner'
  const [selectedId, setSelectedId] = useState<string | null>(objects[0]?.id ?? null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [liked, setLiked] = useState<boolean | null>(concept.liked)
  const selected = objects.find((object) => object.id === selectedId) ?? null
  const hovered = objects.find((object) => object.id === hoveredId) ?? null
  const searching = concept.objectsStatus === 'pending'
  const [preview, setPreview] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [baseLightness, setBaseLightness] = useState<number | null>(null)
  // Заготовка перекраски на каждый предмет считается один раз и переиспользуется при наведении
  const basesRef = useRef(new Map<string, Promise<RecolorBase>>())
  const previewUrlRef = useRef<string | null>(null)

  function baseFor(object: ObjectView): Promise<RecolorBase> | null {
    if (!concept.renderKey || !object.maskKey) {
      return null
    }
    let base = basesRef.current.get(object.id)
    if (!base) {
      base = prepareRecolor(concept.renderKey, object.maskKey)
      basesRef.current.set(object.id, base)
    }
    return base
  }

  function showPreview(url: string | null) {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
    }
    previewUrlRef.current = url
    setPreview(url)
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: заготовка зависит только от выбранного предмета
  useEffect(() => {
    setBaseLightness(null)
    if (!selected) {
      return
    }
    const base = baseFor(selected)
    if (!base) {
      return
    }
    let cancelled = false
    void base.then((ready) => {
      if (!cancelled) {
        setBaseLightness(ready.sourceLightness)
      }
    })
    return () => {
      cancelled = true
    }
  }, [selected?.id])

  async function previewSwatch(swatch: Swatch | null) {
    if (!swatch || !selected) {
      showPreview(null)
      return
    }
    const base = baseFor(selected)
    if (!base) {
      return
    }
    try {
      const result = await applySwatch(await base, swatch)
      showPreview(result.url)
    } catch (error) {
      console.error(error)
      toast({ title: 'Не получилось примерить цвет', tone: 'danger' })
    }
  }

  async function commitSwatch(swatch: Swatch) {
    if (!selected) {
      return
    }
    const base = baseFor(selected)
    if (!base) {
      return
    }
    setSaving(true)
    try {
      const result = await applySwatch(await base, swatch)
      const formData = new FormData()
      formData.set('image', new File([result.blob], 'recolor.webp', { type: 'image/webp' }))
      const saved = await saveRecolor(concept.id, selected.id, swatch.id, formData)
      if (!saved.ok) {
        toast({ title: saved.error, tone: 'danger' })
        return
      }
      toast({
        title: `${categoryLabels[selected.category]}: ${swatch.ru.toLowerCase()}`,
        tone: 'success',
      })
      showPreview(null)
      basesRef.current.clear()
      router.refresh()
    } catch (error) {
      console.error(error)
      toast({ title: 'Не получилось сохранить цвет', tone: 'danger' })
    } finally {
      setSaving(false)
    }
  }

  function reset() {
    setSaving(true)
    void resetRecolor(concept.id).then((result) => {
      setSaving(false)
      if (!result.ok) {
        toast({ title: result.error, tone: 'danger' })
        return
      }
      basesRef.current.clear()
      showPreview(null)
      router.refresh()
    })
  }

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

  const [adding, setAdding] = useState<string | null>(null)

  // Перекрашенный предмет уходит в список с выбранным свотчем как вариантом цвета
  function addToList(match: MatchView, object: ObjectView) {
    const swatch = object.swatchId ? findSwatch(object.swatchId) : undefined
    setAdding(match.id)
    void addItem({
      projectId: data.room.projectId,
      catalogItemId: match.id,
      roomId: data.room.id,
      conceptObjectId: object.id,
      ...(swatch ? { variant: { swatchId: swatch.id, color: swatch.ru.toLowerCase() } } : {}),
    }).then((result) => {
      setAdding(null)
      if (!result.ok) {
        toast({ title: result.error, tone: 'danger' })
        return
      }
      toast({
        title:
          result.data.quantity > 1
            ? `В списке уже ${result.data.quantity}: ${match.title}`
            : `В списке: ${match.title}`,
        tone: 'success',
      })
      router.refresh()
    })
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,4fr)] lg:gap-12">
      <div>
        <div className="relative overflow-hidden border border-line bg-muted">
          {concept.renderSrc ? (
            // biome-ignore lint/performance/noImgElement: подписанная ссылка живёт час, оптимизатор next/image здесь не нужен
            <img
              src={preview ?? concept.renderSrc}
              alt="Концепт комнаты"
              className="block w-full"
            />
          ) : (
            <div className="aspect-video" />
          )}
          {preview ? (
            <span className="absolute right-3 top-3 z-30 rounded-full bg-paper/90 px-3 py-1 text-[12px] font-medium text-ink shadow-soft">
              Примерка
            </span>
          ) : null}
          {!preview && hovered && hovered.id !== selected?.id ? (
            <Highlight object={hovered} strong={false} />
          ) : null}
          {!preview && selected && !selected.swatchId ? (
            <Highlight object={selected} strong />
          ) : null}
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
            {data.other ? (
              <span className="mr-1 text-[13px] text-ink-2">
                {data.other.name}:{' '}
                {data.other.liked === null
                  ? 'ещё не смотрел(а)'
                  : data.other.liked
                    ? 'нравится'
                    : 'не нравится'}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => like(false)}
              aria-pressed={liked === false}
              className={cn(
                'h-9 rounded-full border px-3.5 text-sm transition-colors duration-200 ease-ui',
                liked === false
                  ? 'border-ink text-ink'
                  : 'border-control text-ink-2 hover:text-ink',
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
        {concept.note ? (
          <p className="mt-4 border-l-2 border-line-strong pl-4 text-[15px] leading-relaxed text-ink-2">
            {concept.note}
          </p>
        ) : null}
        {concept.editedRenderKey ? (
          <div className="mt-4 flex flex-wrap items-center gap-3 text-[13px] text-ink-2">
            <span>Цвета изменены.</span>
            {canEdit ? (
              <button
                type="button"
                onClick={reset}
                disabled={saving}
                className="underline decoration-line-strong underline-offset-4 hover:text-ink disabled:opacity-50"
              >
                Вернуть исходный
              </button>
            ) : null}
          </div>
        ) : null}
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
                    : 'border-control text-ink-2 hover:text-ink',
                )}
              >
                {object.orderIndex + 1} {categoryLabels[object.category]}
              </button>
            ))}
          </div>
        ) : null}
        <MatchesPanel
          object={selected}
          quantities={data.shopping.byCatalogItem}
          adding={adding}
          onAdd={addToList}
          canAdd={canEdit}
        />
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-line pt-4 text-[13px] text-ink-2">
          <span>
            {data.shopping.count > 0
              ? `В списке покупок ${pluralItems(data.shopping.count)}.`
              : 'Список покупок проекта пока пуст.'}
          </span>
          <Link
            href={`/projects/${data.room.projectId}/summary`}
            className="inline-block py-1.5 text-ink underline decoration-accent decoration-1 underline-offset-4"
          >
            Итоги проекта
          </Link>
        </div>
        {canEdit && selected?.maskKey && concept.renderKey ? (
          <div className="border-t border-line pt-4">
            <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-2">
              Материал: {categoryLabels[selected.category].toLowerCase()}
            </p>
            <SwatchPicker
              category={selected.category}
              currentSwatchId={selected.swatchId}
              approximateFor={(swatch) =>
                baseLightness === null ? false : isApproximate(baseLightness, swatch)
              }
              busy={saving}
              onPreview={(swatch) => void previewSwatch(swatch)}
              onCommit={(swatch) => void commitSwatch(swatch)}
            />
          </div>
        ) : null}
      </aside>
    </div>
  )
}
