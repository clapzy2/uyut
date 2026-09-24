'use client'

import type { PlanImageCalibration, PlanImageDimensionLine } from '@uyut/db'
import { Button, Input } from '@uyut/ui'
import { type Dispatch, type SetStateAction, useState } from 'react'
import {
  planImageScaleCheck,
  planImageScaleCoverage,
  validPlanImageCalibration,
} from '@/lib/projects/plan-image-calibration'

type PixelPoint = PlanImageDimensionLine['pixelStart']

export function PlanImageVerification({
  calibration,
  canvasWidthCm,
  canvasHeightCm,
  points,
  onPointsChange,
  selecting,
  onSelectingChange,
  onCalibrationChange,
}: {
  calibration: PlanImageCalibration
  canvasWidthCm: number
  canvasHeightCm: number
  points: PixelPoint[]
  onPointsChange: Dispatch<SetStateAction<PixelPoint[]>>
  selecting: boolean
  onSelectingChange: (value: boolean) => void
  onCalibrationChange: (value: PlanImageCalibration) => void
}) {
  const [lengthCm, setLengthCm] = useState('')
  const [error, setError] = useState<string>()
  const lines = calibration.verificationLines ?? []
  const coverage = planImageScaleCoverage(calibration)

  function updatePoint(index: number, coordinate: 'x' | 'y', value: string) {
    onPointsChange((current) =>
      current.map((point, at) =>
        at === index ? { ...point, [coordinate]: Number(value) } : point,
      ),
    )
  }

  function addLine() {
    const start = points[0]
    const end = points[1]
    if (!start || !end) {
      setError('Отметьте два конца ещё одной подписанной размерной линии.')
      return
    }
    const line: PlanImageDimensionLine = {
      pixelStart: start,
      pixelEnd: end,
      lengthCm: Number(lengthCm),
    }
    const updated = { ...calibration, verificationLines: [...lines, line] }
    if (!validPlanImageCalibration(updated, canvasWidthCm, canvasHeightCm)) {
      setError('Проверьте координаты и длину: размер должен быть от 20 до 5000 см.')
      return
    }
    onCalibrationChange(updated)
    onPointsChange([])
    onSelectingChange(false)
    setLengthCm('')
    setError(undefined)
  }

  return (
    <section className="border-t border-line pt-4">
      <p className="font-medium text-ink">Проверка другими размерами</p>
      <p className="mt-1 leading-relaxed">
        Выберите ещё размерную линию и введите подпись. Если она не сходится с первым масштабом,
        перепроверьте точки или исходный план — сервис не подгоняет чертёж автоматически. При
        изменении первой линии эти проверки нужно сделать заново.
      </p>
      {lines.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {lines.map((line, index) => {
            const result = planImageScaleCheck(calibration, line)
            return (
              <li
                key={JSON.stringify(line)}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 border border-line p-2"
              >
                <span className={result.consistent ? 'text-ink' : 'text-danger'}>
                  {line.lengthCm} см на плане · {result.measuredCm.toFixed(1)} см по подложке
                  {result.consistent ? ' — сходится' : ' — расхождение'}
                </span>
                <button
                  type="button"
                  className="underline underline-offset-4 hover:text-ink"
                  onClick={() =>
                    onCalibrationChange({
                      ...calibration,
                      verificationLines: lines.filter((_, at) => at !== index),
                    })
                  }
                >
                  Удалить
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
      {lines.length < 6 ? (
        selecting ? (
          <div className="mt-3 space-y-3">
            <p>
              Теперь нажмите два конца другой линии на изображении. Можно также ввести пиксели
              вручную.
            </p>
            {points.length < 2 ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => onPointsChange((current) => [...current, { x: 0, y: 0 }])}
              >
                Добавить точку вручную
              </Button>
            ) : null}
            {points.map((point, index) => (
              <div
                key={index === 0 ? 'check-start' : 'check-end'}
                className="grid grid-cols-2 gap-2"
              >
                <Input
                  id={`check-${index}-x`}
                  label={`Точка ${index + 1} · X, пикс.`}
                  type="number"
                  value={point.x}
                  onChange={(event) => updatePoint(index, 'x', event.currentTarget.value)}
                />
                <Input
                  id={`check-${index}-y`}
                  label="Y, пикс."
                  type="number"
                  value={point.y}
                  onChange={(event) => updatePoint(index, 'y', event.currentTarget.value)}
                />
              </div>
            ))}
            <Input
              id="check-length"
              label="Подписанный размер, см"
              type="number"
              min="20"
              max="5000"
              step="0.1"
              value={lengthCm}
              onChange={(event) => setLengthCm(event.currentTarget.value)}
            />
            {error ? (
              <p role="alert" className="text-danger">
                {error}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={addLine}>
                Сверить размер
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  onPointsChange([])
                  onSelectingChange(false)
                  setError(undefined)
                }}
              >
                Отмена
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-3"
            onClick={() => {
              onPointsChange([])
              onSelectingChange(true)
            }}
          >
            Проверить ещё размер
          </Button>
        )
      ) : null}
      {coverage.hasConflict ? (
        <p className="mt-3 text-danger" role="status">
          Масштаб не подтверждён всеми размерами. Не используйте эту подложку для точной расстановки
          мебели.
        </p>
      ) : coverage.hasSecondDirection ? (
        <p className="mt-3 text-ink" role="status">
          Размеры сошлись в двух направлениях. Это всё ещё не заменяет обмер на месте.
        </p>
      ) : (
        <p className="mt-3 text-ink-2" role="status">
          {coverage.checks === 0
            ? 'Пока проверена одна линия. Добавьте независимый размер поперёк неё.'
            : 'Размеры сходятся, но проверено только одно направление. Добавьте размер поперёк.'}
        </p>
      )}
    </section>
  )
}
