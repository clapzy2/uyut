'use client'

import type { Dispatch, SetStateAction } from 'react'

type VolumeControlsProps = {
  angle: number
  tilt: number
  zoom: number
  section: boolean
  sectionHeight: number
  roomLayout: boolean
  setAngle: Dispatch<SetStateAction<number>>
  setTilt: Dispatch<SetStateAction<number>>
  setZoom: Dispatch<SetStateAction<number>>
  setSection: Dispatch<SetStateAction<boolean>>
  setSectionHeight: Dispatch<SetStateAction<number>>
  onReset: () => void
}

export function PlanVolumeControls({
  angle,
  tilt,
  zoom,
  section,
  sectionHeight,
  roomLayout,
  setAngle,
  setTilt,
  setZoom,
  setSection,
  setSectionHeight,
  onReset,
}: VolumeControlsProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border border-line bg-paper px-4 py-3">
      <p className="text-sm text-ink-2">Поворачивайте вид мышью или настройте камеру ниже.</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setAngle((value) => (value + 270) % 360)}
          className="border border-line-strong px-3 py-1 text-sm text-ink hover:border-accent"
          aria-label="Повернуть схему влево"
        >
          ↶ Влево
        </button>
        <button
          type="button"
          onClick={() => setAngle((value) => (value + 90) % 360)}
          className="border border-line-strong px-3 py-1 text-sm text-ink hover:border-accent"
          aria-label="Повернуть схему вправо"
        >
          Вправо ↷
        </button>
        <button
          type="button"
          onClick={onReset}
          className="border border-line-strong px-3 py-1 text-sm text-ink hover:border-accent"
        >
          Исходный вид
        </button>
      </div>
      <div className="flex w-full flex-wrap gap-x-6 gap-y-3 border-t border-line pt-3">
        <label className="flex flex-col gap-1 text-sm text-ink-2">
          Поворот · {Math.round(angle)}°
          <input
            type="range"
            min="0"
            max="360"
            step="1"
            value={angle}
            onChange={(event) => setAngle(Number(event.currentTarget.value))}
            aria-label="Поворот камеры, градусы"
            className="accent-accent"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink-2">
          Наклон · {Math.round(tilt)}°
          <input
            type="range"
            min="15"
            max="80"
            step="1"
            value={tilt}
            onChange={(event) => setTilt(Number(event.currentTarget.value))}
            aria-label="Наклон камеры, градусы"
            className="accent-accent"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink-2">
          Приближение · {Math.round(zoom * 100)}%
          <input
            type="range"
            min="1"
            max="3"
            step="0.1"
            value={zoom}
            onChange={(event) => setZoom(Number(event.currentTarget.value))}
            aria-label="Приближение камеры"
            className="accent-accent"
          />
        </label>
      </div>
      {!roomLayout ? (
        <div className="flex w-full flex-wrap items-center gap-4 border-t border-line pt-3">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={section}
              onChange={(event) => setSection(event.currentTarget.checked)}
              className="accent-accent"
            />
            Открыть обзор комнат
          </label>
          {section ? (
            <label className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
              Срез на высоте {sectionHeight} см
              <input
                type="range"
                min="20"
                max="300"
                step="10"
                value={sectionHeight}
                onChange={(event) => setSectionHeight(Number(event.currentTarget.value))}
                aria-label="Высота среза стен, см"
                className="accent-accent"
              />
            </label>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
