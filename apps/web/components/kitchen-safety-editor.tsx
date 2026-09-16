'use client'

import type { PlanGeometry, PlanOpening, PlanUtilityPoint } from '@uyut/db'
import { utilityLabels } from '@/lib/projects/kitchen-safety'

export function KitchenSafetyEditor({
  geometry,
  points,
  onPointsChange,
  onOpeningsChange,
  onRouteWidthChange,
  onRouteStartChange,
}: {
  geometry: PlanGeometry
  points: PlanUtilityPoint[]
  onPointsChange: (points: PlanUtilityPoint[]) => void
  onOpeningsChange: (openings: PlanOpening[]) => void
  onRouteWidthChange: (width: number | undefined) => void
  onRouteStartChange: (openingId: string | undefined) => void
}) {
  const routeDoorOptions = geometry.openings.filter((opening) => opening.type !== 'window')
  const automaticDoor =
    routeDoorOptions.filter((opening) => opening.clearance).length === 1
      ? routeDoorOptions.find((opening) => opening.clearance)?.id
      : undefined
  function add(kind: PlanUtilityPoint['kind']) {
    if (points.length >= 100) return
    onPointsChange([
      ...points,
      {
        id: crypto.randomUUID(),
        kind,
        xCm: Math.round(geometry.widthCm / 2),
        yCm: Math.round(geometry.heightCm / 2),
      },
    ])
  }
  function patch(id: string, update: Partial<PlanUtilityPoint>) {
    onPointsChange(points.map((point) => (point.id === id ? { ...point, ...update } : point)))
  }
  return (
    <section className="mt-4 border border-line p-3">
      <h4 className="font-serif text-lg">Проходы и инженерия</h4>
      <p className="mt-1 text-xs leading-relaxed text-ink-2">
        Точки и допустимые длины берутся из обмеров и инструкций. Сервис не назначает нормативы
        автоматически: пустое значение означает, что проверка ещё не готова.
      </p>
      <label className="mt-3 block text-sm">
        Минимальная ширина непрерывного маршрута, см
        <input
          type="number"
          min="40"
          max="200"
          step="any"
          value={geometry.routeWidthCm ?? ''}
          onChange={(event) => {
            const value = event.currentTarget.valueAsNumber
            onRouteWidthChange(Number.isFinite(value) ? value : undefined)
          }}
          className="mt-1 block w-full border border-control bg-paper p-2"
        />
      </label>
      <p className="mt-1 text-xs text-ink-2">
        Проверяется маршрут от выбранной двери к фасаду каждого модуля. Расчёт идёт по сетке, его
        шаг показывается рядом с результатом.
      </p>
      <label className="mt-3 block text-sm">
        Стартовая дверь маршрута
        <select
          value={geometry.routeStartOpeningId ?? automaticDoor ?? ''}
          onChange={(event) => onRouteStartChange(event.currentTarget.value || undefined)}
          className="mt-1 block w-full border border-control bg-paper p-2"
        >
          <option value="">Не выбрана</option>
          {routeDoorOptions.map((opening) => (
            <option key={opening.id} value={opening.id}>
              {opening.type === 'balcony' ? 'Балконный блок' : 'Дверь'} {opening.id} ·{' '}
              {opening.widthCm} см
            </option>
          ))}
        </select>
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        {(Object.keys(utilityLabels) as PlanUtilityPoint['kind'][]).map((kind) => (
          <button
            key={kind}
            type="button"
            disabled={points.length >= 100}
            onClick={() => add(kind)}
            className="border border-control px-3 py-2 text-sm disabled:opacity-50"
          >
            + {utilityLabels[kind]}
          </button>
        ))}
      </div>
      <div className="mt-3 space-y-3">
        {points.map((point, index) => (
          <fieldset key={point.id} className="border border-line p-3">
            <legend className="px-1 text-sm">
              {index + 1}. {utilityLabels[point.kind]}
            </legend>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(['xCm', 'yCm', 'reachCm', 'heightCm'] as const).map((field) => (
                <label key={field} className="text-xs">
                  {
                    {
                      xCm: 'X, см',
                      yCm: 'Y, см',
                      reachCm:
                        point.kind === 'radiator'
                          ? 'Свободный радиус, см'
                          : 'Длина подключения, см',
                      heightCm: 'Высота, см',
                    }[field]
                  }
                  <input
                    type="number"
                    min="0"
                    max={field === 'heightCm' ? 1000 : field === 'reachCm' ? 2000 : 10000}
                    step="any"
                    value={point[field] ?? ''}
                    onChange={(event) => {
                      const value = event.currentTarget.valueAsNumber
                      patch(point.id, { [field]: Number.isFinite(value) ? value : undefined })
                    }}
                    className="mt-1 w-full border border-control bg-paper p-2"
                  />
                </label>
              ))}
            </div>
            <button
              type="button"
              onClick={() =>
                onPointsChange(points.filter((candidate) => candidate.id !== point.id))
              }
              className="mt-3 text-xs underline underline-offset-4"
            >
              Удалить точку
            </button>
          </fieldset>
        ))}
      </div>
      {geometry.openings.some((opening) => opening.type === 'window') ? (
        <details className="mt-4 border-t border-line pt-3">
          <summary className="cursor-pointer text-sm">Высоты подоконников</summary>
          <div className="mt-3 space-y-3">
            {geometry.openings
              .filter((opening) => opening.type === 'window')
              .map((opening) => (
                <label key={opening.id} className="block text-sm">
                  Окно {opening.id}: высота подоконника, см
                  <input
                    type="number"
                    min="1"
                    max="600"
                    step="any"
                    value={opening.sillHeightCm ?? ''}
                    onChange={(event) => {
                      const value = event.currentTarget.valueAsNumber
                      onOpeningsChange(
                        geometry.openings.map((candidate) =>
                          candidate.id === opening.id
                            ? {
                                ...candidate,
                                sillHeightCm: Number.isFinite(value) ? value : undefined,
                              }
                            : candidate,
                        ),
                      )
                    }}
                    className="mt-1 block w-full border border-control bg-paper p-2"
                  />
                </label>
              ))}
          </div>
        </details>
      ) : null}
    </section>
  )
}
