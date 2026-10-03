'use client'

import type { PlanPoint } from '@uyut/db'
import { useMemo, useState } from 'react'
import type { PlanVolume } from '@/lib/projects/plan-volume'

const VIEW_ANGLES = [0, 90, 180, 270] as const
const COS_30 = Math.sqrt(3) / 2
const SIN_30 = 0.5

type ScreenPoint = { x: number; y: number }

function projector(angle: number) {
  const radians = (angle * Math.PI) / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)

  return (point: PlanPoint, rise = 0): ScreenPoint => {
    const x = point.xCm * cosine - point.yCm * sine
    const y = point.xCm * sine + point.yCm * cosine
    return { x: (x - y) * COS_30, y: (x + y) * SIN_30 - rise }
  }
}

function polygonPoints(points: ScreenPoint[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(' ')
}

function pathRing(points: ScreenPoint[]): string {
  return `M ${points.map((point) => `${point.x} ${point.y}`).join(' L ')} Z`
}

export default function PlanVolumeViewer({ model }: { model: PlanVolume }) {
  const [angleIndex, setAngleIndex] = useState(0)
  const angle = VIEW_ANGLES[angleIndex] ?? 0
  const project = useMemo(() => projector(angle), [angle])

  // This rise is a drawing parameter, not a ceiling measurement or saved geometry.
  const xCoordinates = model.floor.map((point) => point.xCm)
  const yCoordinates = model.floor.map((point) => point.yCm)
  const illustrativeRise =
    Math.min(
      Math.max(...xCoordinates) - Math.min(...xCoordinates),
      Math.max(...yCoordinates) - Math.min(...yCoordinates),
    ) * 0.3
  const floor = model.floor.map((point) => project(point))
  const voids = model.voids.map((polygon) => polygon.map((point) => project(point)))
  const hasMeasuredWalls =
    model.walls.some((wall) => wall.topCm !== undefined) ||
    model.openings.some((opening) => opening.cut)
  const hasIllustrativeWalls = model.walls.some((wall) => wall.topCm === undefined)
  const wallFaces = model.walls
    .map((wall) => {
      const floorStart = project(wall.start)
      const floorEnd = project(wall.end)
      return {
        ...wall,
        depth: (floorStart.y + floorEnd.y) / 2,
        points: [
          project(wall.start, wall.bottomCm),
          project(wall.end, wall.bottomCm),
          project(wall.end, wall.topCm ?? illustrativeRise),
          project(wall.start, wall.topCm ?? illustrativeRise),
        ],
      }
    })
    .sort((a, b) => a.depth - b.depth)
  const projectedCorners = [
    ...floor,
    ...wallFaces.flatMap((wall) => wall.points),
    ...model.openings.flatMap((opening) =>
      opening.cut && opening.bottomCm !== undefined && opening.heightCm !== undefined
        ? [
            project(opening.start, opening.bottomCm + opening.heightCm),
            project(opening.end, opening.bottomCm + opening.heightCm),
          ]
        : [],
    ),
  ]
  const xValues = projectedCorners.map((point) => point.x)
  const yValues = projectedCorners.map((point) => point.y)
  const minX = Math.min(...xValues)
  const maxX = Math.max(...xValues)
  const minY = Math.min(...yValues)
  const maxY = Math.max(...yValues)
  const padding = Math.max(maxX - minX, maxY - minY) * 0.08

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border border-line bg-paper px-4 py-3">
        <p className="text-sm text-ink-2">Поверните схему, чтобы осмотреть стены и проёмы.</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setAngleIndex((index) => (index + 3) % 4)}
            className="border border-line-strong px-3 py-1 text-sm text-ink hover:border-accent"
            aria-label="Повернуть схему влево"
          >
            ↶ Влево
          </button>
          <button
            type="button"
            onClick={() => setAngleIndex((index) => (index + 1) % 4)}
            className="border border-line-strong px-3 py-1 text-sm text-ink hover:border-accent"
            aria-label="Повернуть схему вправо"
          >
            Вправо ↷
          </button>
        </div>
      </div>
      <svg
        viewBox={`${minX - padding} ${minY - padding} ${maxX - minX + padding * 2} ${maxY - minY + padding * 2}`}
        className="block aspect-[4/3] w-full border-x border-b border-line bg-paper"
        role="img"
        aria-label="Объёмный просмотр подтверждённой двухмерной схемы"
      >
        <path
          d={[pathRing(floor), ...voids.map(pathRing)].join(' ')}
          fill="var(--accent-tint)"
          fillRule="evenodd"
          stroke="var(--accent)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
        {wallFaces.map((wall) => (
          <polygon
            key={wall.id}
            points={polygonPoints(wall.points)}
            fill={
              model.wallSource === 'pdf-faces'
                ? 'var(--accent)'
                : wall.kind === 'outer'
                  ? 'var(--ink-2)'
                  : 'var(--paper)'
            }
            fillOpacity={
              model.wallSource === 'pdf-faces' ? 0.24 : wall.kind === 'outer' ? 0.65 : 0.82
            }
            stroke="var(--ink)"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          >
            <title>
              {wall.topCm === undefined
                ? 'Стена · условная высота'
                : 'Стена · высота по введённым меркам'}
            </title>
          </polygon>
        ))}
        {model.openings.map((opening) => {
          const title = opening.type === 'window' ? 'Окно' : 'Дверной проём'
          const color = opening.type === 'window' ? 'var(--accent)' : 'var(--danger)'
          if (opening.cut && opening.bottomCm !== undefined && opening.heightCm !== undefined) {
            const top = opening.bottomCm + opening.heightCm
            return (
              <polygon
                key={opening.id}
                points={polygonPoints([
                  project(opening.start, opening.bottomCm),
                  project(opening.end, opening.bottomCm),
                  project(opening.end, top),
                  project(opening.start, top),
                ])}
                fill="none"
                stroke={color}
                strokeWidth="3"
                vectorEffect="non-scaling-stroke"
              >
                <title>{`${title} · низ ${opening.bottomCm} см · высота ${opening.heightCm} см`}</title>
              </polygon>
            )
          }
          const start = project(opening.start)
          const end = project(opening.end)
          return (
            <line
              key={opening.id}
              x1={start.x}
              y1={start.y}
              x2={end.x}
              y2={end.y}
              stroke={color}
              strokeWidth="5"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            >
              <title>{`${title} · положение на плане`}</title>
            </line>
          )
        })}
      </svg>
      <p className="mt-3 text-xs leading-relaxed text-ink-2">
        {model.wallSource === 'pdf-faces'
          ? 'Показаны только подтверждённые участки граней из PDF — это не конструктивная толщина стен. '
          : 'Показаны стены подтверждённой 2D-схемы. '}
        {hasMeasuredWalls
          ? hasIllustrativeWalls
            ? 'Для стен с мерками использованы введённые высоты. Остальные стены показаны с условной высотой. '
            : 'Высоты стен показаны по меркам, введённым при проверке схемы. '
          : 'Высота стен показана условно. Добавьте мерки стен и проёмов в редакторе для просмотра по высоте. '}
        Цветной контур показывает проём с заданными нижней гранью и высотой; линия на полу — его
        положение, когда этих мерок ещё нет. Перед покупкой мебели сверьте размеры с обмером
        квартиры.
      </p>
    </div>
  )
}
