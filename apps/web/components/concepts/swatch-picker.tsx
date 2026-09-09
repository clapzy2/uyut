'use client'

import {
  type Swatch,
  type SwatchClass,
  swatchAvailability,
  swatchClasses,
  swatchClassLabels,
  swatches,
} from '@uyut/ai'
import type { CatalogCategory } from '@uyut/db'
import { cn } from '@uyut/ui'

/**
 * Свотчи материалов для выбранного предмета. Чужой класс материала приглушён с пометкой «v2»:
 * сдвигом цвета фактуру не поменять. Наведение даёт превью, клик сохраняет.
 */
export function SwatchPicker({
  category,
  currentSwatchId,
  approximateFor,
  busy,
  onCommit,
}: {
  category: CatalogCategory
  currentSwatchId: string | null
  /** Какие свотчи покажутся «приблизительно»: решает родитель по светлоте предмета */
  approximateFor: (swatch: Swatch) => boolean
  busy: boolean
  onCommit: (swatch: Swatch) => void
}) {
  const groups = swatchClasses
    .map((klass: SwatchClass) => ({
      klass,
      items: swatches.filter((swatch) => swatch.class === klass),
    }))
    .filter((group) => group.items.length > 0)

  return (
    <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
      <legend className="sr-only">Материалы для перекраски</legend>
      {groups.map((group) => (
        <div key={group.klass}>
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.1em] text-ink-2">
            {swatchClassLabels[group.klass]}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {group.items.map((swatch) => {
              const available = swatchAvailability(category, swatch) === 'ok'
              const approximate = available && approximateFor(swatch)
              const selected = swatch.id === currentSwatchId
              const title = !available
                ? `${swatch.ru}. Появится во второй версии: фактуру ${swatchClassLabels[swatch.class].toLowerCase()} сдвигом цвета не получить`
                : approximate
                  ? `${swatch.ru}. Приблизительно: светлоту нужно менять сильно, тени станут плоскими`
                  : swatch.ru
              return (
                <button
                  key={swatch.id}
                  type="button"
                  title={title}
                  aria-label={title}
                  aria-pressed={selected}
                  disabled={!available || busy}
                  onClick={() => available && onCommit(swatch)}
                  className={cn(
                    'relative h-8 w-8 rounded-full border-2 transition-transform duration-200 ease-ui',
                    selected ? 'border-accent scale-110' : 'border-paper shadow-soft',
                    available ? 'hover:scale-110' : 'cursor-not-allowed opacity-40',
                  )}
                  style={{ backgroundColor: swatch.hex }}
                >
                  {!available ? (
                    <span className="absolute -right-1 -top-1 rounded-full bg-paper px-1 font-mono text-[9px] leading-[14px] text-ink-2 shadow-soft">
                      v2
                    </span>
                  ) : approximate ? (
                    <span className="absolute -right-1 -top-1 grid h-3.5 w-3.5 place-items-center rounded-full bg-paper font-mono text-[9px] leading-none text-ink-2 shadow-soft">
                      ≈
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
        </div>
      ))}
      <p className="text-[12px] leading-relaxed text-ink-2">
        Нажмите на цвет: примерка и сохранение одним движением. Меняется цвет, не фактура: значок
        «v2» у материалов, которые появятся с перекраской по маске.
      </p>
    </fieldset>
  )
}
