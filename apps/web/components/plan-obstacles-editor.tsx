'use client'

import type { PlanGeometry, PlanObstacle } from '@uyut/db'
import { Input } from '@uyut/ui'
import { type PointerEvent, useRef, useState } from 'react'
import { obstacleLabels, obstacleTitle } from '@/lib/projects/plan-obstacles'

function manualId() {
  return `manual_${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`
}

export function PlanObstaclesEditor({
  geometry,
  obstacles,
  onChange,
}: {
  geometry: Pick<PlanGeometry, 'widthCm' | 'heightCm' | 'walls' | 'rooms'>
  obstacles: PlanObstacle[]
  onChange: (obstacles: PlanObstacle[]) => void
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<{
    id: string
    pointerId: number
    offsetX: number
    offsetY: number
  } | null>(null)
  const [selectedId, setSelectedId] = useState<string>()
  const selected = obstacles.find((item) => item.id === selectedId)

  function point(event: PointerEvent<SVGElement>) {
    const matrix = svgRef.current?.getScreenCTM()
    if (!matrix) return null
    return new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
  }

  function add(kind: PlanObstacle['kind']) {
    if (obstacles.length >= 100) return
    const widthCm = kind === 'column' ? 30 : 60
    const depthCm = kind === 'column' ? 30 : 40
    const item: PlanObstacle = {
      id: manualId(),
      kind,
      xCm: Math.max(0, Math.round((geometry.widthCm - widthCm) / 2)),
      yCm: Math.max(0, Math.round((geometry.heightCm - depthCm) / 2)),
      widthCm,
      depthCm,
    }
    onChange([...obstacles, item])
    setSelectedId(item.id)
  }

  function patch(update: Partial<PlanObstacle>) {
    if (!selected) return
    onChange(
      obstacles.map((item) => {
        if (item.id !== selected.id) return item
        const next = { ...item, ...update }
        return {
          ...next,
          xCm: Math.max(0, Math.min(next.xCm, geometry.widthCm - next.widthCm)),
          yCm: Math.max(0, Math.min(next.yCm, geometry.heightCm - next.depthCm)),
        }
      }),
    )
  }

  function move(event: PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current
    const at = point(event)
    if (!drag || !at || drag.pointerId !== event.pointerId) return
    onChange(
      obstacles.map((item) =>
        item.id === drag.id
          ? {
              ...item,
              xCm: Math.round(
                Math.max(0, Math.min(geometry.widthCm - item.widthCm, at.x - drag.offsetX)),
              ),
              yCm: Math.round(
                Math.max(0, Math.min(geometry.heightCm - item.depthCm, at.y - drag.offsetY)),
              ),
            }
          : item,
      ),
    )
  }

  return (
    <section className="mt-6 border-t border-line pt-5">
      <h3 className="font-serif text-xl">Неподвижные препятствия</h3>
      <p className="my-3 text-sm leading-relaxed text-ink-2">
        Добавьте колонны, вентшахты, короба и другие элементы, которые нельзя перекрывать мебелью.
        Перетащите прямоугольник на плане, затем уточните размеры по обмеру.
      </p>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(obstacleLabels) as PlanObstacle['kind'][]).map((kind) => (
          <button
            key={kind}
            type="button"
            disabled={obstacles.length >= 100}
            onClick={() => add(kind)}
            className="rounded-sm border border-control px-3 py-2 text-sm transition-colors hover:border-ink disabled:opacity-50"
          >
            + {obstacleLabels[kind]}
          </button>
        ))}
      </div>

      <svg
        ref={svgRef}
        viewBox={`-10 -10 ${geometry.widthCm + 20} ${geometry.heightCm + 20}`}
        className="mt-4 max-h-96 w-full touch-none border border-line bg-paper"
        role="img"
        aria-label="Неподвижные препятствия на плане квартиры"
        onPointerMove={move}
        onPointerUp={() => {
          dragRef.current = null
        }}
        onPointerCancel={() => {
          dragRef.current = null
        }}
      >
        <title>Препятствия на плане</title>
        {geometry.rooms.map((room, index) => (
          <polygon
            // biome-ignore lint/suspicious/noArrayIndexKey: порядок контуров стабилен в редакторе
            key={`${room.name}-${index}`}
            points={room.polygon.map((vertex) => `${vertex.xCm},${vertex.yCm}`).join(' ')}
            fill="var(--muted)"
            stroke="none"
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
            strokeWidth={wall.kind === 'outer' ? 6 : 3}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {obstacles.map((item, index) => (
          // SVG has no native button element; the select and fields below are the keyboard fallback.
          // biome-ignore lint/a11y/useSemanticElements: interactive SVG drag handle
          <g
            key={item.id}
            role="button"
            tabIndex={0}
            aria-label={`Переместить: ${obstacleTitle(item)}`}
            className="cursor-grab focus:outline-none active:cursor-grabbing"
            onPointerDown={(event) => {
              const at = point(event)
              if (!at) return
              event.preventDefault()
              event.currentTarget.setPointerCapture(event.pointerId)
              setSelectedId(item.id)
              dragRef.current = {
                id: item.id,
                pointerId: event.pointerId,
                offsetX: at.x - item.xCm,
                offsetY: at.y - item.yCm,
              }
            }}
          >
            <rect
              x={item.xCm}
              y={item.yCm}
              width={item.widthCm}
              height={item.depthCm}
              rx="2"
              fill="var(--danger)"
              fillOpacity="0.16"
              stroke={selectedId === item.id ? 'var(--danger)' : 'var(--ink-2)'}
              strokeWidth={selectedId === item.id ? 3 : 1.5}
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={item.xCm + item.widthCm / 2}
              y={item.yCm + item.depthCm / 2}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize="13"
              fill="var(--ink)"
              pointerEvents="none"
            >
              {index + 1}
            </text>
          </g>
        ))}
      </svg>

      {obstacles.length > 0 ? (
        <label className="mt-3 block text-sm">
          Препятствие
          <select
            value={selectedId ?? ''}
            onChange={(event) => setSelectedId(event.currentTarget.value || undefined)}
            className="mt-1 block h-11 w-full border border-control bg-paper px-3"
          >
            <option value="">Выберите на плане</option>
            {obstacles.map((item, index) => (
              <option key={item.id} value={item.id}>
                {index + 1}. {obstacleTitle(item)} · {item.widthCm} × {item.depthCm} см
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {selected ? (
        <div className="mt-3 border border-line bg-muted p-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <label className="text-sm">
              Тип
              <select
                value={selected.kind}
                onChange={(event) =>
                  patch({ kind: event.currentTarget.value as PlanObstacle['kind'] })
                }
                className="mt-1 block h-11 w-full border border-control bg-paper px-2"
              >
                {(Object.keys(obstacleLabels) as PlanObstacle['kind'][]).map((kind) => (
                  <option key={kind} value={kind}>
                    {obstacleLabels[kind]}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm sm:col-span-2">
              Подпись
              <input
                value={selected.label ?? ''}
                maxLength={80}
                onChange={(event) => patch({ label: event.currentTarget.value || undefined })}
                className="mt-1 block h-11 w-full border border-control bg-paper px-3"
                placeholder={obstacleLabels[selected.kind]}
              />
            </label>
            {(['xCm', 'yCm', 'widthCm', 'depthCm'] as const).map((field) => (
              <Input
                key={field}
                id={`obstacle-${selected.id}-${field}`}
                label={
                  {
                    xCm: 'Слева, см',
                    yCm: 'Сверху, см',
                    widthCm: 'Ширина, см',
                    depthCm: 'Глубина, см',
                  }[field]
                }
                type="number"
                min={field === 'widthCm' || field === 'depthCm' ? 5 : 0}
                step="1"
                value={selected[field]}
                onChange={(event) => patch({ [field]: Number(event.currentTarget.value) })}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              onChange(obstacles.filter((item) => item.id !== selected.id))
              setSelectedId(undefined)
            }}
            className="mt-3 text-xs text-danger underline underline-offset-4"
          >
            Удалить препятствие
          </button>
        </div>
      ) : null}
    </section>
  )
}
