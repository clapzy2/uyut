// biome-ignore-all lint/suspicious/noArrayIndexKey: vertices are ordered and only appended or removed from the end
'use client'

import type { PlanImageCalibration, PlanPoint } from '@uyut/db'
import { Button, Input } from '@uyut/ui'
import { useState } from 'react'
import {
  planImageConfirmationIssue,
  validPlanImageCalibration,
} from '@/lib/projects/plan-image-calibration'
import {
  type ImageContourPoint,
  imageContourFromMetric,
  traceImageContour,
} from '@/lib/projects/plan-image-contour'

export function PlanImageContourTrace({
  planUrl,
  calibration,
  points,
  widthCm,
  heightCm,
  maxPoints,
  label,
  onChange,
}: {
  planUrl: string
  calibration: PlanImageCalibration
  points: PlanPoint[] | undefined
  widthCm: number
  heightCm: number
  maxPoints: number
  label: string
  onChange: (points: PlanPoint[]) => void
}) {
  const [tracing, setTracing] = useState(false)
  const [vertices, setVertices] = useState<ImageContourPoint[]>([])
  const [imageMatches, setImageMatches] = useState(false)
  const [error, setError] = useState<string>()
  const calibrationIssue = !validPlanImageCalibration(calibration, widthCm, heightCm)
    ? 'Проверьте калибровку изображения и размеры полотна.'
    : planImageConfirmationIssue(calibration)
  const displayed = tracing
    ? vertices
    : calibrationIssue
      ? []
      : imageContourFromMetric(points ?? [], calibration)

  function start() {
    setVertices([])
    setTracing(true)
    setError(undefined)
  }

  function apply() {
    const result = traceImageContour(vertices, calibration, widthCm, heightCm, maxPoints)
    if (!result || !imageMatches) {
      setError(
        'Контур не применён: проверьте масштаб, минимум три разных угла, пересечения и границы полотна.',
      )
      return
    }
    onChange(result)
    setTracing(false)
    setError(undefined)
  }

  return (
    <details className="my-4 border border-line p-3">
      <summary className="cursor-pointer text-[14px]">Обвести на исходнике · {label}</summary>
      <p className="my-3 text-[13px] text-ink-2">
        Отмечайте углы внутренней границы по порядку, включая диагональ. Первая точка не
        повторяется. Общий пол и пол балкона как комнаты обводятся отдельно. Стены и проёмы не
        создаются; результат попадёт только в черновик редактора.
      </p>
      <div className="relative inline-block max-w-full">
        <button
          type="button"
          aria-label={`Добавить угол контура: ${label}`}
          disabled={
            !tracing || !imageMatches || Boolean(calibrationIssue) || vertices.length >= maxPoints
          }
          className="block max-w-full disabled:cursor-default"
          onClick={(event) => {
            if (event.detail === 0) return
            const image = event.currentTarget.querySelector('img')
            if (!image) return
            const rect = image.getBoundingClientRect()
            if (!rect.width || !rect.height) return
            const point = {
              x: ((event.clientX - rect.left) * image.naturalWidth) / rect.width,
              y: ((event.clientY - rect.top) * image.naturalHeight) / rect.height,
            }
            setVertices((current) => [...current, point])
            setError(undefined)
          }}
        >
          {/* biome-ignore lint/performance/noImgElement: signed source image preserves original coordinates */}
          <img
            src={planUrl}
            alt={`Исходник для обводки: ${label}`}
            className="block max-h-[32rem] max-w-full"
            onLoad={(event) =>
              setImageMatches(
                event.currentTarget.naturalWidth === calibration.imageWidthPx &&
                  event.currentTarget.naturalHeight === calibration.imageHeightPx,
              )
            }
            onError={() => setImageMatches(false)}
          />
        </button>
        <svg
          aria-hidden="true"
          viewBox={`0 0 ${calibration.imageWidthPx} ${calibration.imageHeightPx}`}
          className="pointer-events-none absolute inset-0 h-full w-full"
        >
          <polyline
            points={displayed.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke="#ca4766"
            strokeWidth="3"
          />
          {!tracing && displayed.length >= 3 ? (
            <line
              x1={displayed.at(-1)?.x}
              y1={displayed.at(-1)?.y}
              x2={displayed[0]?.x}
              y2={displayed[0]?.y}
              stroke="#ca4766"
              strokeWidth="3"
            />
          ) : null}
          {displayed.map((p, index) => (
            <circle key={`${index}-${p.x}-${p.y}`} cx={p.x} cy={p.y} r="5" fill="#ca4766" />
          ))}
        </svg>
      </div>
      {calibrationIssue ? <p className="my-2 text-[13px] text-accent">{calibrationIssue}</p> : null}
      {!imageMatches ? (
        <p className="my-2 text-[13px] text-ink-2">
          Изображение должно загрузиться с теми же размерами, что при калибровке.
        </p>
      ) : null}
      {!tracing ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={!imageMatches || Boolean(calibrationIssue)}
          onClick={start}
        >
          Начать новую обводку
        </Button>
      ) : (
        <>
          <p className="my-2 text-[13px]">
            Углов: {vertices.length} / {maxPoints}. Замыкание — только при применении.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={vertices.length === 0}
              onClick={() => setVertices((current) => current.slice(0, -1))}
            >
              Убрать последний угол
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={vertices.length >= maxPoints}
              onClick={() => setVertices((current) => [...current, { x: 0, y: 0 }])}
            >
              Добавить угол числом
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={vertices.length < 3 || !imageMatches || Boolean(calibrationIssue)}
              onClick={apply}
            >
              Применить обводку в черновик
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setTracing(false)
                setError(undefined)
              }}
            >
              Отменить обводку
            </Button>
          </div>
          {vertices.map((p, index) => (
            <div key={`${index}`} className="mt-2 grid grid-cols-2 gap-2">
              {(['x', 'y'] as const).map((axis) => (
                <Input
                  key={axis}
                  id={`trace-${index}-${axis}`}
                  label={`Угол ${index + 1} · ${axis.toUpperCase()}, пикс.`}
                  type="number"
                  min="0"
                  max={axis === 'x' ? calibration.imageWidthPx : calibration.imageHeightPx}
                  step="0.1"
                  value={p[axis]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value)
                    setVertices((current) =>
                      current.map((point, at) =>
                        at === index ? { ...point, [axis]: value } : point,
                      ),
                    )
                  }}
                />
              ))}
            </div>
          ))}
        </>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-[13px] text-danger">
          {error}
        </p>
      ) : null}
    </details>
  )
}
