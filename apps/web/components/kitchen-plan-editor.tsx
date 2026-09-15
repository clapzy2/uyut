'use client'

import type { PlanGeometry, PlanKitchenItem } from '@uyut/db'
import { useRef, useState } from 'react'
import { kitchenItemIssues, kitchenLabels } from '@/lib/projects/kitchen-items'

export function KitchenPlanEditor({
  geometry,
  items,
  onChange,
}: {
  geometry: PlanGeometry
  items: PlanKitchenItem[]
  onChange: (items: PlanKitchenItem[]) => void
}) {
  const [selectedId, setSelectedId] = useState<string>()
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<{ id: string; dx: number; dy: number; pointerId: number } | null>(null)
  const selected = items.find((item) => item.id === selectedId)
  const issues = kitchenItemIssues(items, geometry.widthCm, geometry.heightCm)
  function point(clientX: number, clientY: number) {
    const matrix = svg.current?.getScreenCTM()
    return matrix ? new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse()) : null
  }
  function patch(update: Partial<PlanKitchenItem>) {
    onChange(items.map((item) => (item.id === selectedId ? { ...item, ...update } : item)))
  }
  function add(kind: PlanKitchenItem['kind']) {
    if (items.length >= 50) return
    const id = crypto.randomUUID()
    onChange([...items, { id, kind, xCm: 0, yCm: 0, widthCm: 60, depthCm: 60 }])
    setSelectedId(id)
  }
  return (
    <section className="mt-6 border-t border-line pt-5">
      <h3 className="font-serif text-xl">Расстановка кухни</h3>
      <p className="my-3 text-sm text-ink-2">
        Новый элемент — заготовка 60 × 60 см. Замените размеры на габариты выбранной техники или
        секции. Мойка и плита обозначают целые секции гарнитура, поэтому их не нужно накладывать на
        другую секцию. Это ручная схема, товары к элементам ещё не привязаны.
      </p>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(kitchenLabels) as PlanKitchenItem['kind'][]).map((kind) => (
          <button
            type="button"
            key={kind}
            disabled={items.length >= 50}
            onClick={() => add(kind)}
            className="rounded-sm border border-control px-3 py-2 text-sm disabled:opacity-50"
          >
            + {kitchenLabels[kind]}
          </button>
        ))}
      </div>
      <svg
        ref={svg}
        viewBox={`-10 -10 ${geometry.widthCm + 20} ${geometry.heightCm + 20}`}
        className="mt-4 max-h-96 w-full touch-none border border-line bg-paper"
        role="img"
        aria-label="Расстановка кухонных модулей на плане"
        onPointerMove={(event) => {
          const current = drag.current
          const at = point(event.clientX, event.clientY)
          if (!current || !at || current.pointerId !== event.pointerId) return
          onChange(
            items.map((item) =>
              item.id === current.id
                ? {
                    ...item,
                    xCm: Math.round(
                      Math.max(0, Math.min(geometry.widthCm - item.widthCm, at.x - current.dx)),
                    ),
                    yCm: Math.round(
                      Math.max(0, Math.min(geometry.heightCm - item.depthCm, at.y - current.dy)),
                    ),
                  }
                : item,
            ),
          )
        }}
        onPointerUp={() => {
          drag.current = null
        }}
        onPointerCancel={() => {
          drag.current = null
        }}
      >
        <title>Кухонные элементы</title>
        {geometry.rooms.map((room, index) => (
          <polygon
            // biome-ignore lint/suspicious/noArrayIndexKey: room order is fixed in this editor
            key={`${room.name}-${index}`}
            points={room.polygon.map((p) => `${p.xCm},${p.yCm}`).join(' ')}
            fill="var(--muted)"
            stroke="var(--ink-2)"
          />
        ))}
        {geometry.walls.map((wall) => (
          <line
            key={wall.id}
            x1={wall.start.xCm}
            y1={wall.start.yCm}
            x2={wall.end.xCm}
            y2={wall.end.yCm}
            stroke="var(--ink)"
            strokeWidth={3}
          />
        ))}
        {items.map((item, index) => (
          <g
            key={item.id}
            onPointerDown={(event) => {
              const at = point(event.clientX, event.clientY)
              if (!at) return
              event.preventDefault()
              setSelectedId(item.id)
              drag.current = {
                id: item.id,
                dx: at.x - item.xCm,
                dy: at.y - item.yCm,
                pointerId: event.pointerId,
              }
              svg.current?.setPointerCapture(event.pointerId)
            }}
            className="cursor-grab"
          >
            <rect
              x={item.xCm}
              y={item.yCm}
              width={item.widthCm}
              height={item.depthCm}
              fill="var(--accent-tint)"
              stroke={item.id === selectedId ? 'var(--accent)' : 'var(--ink-2)'}
              strokeWidth={item.id === selectedId ? 4 : 2}
            />
            <text
              x={item.xCm + item.widthCm / 2}
              y={item.yCm + item.depthCm / 2}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={16}
              fill="var(--ink)"
            >
              {index + 1}
            </text>
          </g>
        ))}
      </svg>
      {items.length > 0 ? (
        <label className="mt-3 block text-sm">
          Элемент кухни
          <select
            value={selectedId ?? ''}
            onChange={(event) => setSelectedId(event.target.value)}
            className="mt-1 block w-full border border-control bg-paper p-2"
          >
            <option value="">Выберите элемент</option>
            {items.map((item, index) => (
              <option key={item.id} value={item.id}>
                {index + 1}. {kitchenLabels[item.kind]} · {item.widthCm} × {item.depthCm} см
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {selected ? (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(['xCm', 'yCm', 'widthCm', 'depthCm'] as const).map((field) => (
            <label key={field} className="text-sm">
              {
                {
                  xCm: 'Слева, см',
                  yCm: 'Сверху, см',
                  widthCm: 'Ширина, см',
                  depthCm: 'Глубина, см',
                }[field]
              }
              <input
                type="number"
                min={field === 'xCm' || field === 'yCm' ? 0 : 10}
                max={field === 'xCm' || field === 'yCm' ? 10000 : 600}
                value={selected[field]}
                onChange={(event) => {
                  const value = event.currentTarget.valueAsNumber
                  if (Number.isFinite(value)) patch({ [field]: value })
                }}
                className="mt-1 w-full border border-control bg-paper p-2"
              />
            </label>
          ))}
          <button
            type="button"
            onClick={() => patch({ widthCm: selected.depthCm, depthCm: selected.widthCm })}
            className="border border-control p-2 text-sm"
          >
            Повернуть на 90°
          </button>
          <button
            type="button"
            onClick={() => {
              onChange(items.filter((item) => item.id !== selectedId))
              setSelectedId(undefined)
            }}
            className="border border-control p-2 text-sm"
          >
            Удалить элемент
          </button>
        </div>
      ) : null}
      {issues.length > 0 ? (
        <ul className="mt-3 text-sm text-danger" aria-live="polite">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}
      <p className="mt-3 text-xs text-ink-2">
        Проверяются пересечения модулей и границы полотна. Стены, проёмы и открывание техники пока
        требуют проверки по плану. Расстановка сохраняется кнопкой подтверждения схемы.
      </p>
    </section>
  )
}
