'use client'

import type { PlanImageCalibration } from '@uyut/db'
import { Button, Input } from '@uyut/ui'
import { type Dispatch, type SetStateAction, useState } from 'react'
import { PlanImageVerification } from '@/components/plan-image-verification'
import { validPlanImageCalibration } from '@/lib/projects/plan-image-calibration'

export type PlanUnderlay = {
  url: string
  opacity: number
  scale: number
  xCm: number
  yCm: number
  calibration?: PlanImageCalibration
}

type PixelPoint = PlanImageCalibration['pixelStart']

export function PlanImageReference({
  planUrl,
  planIsPdf,
  canvasWidthCm,
  canvasHeightCm,
  underlay,
  onUnderlayChange,
  calibration,
  onCalibrationChange,
}: {
  planUrl: string
  planIsPdf: boolean
  canvasWidthCm: number
  canvasHeightCm: number
  underlay: PlanUnderlay | undefined
  onUnderlayChange: Dispatch<SetStateAction<PlanUnderlay | undefined>>
  calibration: PlanImageCalibration | undefined
  onCalibrationChange: (value: PlanImageCalibration | undefined) => void
}) {
  const [imageSize, setImageSize] = useState<{ width: number; height: number }>()
  const [points, setPoints] = useState<PixelPoint[]>(
    calibration ? [calibration.pixelStart, calibration.pixelEnd] : [],
  )
  const [lengthCm, setLengthCm] = useState(String(calibration?.lengthCm ?? ''))
  const [worldX, setWorldX] = useState(String(calibration?.worldStart.xCm ?? 0))
  const [worldY, setWorldY] = useState(String(calibration?.worldStart.yCm ?? 0))
  const [direction, setDirection] = useState<PlanImageCalibration['direction']>(
    calibration?.direction ?? 'right',
  )
  const [error, setError] = useState<string>()
  const [checkPoints, setCheckPoints] = useState<PixelPoint[]>([])
  const [selectingCheck, setSelectingCheck] = useState(false)

  function clearCalibration() {
    onCalibrationChange(undefined)
    onUnderlayChange((current) => (current ? { ...current, calibration: undefined } : undefined))
    setSelectingCheck(false)
    setCheckPoints([])
  }

  function choosePoint(event: React.MouseEvent<HTMLButtonElement>) {
    if (event.detail === 0) return // Клавиатура использует поля координат ниже.
    const image = event.currentTarget.querySelector('img')
    if (!image) return
    const rect = image.getBoundingClientRect()
    if (!image.naturalWidth || !image.naturalHeight || !rect.width || !rect.height) return
    const point = {
      x: Math.round(((event.clientX - rect.left) / rect.width) * image.naturalWidth),
      y: Math.round(((event.clientY - rect.top) / rect.height) * image.naturalHeight),
    }
    if (selectingCheck) {
      setCheckPoints((current) => (current.length >= 2 ? [point] : [...current, point]))
    } else {
      setPoints((current) => (current.length >= 2 ? [point] : [...current, point]))
      clearCalibration()
    }
    setError(undefined)
  }

  function updatePoint(index: number, coordinate: 'x' | 'y', value: string) {
    const parsed = Number(value)
    setPoints((current) =>
      current.map((point, at) => (at === index ? { ...point, [coordinate]: parsed } : point)),
    )
    clearCalibration()
  }

  function applyCalibration() {
    const start = points[0]
    const end = points[1]
    if (!imageSize || !start || !end) {
      setError('Отметьте две точки размерной линии на изображении.')
      return
    }
    const candidate: PlanImageCalibration = {
      imageWidthPx: imageSize.width,
      imageHeightPx: imageSize.height,
      pixelStart: start,
      pixelEnd: end,
      worldStart: { xCm: Number(worldX), yCm: Number(worldY) },
      lengthCm: Number(lengthCm),
      direction,
      ...(calibration?.verificationLines
        ? { verificationLines: calibration.verificationLines }
        : {}),
    }
    if (!validPlanImageCalibration(candidate, canvasWidthCm, canvasHeightCm)) {
      setError('Проверьте длину и точки: оба конца должны лежать внутри схемы.')
      return
    }
    onCalibrationChange(candidate)
    onUnderlayChange((current) => ({
      url: planUrl,
      opacity: current?.opacity ?? 0.35,
      scale: 1,
      xCm: 0,
      yCm: 0,
      calibration: candidate,
    }))
    setError(undefined)
  }

  return (
    <div className="mb-5 border border-line bg-muted p-3 sm:p-4">
      <p className="mb-3 text-[12px] font-medium uppercase tracking-[0.1em] text-ink-2">
        Оригинал для сверки
      </p>
      {planIsPdf ? (
        <iframe
          src={planUrl}
          title="Исходный план квартиры"
          className="h-64 w-full border border-line bg-paper sm:h-80"
        />
      ) : (
        <div className="text-center">
          <div className="relative inline-block max-w-full">
            <button
              type="button"
              onClick={choosePoint}
              aria-label="Отметить точку размерной линии на плане"
              className="block max-w-full"
            >
              {/* biome-ignore lint/performance/noImgElement: короткоживущая подписанная ссылка и исходное соотношение сторон */}
              <img
                src={planUrl}
                alt="Исходный план квартиры"
                className="block max-h-80 max-w-full cursor-crosshair border border-line bg-paper"
                onLoad={(event) => {
                  const { naturalWidth, naturalHeight } = event.currentTarget
                  setImageSize({ width: naturalWidth, height: naturalHeight })
                  if (
                    calibration &&
                    (calibration.imageWidthPx !== naturalWidth ||
                      calibration.imageHeightPx !== naturalHeight)
                  ) {
                    clearCalibration()
                    setPoints([])
                    setError('Размер изображения изменился. Отметьте размерную линию заново.')
                  }
                }}
              />
            </button>
            {imageSize
              ? points.map((point, index) => (
                  <span
                    key={index === 0 ? 'start' : 'end'}
                    style={{
                      left: `${(point.x / imageSize.width) * 100}%`,
                      top: `${(point.y / imageSize.height) * 100}%`,
                    }}
                    className="pointer-events-none absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-paper bg-accent text-[12px] font-bold text-paper shadow-md"
                  >
                    {index + 1}
                  </span>
                ))
              : null}
            {imageSize && selectingCheck
              ? checkPoints.map((point, index) => (
                  <span
                    key={index === 0 ? 'check-start' : 'check-end'}
                    style={{
                      left: `${(point.x / imageSize.width) * 100}%`,
                      top: `${(point.y / imageSize.height) * 100}%`,
                    }}
                    className="pointer-events-none absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-paper bg-ink text-[12px] font-bold text-paper shadow-md"
                  >
                    {index + 1}
                  </span>
                ))
              : null}
          </div>
        </div>
      )}
      {!planIsPdf ? (
        <div className="mt-4 space-y-4 text-left text-[13px] text-ink-2">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={Boolean(underlay)}
              onChange={(event) =>
                onUnderlayChange(
                  event.currentTarget.checked
                    ? {
                        url: planUrl,
                        opacity: 0.35,
                        scale: 1,
                        xCm: 0,
                        yCm: 0,
                        calibration,
                      }
                    : undefined,
                )
              }
              className="accent-accent"
            />
            Показать изображение под линиями
          </label>
          <p>
            Калибровка: нажмите на два конца подписанного размера на картинке. Первая точка должна
            соответствовать указанным X и Y на схеме. Порядок точек задаёт направление.
          </p>
          {imageSize && points.length < 2 ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setPoints((current) => [...current, { x: 0, y: 0 }])
                clearCalibration()
              }}
            >
              Добавить точку вручную
            </Button>
          ) : null}
          {points.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {points.map((point, index) => (
                <div key={index === 0 ? 'start' : 'end'} className="grid grid-cols-2 gap-2">
                  <Input
                    id={`plan-pixel-${index}-x`}
                    label={`Точка ${index + 1} · X, пикс.`}
                    type="number"
                    value={point.x}
                    onChange={(event) => updatePoint(index, 'x', event.currentTarget.value)}
                  />
                  <Input
                    id={`plan-pixel-${index}-y`}
                    label="Y, пикс."
                    type="number"
                    value={point.y}
                    onChange={(event) => updatePoint(index, 'y', event.currentTarget.value)}
                  />
                </div>
              ))}
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              id="plan-known-distance"
              label="Подписанный размер, см"
              type="number"
              min="20"
              max="5000"
              step="0.1"
              value={lengthCm}
              onChange={(event) => {
                setLengthCm(event.currentTarget.value)
                clearCalibration()
              }}
            />
            <label>
              Направление от первой точки
              <select
                value={direction}
                onChange={(event) => {
                  setDirection(event.currentTarget.value as PlanImageCalibration['direction'])
                  clearCalibration()
                }}
                className="mt-2 h-11 w-full border border-control bg-paper px-3 text-ink"
              >
                <option value="right">Вправо</option>
                <option value="left">Влево</option>
                <option value="down">Вниз</option>
                <option value="up">Вверх</option>
              </select>
            </label>
            <Input
              id="plan-world-start-x"
              label="Первая точка на схеме · X, см"
              type="number"
              value={worldX}
              onChange={(event) => {
                setWorldX(event.currentTarget.value)
                clearCalibration()
              }}
            />
            <Input
              id="plan-world-start-y"
              label="Y, см"
              type="number"
              value={worldY}
              onChange={(event) => {
                setWorldY(event.currentTarget.value)
                clearCalibration()
              }}
            />
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={applyCalibration}>
            Применить калибровку
          </Button>
          {calibration ? (
            <p className="text-ink">Подложка привязана по одной размерной линии.</p>
          ) : null}
          {calibration ? (
            <PlanImageVerification
              calibration={calibration}
              canvasWidthCm={canvasWidthCm}
              canvasHeightCm={canvasHeightCm}
              points={checkPoints}
              onPointsChange={setCheckPoints}
              selecting={selectingCheck}
              onSelectingChange={setSelectingCheck}
              onCalibrationChange={onCalibrationChange}
            />
          ) : null}
          {error ? (
            <p className="text-danger" role="alert">
              {error}
            </p>
          ) : null}
          {underlay ? (
            <label className="block">
              Видимость подложки · {Math.round(underlay.opacity * 100)}%
              <input
                type="range"
                min="0.1"
                max="0.8"
                step="0.05"
                value={underlay.opacity}
                onChange={(event) =>
                  onUnderlayChange((current) =>
                    current ? { ...current, opacity: Number(event.currentTarget.value) } : current,
                  )
                }
                className="mt-2 w-full accent-accent"
              />
            </label>
          ) : null}
          {underlay && !calibration ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label>
                Временный масштаб · {Math.round(underlay.scale * 100)}%
                <input
                  type="range"
                  min="0.5"
                  max="2"
                  step="0.05"
                  value={underlay.scale}
                  onChange={(event) =>
                    onUnderlayChange((current) =>
                      current ? { ...current, scale: Number(event.currentTarget.value) } : current,
                    )
                  }
                  className="mt-2 w-full accent-accent"
                />
              </label>
              <Input
                id="plan-underlay-x"
                label="Временный сдвиг X, см"
                type="number"
                value={underlay.xCm}
                onChange={(event) =>
                  onUnderlayChange((current) =>
                    current ? { ...current, xCm: Number(event.currentTarget.value) } : current,
                  )
                }
              />
              <Input
                id="plan-underlay-y"
                label="Временный сдвиг Y, см"
                type="number"
                value={underlay.yCm}
                onChange={(event) =>
                  onUnderlayChange((current) =>
                    current ? { ...current, yCm: Number(event.currentTarget.value) } : current,
                  )
                }
              />
            </div>
          ) : null}
          <p className="text-[12px] leading-relaxed">
            Одна линия задаёт масштаб, поворот и положение картинки, но не доказывает точность всего
            плана. Для мебели и ремонта проверяйте реальные размеры на месте.
          </p>
        </div>
      ) : (
        <p className="mt-3 text-[12px] text-ink-2">
          Для PDF доступен просмотр оригинала; подложка требует изображения.
        </p>
      )}
    </div>
  )
}
