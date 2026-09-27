// biome-ignore-all lint/suspicious/noArrayIndexKey: ordered source points retain their field identity
'use client'

import { Button, inputClassName } from '@uyut/ui'
import { useId, useState } from 'react'
import {
  finiteContourPoint,
  nativeContourPoint,
  type PageContourPoint,
} from './plan-page-contour-editor-model'

/** Shared coordinate editing for a room boundary, a two-ended opening or an obstacle. */
export function PlanPagePointControls({
  points,
  closed,
  opening,
  locked,
  canDraw,
  nativePoints,
  onChange,
  onPropose,
  onError,
}: {
  points: PageContourPoint[]
  closed: boolean
  opening: boolean
  locked: boolean
  canDraw: boolean
  nativePoints: PageContourPoint[]
  onChange: (points: PageContourPoint[], closed?: boolean) => void
  onPropose: (point: PageContourPoint, index?: number) => void
  onError: (message: string) => void
}) {
  const id = useId()
  const [newX, setNewX] = useState('')
  const [newY, setNewY] = useState('')

  function addCoordinates() {
    const point = { x: Number(newX), y: Number(newY) }
    if (newX.trim() === '' || newY.trim() === '' || !finiteContourPoint(point)) {
      onError('Введите обе координаты от 0 до 1000.')
      return
    }
    onPropose(point)
    setNewX('')
    setNewY('')
  }

  return (
    <div className="space-y-3">
      <p className="text-sm">
        {points.length} {opening ? 'конца проёма из 2' : 'вершин'} ·{' '}
        {opening
          ? closed
            ? 'концы отмечены'
            : 'разметка в работе'
          : closed
            ? 'контур замкнут'
            : 'контур в работе'}
      </p>
      <div className="flex flex-wrap gap-2">
        {!opening ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={locked || points.length < 3 || !points.every(finiteContourPoint) || closed}
            onClick={() => onChange(points, true)}
          >
            Замкнуть контур
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          disabled={locked || points.length === 0}
          onClick={() => onChange(points.slice(0, -1), false)}
        >
          {opening ? 'Убрать последний конец' : 'Убрать последнюю вершину'}
        </Button>
      </div>
      {points.length ? (
        <ol className="max-h-64 space-y-2 overflow-y-auto border-l border-line pl-3">
          {points.map((point, index) => (
            <li key={index} className="flex flex-wrap items-center gap-2">
              <span className="w-6 text-xs text-ink-2">{index + 1}.</span>
              {(['x', 'y'] as const).map((axis) => (
                <label
                  key={axis}
                  htmlFor={`${id}-${index}-${axis}`}
                  className="flex items-center gap-2 text-xs uppercase text-ink-2"
                >
                  {axis}
                  <input
                    id={`${id}-${index}-${axis}`}
                    className={`${inputClassName} h-9 w-24`}
                    type="number"
                    min={0}
                    max={1000}
                    step="any"
                    value={Number.isFinite(point[axis]) ? point[axis] : ''}
                    disabled={locked}
                    aria-label={`${opening ? 'Конец проёма' : 'Вершина'} ${index + 1}, координата ${axis.toUpperCase()}`}
                    onChange={(event) =>
                      onChange(
                        points.map((item, at) =>
                          at === index
                            ? {
                                ...item,
                                [axis]:
                                  event.target.value === ''
                                    ? Number.NaN
                                    : Number(event.target.value),
                              }
                            : item,
                        ),
                        closed,
                      )
                    }
                  />
                </label>
              ))}
              <Button
                size="sm"
                variant="ghost"
                disabled={locked || !finiteContourPoint(point)}
                onClick={() => onPropose(point, index)}
              >
                {nativeContourPoint(point, nativePoints) ? 'Узел PDF' : 'Привязать вершину'}
              </Button>
            </li>
          ))}
        </ol>
      ) : null}
      <div className="flex flex-wrap items-end gap-2">
        <label htmlFor={`${id}-new-x`} className="space-y-1 text-xs text-ink-2">
          <span className="block">{opening ? 'Конец проёма' : 'Новая вершина'} · X</span>
          <input
            id={`${id}-new-x`}
            className={`${inputClassName} h-9 w-28`}
            type="number"
            min={0}
            max={1000}
            step={0.1}
            value={newX}
            disabled={!canDraw}
            onChange={(event) => setNewX(event.target.value)}
          />
        </label>
        <label htmlFor={`${id}-new-y`} className="space-y-1 text-xs text-ink-2">
          <span className="block">Y</span>
          <input
            id={`${id}-new-y`}
            className={`${inputClassName} h-9 w-28`}
            type="number"
            min={0}
            max={1000}
            step={0.1}
            value={newY}
            disabled={!canDraw}
            onChange={(event) => setNewY(event.target.value)}
          />
        </label>
        <Button size="sm" variant="secondary" disabled={!canDraw} onClick={addCoordinates}>
          Добавить по координатам
        </Button>
      </div>
    </div>
  )
}
