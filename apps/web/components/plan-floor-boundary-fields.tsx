'use client'

import type { PlanPoint, PlanWall } from '@uyut/db'
import { Button, Input } from '@uyut/ui'
import { floorBoundaryFromWalls } from '@/lib/projects/plan-floor-boundary'
import { addRoomContourPoint, removeRoomContourPoint } from '@/lib/projects/room-contour'

export function PlanFloorBoundaryFields({
  points,
  walls,
  widthCm,
  heightCm,
  onChange,
}: {
  points: PlanPoint[] | undefined
  walls: PlanWall[]
  widthCm: number
  heightCm: number
  onChange: (points: PlanPoint[] | undefined) => void
}) {
  const wallRing = floorBoundaryFromWalls(walls)
  return (
    <div className="space-y-4">
      <p className="text-[14px] leading-relaxed text-ink-2">
        Граница пола включает выступ балкона. Балконный блок остаётся проёмом в стене, а у балкона
        должен быть свой контур комнаты. Сверьте каждый угол на подложке; если исходник обрезан,
        сохраните черновик без подтверждения.
      </p>
      {!points ? (
        <>
          <Button
            type="button"
            variant="secondary"
            disabled={!wallRing}
            onClick={() => onChange(wallRing)}
          >
            Скопировать контур внешних стен
          </Button>
          <p className="text-[13px] text-ink-2">
            {wallRing
              ? 'Копия стен — заготовка. Уточните внутреннюю границу пола и выступ балкона.'
              : 'Сначала нанесите замкнутый контур внешних стен. Прямоугольник автоматически не подставляется.'}
          </p>
        </>
      ) : (
        <>
          {points.map((point, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: ordered vertices are the editable point identity
            <div key={`${index}`} className="grid grid-cols-[auto_1fr_1fr_auto] items-end gap-2">
              <span className="pb-3 font-mono text-[12px] text-ink-2">{index + 1}</span>
              {(['xCm', 'yCm'] as const).map((axis) => (
                <Input
                  key={axis}
                  id={`floor-point-${index}-${axis}`}
                  label={`${axis === 'xCm' ? 'X' : 'Y'}, см`}
                  type="number"
                  min="0"
                  max={axis === 'xCm' ? widthCm : heightCm}
                  step="0.1"
                  value={point[axis]}
                  onChange={(event) =>
                    onChange(
                      points.map((vertex, at) =>
                        at === index
                          ? { ...vertex, [axis]: Number(event.currentTarget.value) }
                          : vertex,
                      ),
                    )
                  }
                />
              ))}
              <button
                type="button"
                disabled={points.length <= 3}
                onClick={() => onChange(removeRoomContourPoint(points, index))}
                aria-label={`Удалить угол пола ${index + 1}`}
                className="mb-1 h-10 w-10 text-danger disabled:opacity-30"
              >
                ×
              </button>
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            disabled={points.length >= 200}
            onClick={() => onChange(addRoomContourPoint(points, 200))}
          >
            Добавить угол пола
          </Button>
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="block text-[13px] text-danger underline"
          >
            Убрать границу пола из черновика
          </button>
        </>
      )}
    </div>
  )
}
