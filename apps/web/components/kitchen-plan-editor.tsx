'use client'

import type { PlanGeometry, PlanKitchenItem, PlanOpening, PlanUtilityPoint } from '@uyut/db'
import { useDeferredValue, useMemo, useRef, useState } from 'react'
import { KitchenSafetyEditor } from '@/components/kitchen-safety-editor'
import { inspectClearances, rotateKitchenItem } from '@/lib/projects/clearance-zones'
import { kitchenItemIssues, kitchenLabels } from '@/lib/projects/kitchen-items'
import { inspectRoutes, inspectUtilities, utilityLabels } from '@/lib/projects/kitchen-safety'

export function KitchenPlanEditor({
  geometry,
  items,
  onChange,
  onOpeningsChange,
  onUtilityPointsChange,
  onRouteWidthChange,
  onRouteStartChange,
}: {
  geometry: PlanGeometry
  items: PlanKitchenItem[]
  onChange: (items: PlanKitchenItem[]) => void
  onOpeningsChange: (openings: PlanOpening[]) => void
  onUtilityPointsChange: (points: PlanUtilityPoint[]) => void
  onRouteWidthChange: (width: number | undefined) => void
  onRouteStartChange: (openingId: string | undefined) => void
}) {
  const [selectedId, setSelectedId] = useState<string>()
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<{ id: string; dx: number; dy: number; pointerId: number } | null>(null)
  const selected = items.find((item) => item.id === selectedId)
  const issues = kitchenItemIssues(items, geometry.widthCm, geometry.heightCm, geometry)
  const clearance = inspectClearances(items, geometry)
  const deferredItems = useDeferredValue(items)
  const deferredGeometry = useDeferredValue(geometry)
  const utilities = inspectUtilities(items, geometry.utilityPoints ?? [], geometry)
  const routes = useMemo(
    () => inspectRoutes(deferredItems, deferredGeometry),
    [deferredItems, deferredGeometry],
  )
  const directions = { top: 'Сверху', right: 'Справа', bottom: 'Снизу', left: 'Слева' } as const
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
        секции. Мойка и плита обозначают целые секции гарнитура, а духовка и посудомоечная машина —
        отдельную технику со своим фасадом и подключениями. Элементы нельзя накладывать друг на
        друга. Это ручная схема, товары к элементам ещё не привязаны.
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
        {clearance.zones.map((zone) => (
          <polygon
            key={zone.id}
            points={zone.polygon.map((p) => `${p.xCm},${p.yCm}`).join(' ')}
            fill="var(--accent-tint)"
            fillOpacity={0.3}
            stroke="var(--accent)"
            strokeDasharray="6 4"
            pointerEvents="none"
          >
            <title>{zone.label}</title>
          </polygon>
        ))}
        {routes.paths.map((path, index) => (
          <polyline
            // biome-ignore lint/suspicious/noArrayIndexKey: paths follow stable module order
            key={index}
            points={path.map((point) => `${point.xCm},${point.yCm}`).join(' ')}
            fill="none"
            stroke="var(--success)"
            strokeWidth={Math.max(4, (geometry.routeWidthCm ?? 40) * 0.08)}
            strokeDasharray="8 5"
            pointerEvents="none"
          />
        ))}
        {(geometry.utilityPoints ?? []).map((utility, index) => (
          <g key={utility.id} pointerEvents="none">
            {utility.reachCm ? (
              <circle
                cx={utility.xCm}
                cy={utility.yCm}
                r={utility.reachCm}
                fill="var(--accent-tint)"
                fillOpacity={0.14}
                stroke="var(--accent)"
                strokeDasharray="4 4"
              />
            ) : null}
            <circle cx={utility.xCm} cy={utility.yCm} r={6} fill="var(--accent)" />
            <text x={utility.xCm + 9} y={utility.yCm - 7} fontSize={13} fill="var(--ink)">
              {index + 1}. {utilityLabels[utility.kind]}
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
          {(['xCm', 'yCm', 'widthCm', 'depthCm', 'heightCm'] as const).map((field) => (
            <label key={field} className="text-sm">
              {
                {
                  xCm: 'Слева, см',
                  yCm: 'Сверху, см',
                  widthCm: 'Ширина, см',
                  depthCm: 'Глубина, см',
                  heightCm: 'Высота, см',
                }[field]
              }
              <input
                type="number"
                step="any"
                min={field === 'xCm' || field === 'yCm' ? 0 : field === 'heightCm' ? 1 : 10}
                max={field === 'xCm' || field === 'yCm' ? 10000 : 600}
                value={selected[field] ?? ''}
                onChange={(event) => {
                  const value = event.currentTarget.valueAsNumber
                  patch({ [field]: Number.isFinite(value) ? value : undefined })
                }}
                className="mt-1 w-full border border-control bg-paper p-2"
              />
            </label>
          ))}
          <button
            type="button"
            onClick={() => patch(rotateKitchenItem(selected))}
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
      {selected ? (
        <fieldset className="mt-4 space-y-3 border border-line p-3">
          <legend className="px-1 text-sm">Открывание, проход и монтаж</legend>
          <p className="text-xs text-ink-2">
            Размеры берите из инструкции техники или замера. Пустое поле означает «неизвестно», 0 —
            явно заданное отсутствие запаса. Проход измеряется от края открытой дверцы.
          </p>
          <label className="block text-sm">
            Сторона фасада на схеме
            <select
              className="mt-1 block w-full border border-control bg-paper p-2"
              value={selected.front ?? ''}
              onChange={(e) =>
                patch({ front: (e.target.value || undefined) as PlanKitchenItem['front'] })
              }
            >
              <option value="">Не указана</option>
              {Object.entries(directions).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            {(['openingDepthCm', 'passageCm'] as const).map((field) => (
              <label className="text-sm" key={field}>
                {field === 'openingDepthCm' ? 'Вылет открытой дверцы, см' : 'Свободный проход, см'}
                <input
                  type="number"
                  step="any"
                  min="0"
                  max="600"
                  className="mt-1 w-full border border-control bg-paper p-2"
                  value={selected[field] ?? ''}
                  onChange={(e) => {
                    const v = e.currentTarget.valueAsNumber
                    patch({ [field]: Number.isFinite(v) ? v : undefined })
                  }}
                />
              </label>
            ))}
          </div>
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!selected.installationGaps}
              onChange={(e) =>
                patch({
                  installationGaps: e.target.checked
                    ? { top: 0, right: 0, bottom: 0, left: 0 }
                    : undefined,
                })
              }
            />
            Задать монтажные зазоры (начальные значения — 0, проверьте все четыре)
          </label>
          {selected.installationGaps ? (
            <div className="grid grid-cols-2 gap-3">
              {(Object.keys(directions) as Array<keyof typeof directions>).map((side) => (
                <label key={side} className="text-sm">
                  {directions[side]}, см
                  <input
                    type="number"
                    step="any"
                    min="0"
                    max="100"
                    value={selected.installationGaps?.[side] ?? 0}
                    className="mt-1 w-full border border-control bg-paper p-2"
                    onChange={(e) => {
                      const value = e.currentTarget.valueAsNumber
                      if (Number.isFinite(value) && selected.installationGaps)
                        patch({ installationGaps: { ...selected.installationGaps, [side]: value } })
                    }}
                  />
                </label>
              ))}
            </div>
          ) : null}
        </fieldset>
      ) : null}
      {geometry.openings.some((o) => o.type !== 'window') ? (
        <details className="mt-4 border border-line p-3">
          <summary className="cursor-pointer text-sm">Свободные зоны дверей</summary>
          <p className="my-2 text-xs text-ink-2">
            Сторона А — слева по направлению от начала стены к концу, Б — справа. Для распашной
            двери выберите петли и дугу 90°. Прямоугольный резерв оставлен для раздвижных дверей и
            случаев, когда нужна заведомо свободная зона. Проверьте штриховую область на схеме.
          </p>
          {geometry.openings
            .filter((o) => o.type !== 'window')
            .map((o) => (
              <fieldset key={o.id} className="my-3 space-y-2">
                <legend className="text-sm">Дверь {o.id}</legend>
                <label className="block text-sm">
                  Сторона
                  <select
                    value={o.clearance?.side ?? ''}
                    className="ml-2 border border-control bg-paper p-2"
                    onChange={(e) => {
                      const side = e.target.value as 'left' | 'right' | ''
                      onOpeningsChange(
                        geometry.openings.map((v) =>
                          v.id === o.id
                            ? {
                                ...v,
                                clearance: side
                                  ? {
                                      side,
                                      depthCm: o.clearance?.depthCm ?? o.widthCm,
                                      shape: o.clearance?.shape ?? 'swing',
                                      hinge: o.clearance?.hinge ?? 'start',
                                    }
                                  : undefined,
                              }
                            : v,
                        ),
                      )
                    }}
                  >
                    <option value="">Не задана</option>
                    <option value="left">А</option>
                    <option value="right">Б</option>
                  </select>
                </label>
                {o.clearance ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="text-sm">
                      Форма зоны
                      <select
                        value={o.clearance.shape ?? 'rectangle'}
                        className="mt-1 block w-full border border-control bg-paper p-2"
                        onChange={(event) => {
                          const current = o.clearance
                          if (current)
                            onOpeningsChange(
                              geometry.openings.map((candidate) =>
                                candidate.id === o.id
                                  ? {
                                      ...candidate,
                                      clearance: {
                                        ...current,
                                        shape: event.currentTarget.value as 'rectangle' | 'swing',
                                      },
                                    }
                                  : candidate,
                              ),
                            )
                        }}
                      >
                        <option value="swing">Дуга створки 90°</option>
                        <option value="rectangle">Прямоугольный резерв</option>
                      </select>
                    </label>
                    <label className="text-sm">
                      Петли
                      <select
                        value={o.clearance.hinge ?? 'start'}
                        disabled={(o.clearance.shape ?? 'rectangle') !== 'swing'}
                        className="mt-1 block w-full border border-control bg-paper p-2 disabled:opacity-50"
                        onChange={(event) => {
                          const current = o.clearance
                          if (current)
                            onOpeningsChange(
                              geometry.openings.map((candidate) =>
                                candidate.id === o.id
                                  ? {
                                      ...candidate,
                                      clearance: {
                                        ...current,
                                        hinge: event.currentTarget.value as 'start' | 'end',
                                      },
                                    }
                                  : candidate,
                              ),
                            )
                        }}
                      >
                        <option value="start">В начале проёма</option>
                        <option value="end">В конце проёма</option>
                      </select>
                    </label>
                    <label className="col-span-2 block text-sm">
                      {o.clearance.shape === 'swing' ? 'Длина створки' : 'Глубина резерва'}, см
                      <input
                        type="number"
                        min="0.1"
                        max="600"
                        step="any"
                        className="mt-1 w-full border border-control bg-paper p-2"
                        value={o.clearance.depthCm}
                        onChange={(e) => {
                          const depthCm = e.currentTarget.valueAsNumber
                          const current = o.clearance
                          if (Number.isFinite(depthCm) && current)
                            onOpeningsChange(
                              geometry.openings.map((v) =>
                                v.id === o.id ? { ...v, clearance: { ...current, depthCm } } : v,
                              ),
                            )
                        }}
                      />
                    </label>
                  </div>
                ) : null}
              </fieldset>
            ))}
        </details>
      ) : null}
      <KitchenSafetyEditor
        geometry={geometry}
        points={geometry.utilityPoints ?? []}
        onPointsChange={onUtilityPointsChange}
        onOpeningsChange={onOpeningsChange}
        onRouteWidthChange={onRouteWidthChange}
        onRouteStartChange={onRouteStartChange}
      />
      {routes.resolutionCm ? (
        <p className="mt-3 text-xs text-ink-2">
          Маршрут проверен с шагом сетки {routes.resolutionCm} см.
        </p>
      ) : null}
      {[...routes.issues, ...utilities.issues].length > 0 ? (
        <ul className="mt-3 text-sm text-danger" aria-live="polite">
          {[...routes.issues, ...utilities.issues].map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}
      {[...routes.missing, ...utilities.missing].length > 0 ? (
        <details className="mt-3 text-sm text-ink-2">
          <summary>
            Для полной проверки нужно уточнить: {[...routes.missing, ...utilities.missing].length}
          </summary>
          <ul>
            {[...routes.missing, ...utilities.missing].map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {clearance.issues.length > 0 ? (
        <ul className="mt-3 text-sm text-danger" aria-live="polite">
          {clearance.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}
      {clearance.missing.length > 0 ? (
        <details className="mt-3 text-sm text-ink-2">
          <summary>Нужно уточнить: {clearance.missing.length}</summary>
          <ul>
            {clearance.missing.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {issues.length > 0 ? (
        <ul className="mt-3 text-sm text-danger" aria-live="polite">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}
      <p className="mt-3 text-xs text-ink-2">
        Проверяются модули, контуры комнат, линии стен и проёмов по текущей схеме. Толщина стен,
        коммуникации, радиаторы, локальные проходы, монтажные зазоры и маршрут от двери по введённым
        данным. Дуга створки строится на 90°, если выбраны сторона и петли. Проверка не знает уклон
        канализации, электромощность, материал стен и требования конкретного производителя.
        Отсутствие предупреждений не гарантирует монтаж. Расстановка сохраняется кнопкой
        подтверждения схемы.
      </p>
    </section>
  )
}
