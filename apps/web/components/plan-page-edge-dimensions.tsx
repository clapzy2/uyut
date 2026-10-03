'use client'

import type { PlanPageDimensionEdge } from '@uyut/db'
import { Button, inputClassName } from '@uyut/ui'
import { useState } from 'react'
import type { PageContourDraft, PageDimensionLabel } from './plan-page-contour-editor-model'

/** Выбор существующих подписей; это не форма ввода предполагаемой длины стены. */
export function PlanPageEdgeDimensions({
  draft,
  labels,
  locked,
  onChange,
  onHighlight,
}: {
  draft: PageContourDraft
  labels: PageDimensionLabel[]
  locked: boolean
  onChange: (edges: PlanPageDimensionEdge[]) => void
  onHighlight: (edge: number | undefined, indexes: number[]) => void
}) {
  const [edgeIndex, setEdgeIndex] = useState(0)
  const [indexes, setIndexes] = useState<number[]>(() => [
    ...(draft.dimensionEdges?.find((edge) => edge.wallEdgeIndex === 0)?.labelIndexes ?? []),
  ])
  const [filter, setFilter] = useState('')
  const edges = draft.dimensionEdges ?? []
  const occupied =
    draft.conditionalEdges?.some((edge) => edge.wallEdgeIndex === edgeIndex) ||
    draft.openings?.some((opening) => opening.wallEdgeIndex === edgeIndex)
  const visible = labels.filter((label) =>
    label.text.replaceAll(' ', '').includes(filter.replaceAll(' ', '')),
  )
  function selectEdge(next: number) {
    const selected = edges.find((edge) => edge.wallEdgeIndex === next)?.labelIndexes ?? []
    setEdgeIndex(next)
    setIndexes([...selected])
    onHighlight(next, selected)
  }
  return (
    <fieldset disabled={locked} className="space-y-3 border-t border-line pt-4">
      <legend className="text-sm font-medium text-ink">Подписанные стороны для масштаба</legend>
      <p className="max-w-2xl text-xs leading-relaxed text-ink-2">
        Укажите сторону и выберите все подписи её размерной цепочки. Выбор подсвечивается на листе.
        Проверим всю грань и связь обоих концов размера с её углами по линиям PDF. Цифры не станут
        шириной комнаты. Для переноса нужны две стороны в разных направлениях. Стороны с проёмами
        уточняются отдельно.
      </p>
      <label className="block text-sm">
        Сторона комнаты
        <select
          className={`${inputClassName} mt-1`}
          value={edgeIndex}
          onChange={(event) => selectEdge(Number(event.target.value))}
        >
          {draft.polygon.map((point, index) => (
            <option key={`${point.x}:${point.y}`} value={index}>
              Сторона {index + 1}
              {edges.some((edge) => edge.wallEdgeIndex === index) ? ' · выбрана' : ''}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        Найти подпись на листе
        <input
          className={`${inputClassName} mt-1`}
          inputMode="numeric"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Например, 3000"
        />
      </label>
      <div className="max-h-48 overflow-y-auto border-y border-line">
        {visible.slice(0, 100).map((label) => (
          <label key={label.index} className="flex min-h-11 items-center gap-3 px-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-accent"
              checked={indexes.includes(label.index)}
              disabled={
                locked || occupied || (!indexes.includes(label.index) && indexes.length >= 20)
              }
              onChange={(event) => {
                const next = event.target.checked
                  ? [...indexes, label.index]
                  : indexes.filter((index) => index !== label.index)
                setIndexes(next)
                onHighlight(edgeIndex, next)
              }}
            />
            <span>
              {label.text} мм <span className="text-xs text-ink-2">· метка {label.index + 1}</span>
            </span>
          </label>
        ))}
        {!visible.length ? (
          <p className="py-3 text-xs text-ink-2">Таких подписей на листе нет.</p>
        ) : null}
      </div>
      {visible.length > 100 ? (
        <p className="text-xs text-ink-2">Показаны первые 100 подписей. Уточните число в поиске.</p>
      ) : null}
      {occupied ? (
        <p className="text-xs text-ink-2">
          Выберите непрерывную стену без проёма и условной границы.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={
            locked ||
            occupied ||
            !indexes.length ||
            (edges.length >= 12 && !edges.some((edge) => edge.wallEdgeIndex === edgeIndex))
          }
          onClick={() => {
            onChange([
              ...edges.filter((edge) => edge.wallEdgeIndex !== edgeIndex),
              { wallEdgeIndex: edgeIndex, labelIndexes: [...indexes] },
            ])
            onHighlight(edgeIndex, indexes)
          }}
        >
          Выбрать подписи стороны
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={locked || !edges.some((edge) => edge.wallEdgeIndex === edgeIndex)}
          onClick={() => {
            onChange(edges.filter((edge) => edge.wallEdgeIndex !== edgeIndex))
            setIndexes([])
            onHighlight(undefined, [])
          }}
        >
          Убрать выбор стороны
        </Button>
      </div>
      <p className="text-xs text-ink-2" role="status">
        Выбрано сторон: {edges.length}. Связь с линиями проверяется при сохранении разметки.
      </p>
    </fieldset>
  )
}
