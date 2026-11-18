'use client'

import type { SourceObject } from '@uyut/ai'
import { useState } from 'react'

/** Два угла рамки выбирает человек; это не автоматический обмер предмета. */
export function SourceObjectPicker({
  photoUrl,
  photoRevision,
  value,
  onChange,
}: {
  photoUrl: string
  photoRevision: number
  value: SourceObject | null
  onChange: (value: SourceObject | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [first, setFirst] = useState<{ x: number; y: number } | null>(null)
  return (
    <div className="border border-line p-4">
      <button type="button" className="text-accent underline" onClick={() => setOpen(!open)}>
        {value
          ? 'Предмет для переноса выделен - изменить'
          : 'Выделить исходный предмет для переноса'}
      </button>
      {open ? (
        <>
          <p className="my-3 text-sm text-ink-2">
            Нажмите на два противоположных угла предмета. Включите весь корпус и ручки, по
            возможности без соседней мебели. Затем проверьте рамку. В заметках укажите, куда его
            поставить. Один вариант переноса требует до четырёх последовательных обработок. Точное
            сохранение скрытых деталей не гарантируется.
          </p>
          <button
            type="button"
            aria-label={first ? 'Выбрать второй угол предмета' : 'Выбрать первый угол предмета'}
            className="relative block w-full cursor-crosshair"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect()
              const point = {
                x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
                y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
              }
              if (!first) {
                setFirst(point)
                onChange(null)
                return
              }
              const box = {
                x: Math.min(first.x, point.x),
                y: Math.min(first.y, point.y),
                w: Math.abs(first.x - point.x),
                h: Math.abs(first.y - point.y),
              }
              if (box.w >= 0.02 && box.h >= 0.02) onChange({ photoRevision, box })
              setFirst(null)
            }}
          >
            {/* biome-ignore lint/performance/noImgElement: исходное фото для выбора рамки */}
            <img
              src={photoUrl}
              alt="Исходное фото для выделения переносимого предмета"
              className="block w-full"
            />
            {value ? (
              <span
                className="pointer-events-none absolute border-2 border-accent bg-accent/10"
                style={{
                  left: `${value.box.x * 100}%`,
                  top: `${value.box.y * 100}%`,
                  width: `${value.box.w * 100}%`,
                  height: `${value.box.h * 100}%`,
                }}
              />
            ) : null}
          </button>
          <p role="status" className="my-2 text-sm">
            {first
              ? 'Теперь выберите противоположный угол.'
              : value
                ? 'Рамка готова. Проверьте, что выделен именно нужный предмет.'
                : 'Выберите первый угол.'}
          </p>
          <button
            type="button"
            className="text-sm underline"
            onClick={() => {
              onChange(null)
              setFirst(null)
            }}
          >
            Сбросить выделение
          </button>
        </>
      ) : null}
    </div>
  )
}
