'use client'

import type { PlanGeometry } from '@uyut/db'
import { Button } from '@uyut/ui'
import { useState } from 'react'
import { inspectMetricClearanceRoutes } from '@/lib/projects/plan-metric-clearance-route'

export function PlanRouteCheck({ geometry }: { geometry: PlanGeometry }) {
  const snapshot = JSON.stringify(geometry)
  const [checked, setChecked] = useState<{
    snapshot: string
    inspection: ReturnType<typeof inspectMetricClearanceRoutes>
  }>()
  const [error, setError] = useState<string>()
  const current = checked?.snapshot === snapshot ? checked.inspection : undefined
  const routeStart = current?.result?.routes[0]?.points[0]
  function check() {
    setError(undefined)
    try {
      setChecked({ snapshot, inspection: inspectMetricClearanceRoutes(geometry) })
    } catch {
      setChecked(undefined)
      setError('Проверьте контуры и размеры: расчёт проходов не завершён.')
    }
  }
  return (
    <section className="mt-4 border-t border-line pt-4" aria-label="Проверка проходов">
      <h3 className="text-sm font-medium">Проходы между комнатами</h3>
      <p className="mt-2 text-sm text-ink-2">
        Проверка свободной квадратной зоны заданной ширины от внутренней площадки у выбранной двери.
        Учитываются стены, шахты, неподвижные объекты и заданные кухонные модули; зоны открывания
        проверяются отдельно.
      </p>
      <Button type="button" variant="secondary" className="mt-3" onClick={check}>
        Проверить проходы
      </Button>
      <div className="mt-3 text-sm" aria-live="polite">
        {error ? <p>{error}</p> : null}
        {checked && !current ? (
          <p className="text-ink-2">
            Схема изменилась. Повторите проверку — прежние пути больше не показаны.
          </p>
        ) : null}
        {current?.missing ? <p className="text-ink-2">{current.missing}</p> : null}
        {current?.result ? (
          <>
            <p>
              Найденные пути: {current.result.routes.length} из {geometry.rooms.length}. Ширина:{' '}
              {current.result.widthCm} см.
            </p>
            {current.result.unresolvedRoomIds.length ? (
              <p className="mt-1 text-ink-2">
                Нужно проверить:{' '}
                {current.result.unresolvedRoomIds
                  .map((id) => geometry.rooms[Number(id)]?.name)
                  .join(', ')}
                . Отсутствие найденного пути не означает невозможность прохода.
              </p>
            ) : null}
            <svg
              className="mt-3 w-full border border-line bg-paper"
              viewBox={`0 0 ${geometry.widthCm} ${geometry.heightCm}`}
              role="img"
              aria-label="Найденные проходы на текущей схеме"
            >
              {geometry.rooms.map((room, index) => (
                <polygon
                  key={String(index)}
                  points={room.polygon.map((point) => `${point.xCm},${point.yCm}`).join(' ')}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                />
              ))}
              {[...(geometry.obstacles ?? []), ...(geometry.kitchenItems ?? [])].map((obstacle) => (
                <rect
                  key={`${'kind' in obstacle ? obstacle.kind : 'object'}-${obstacle.id}`}
                  x={obstacle.xCm}
                  y={obstacle.yCm}
                  width={obstacle.widthCm}
                  height={obstacle.depthCm}
                  fill="currentColor"
                  opacity="0.25"
                />
              ))}
              {(geometry.voids ?? []).map((region) => (
                <polygon
                  key={region.id}
                  points={region.polygon.map((point) => `${point.xCm},${point.yCm}`).join(' ')}
                  fill="currentColor"
                  opacity="0.25"
                />
              ))}
              {current.result.routes.map((route) => (
                <polyline
                  key={route.roomId}
                  points={route.points.map((point) => `${point.xCm},${point.yCm}`).join(' ')}
                  fill="none"
                  stroke="#247752"
                  strokeWidth="6"
                />
              ))}
              {routeStart ? (
                <g>
                  <title>Стартовая свободная зона</title>
                  <rect
                    x={routeStart.xCm - current.result.widthCm / 2}
                    y={routeStart.yCm - current.result.widthCm / 2}
                    width={current.result.widthCm}
                    height={current.result.widthCm}
                    fill="#247752"
                    fillOpacity="0.12"
                    stroke="#247752"
                    strokeWidth="2"
                    strokeDasharray="5 3"
                  />
                  <circle cx={routeStart.xCm} cy={routeStart.yCm} r="5" fill="#247752" />
                </g>
              ) : null}
            </svg>
            {routeStart ? (
              <p className="mt-1 text-xs text-ink-2">
                Пунктирный квадрат — стартовая свободная зона {current.result.widthCm}×
                {current.result.widthCm} см. Зелёные линии — найденные пути.
              </p>
            ) : null}
            <p className="mt-1 text-xs text-ink-2">
              Сетка поиска {current.result.stepCm} см. Это проверка конкретных путей, не всей
              площади комнат и не внешнего входа.
            </p>
          </>
        ) : null}
      </div>
    </section>
  )
}
