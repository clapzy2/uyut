'use client'

import { useMemo, useRef, useState } from 'react'
import type { PlanVolume } from '@/lib/projects/plan-volume'
import {
  DEFAULT_VOLUME_TILT,
  type VolumeScreenPoint,
  volumeOrbit,
  volumeProjector,
  volumeViewBox,
} from '@/lib/projects/plan-volume-camera'
import { volumeSection } from '@/lib/projects/plan-volume-section'
import { furnitureFaces } from '@/lib/projects/room-volume'
import { PlanVolumeControls } from './plan-volume-controls'

function polygonPoints(points: VolumeScreenPoint[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(' ')
}

function pathRing(points: VolumeScreenPoint[]): string {
  return `M ${points.map((point) => `${point.x} ${point.y}`).join(' L ')} Z`
}

function facesViewer(points: VolumeScreenPoint[]): boolean {
  return (
    points.reduce((area, point, index) => {
      const next = points[(index + 1) % points.length]
      return next ? area + point.x * next.y - next.x * point.y : area
    }, 0) > 1e-7
  )
}

export default function PlanVolumeViewer({ model }: { model: PlanVolume }) {
  const [angle, setAngle] = useState(0)
  const [tilt, setTilt] = useState(DEFAULT_VOLUME_TILT)
  const [zoom, setZoom] = useState(1)
  const [section, setSection] = useState(false)
  const [sectionHeight, setSectionHeight] = useState(90)
  const drag = useRef<{
    pointerId: number
    x: number
    y: number
    angle: number
    tilt: number
  } | null>(null)
  const project = useMemo(() => volumeProjector(angle, tilt), [angle, tilt])
  const roomLayout = model.wallSource === 'room-layout'
  const furniture = model.furniture ?? []
  const unknownHeights = furniture.filter((item) => item.heightCm === undefined)

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
    .filter((wall) => !wall.solid && (!section || wall.bottomCm < sectionHeight))
    .map((wall) => {
      const floorStart = project(wall.start)
      const floorEnd = project(wall.end)
      return {
        ...wall,
        depth: (floorStart.depth + floorEnd.depth) / 2,
        points: [
          project(wall.start, wall.bottomCm),
          project(wall.end, wall.bottomCm),
          project(
            wall.end,
            section
              ? Math.min(wall.topCm ?? illustrativeRise, sectionHeight)
              : (wall.topCm ?? illustrativeRise),
          ),
          project(
            wall.start,
            section
              ? Math.min(wall.topCm ?? illustrativeRise, sectionHeight)
              : (wall.topCm ?? illustrativeRise),
          ),
        ],
        holes: [],
        cutEdge: [],
        furnitureTitle: undefined,
        footprintOnly: false,
      }
    })
  const surfaces = [
    ...wallFaces.map((wall) => ({
      ...wall,
      role: 'face' as const,
      measured: wall.topCm !== undefined,
      solid: false,
    })),
    ...[
      ...model.solidFaces.map((face) => ({
        ...face,
        furnitureTitle: undefined,
        footprintOnly: false,
      })),
      ...furnitureFaces(furniture),
    ]
      .map((face) => {
        const cut = section && face.furnitureTitle === undefined
        const points = cut ? volumeSection(face.points, sectionHeight) : face.points
        return {
          ...face,
          points,
          holes: (face.holes ?? []).map((hole) =>
            cut ? volumeSection(hole, sectionHeight) : hole,
          ),
          cutEdge:
            cut && face.points.some((point) => point.zCm > sectionHeight)
              ? points.filter((point) => point.zCm === sectionHeight)
              : [],
        }
      })
      .filter((face) => face.points.length >= 3)
      .map((face) => ({
        ...face,
        measured: !face.footprintOnly,
        solid: true,
        depth:
          face.points.reduce((sum, point) => sum + project(point, point.zCm).depth, 0) /
          face.points.length,
        points: face.points.map((point) => project(point, point.zCm)),
        holes: face.holes.map((hole) => hole.map((point) => project(point, point.zCm))),
        cutEdge: face.cutEdge.map((point) => project(point, point.zCm)),
      }))
      .filter((face) => facesViewer(face.points)),
  ].sort((a, b) => a.depth - b.depth)
  const projectedCorners = [
    ...floor,
    ...surfaces.flatMap((wall) => wall.points),
    ...model.openings.flatMap((opening) =>
      opening.cut && opening.bottomCm !== undefined && opening.heightCm !== undefined
        ? [
            project(
              opening.start,
              section
                ? Math.min(opening.bottomCm + opening.heightCm, sectionHeight)
                : opening.bottomCm + opening.heightCm,
            ),
            project(
              opening.end,
              section
                ? Math.min(opening.bottomCm + opening.heightCm, sectionHeight)
                : opening.bottomCm + opening.heightCm,
            ),
          ]
        : [],
    ),
  ]

  function resetView() {
    setAngle(0)
    setTilt(DEFAULT_VOLUME_TILT)
    setZoom(1)
    setSection(false)
    setSectionHeight(90)
    drag.current = null
  }

  return (
    <div className="mt-4">
      {model.issues.length > 0 ? (
        <div className="mb-3 border border-danger px-4 py-3 text-sm text-ink" role="status">
          <p>Перед выбором расстановки уточните пересечения:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {model.issues.map((issue) => (
              <li key={issue.id}>{issue.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <PlanVolumeControls
        angle={angle}
        tilt={tilt}
        zoom={zoom}
        section={section}
        sectionHeight={sectionHeight}
        roomLayout={roomLayout}
        setAngle={setAngle}
        setTilt={setTilt}
        setZoom={setZoom}
        setSection={setSection}
        setSectionHeight={setSectionHeight}
        onReset={resetView}
      />
      <svg
        viewBox={volumeViewBox(projectedCorners, zoom)}
        className="block aspect-[4/3] w-full cursor-grab select-none border-x border-b border-line bg-paper active:cursor-grabbing"
        style={{ touchAction: 'pan-y' }}
        onPointerDown={(event) => {
          if (event.pointerType !== 'mouse' || event.button !== 0) return
          drag.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            angle,
            tilt,
          }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          const start = drag.current
          if (!start || start.pointerId !== event.pointerId) return
          const next = volumeOrbit(
            start.angle,
            start.tilt,
            event.clientX - start.x,
            event.clientY - start.y,
          )
          setAngle(next.angle)
          setTilt(next.tilt)
        }}
        onPointerUp={(event) => {
          if (drag.current?.pointerId !== event.pointerId) return
          drag.current = null
          event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onPointerCancel={() => {
          drag.current = null
        }}
        onLostPointerCapture={() => {
          drag.current = null
        }}
        role="img"
        aria-label={
          roomLayout
            ? 'Объёмный просмотр текущей расстановки мебели'
            : 'Объёмный просмотр подтверждённой двухмерной схемы'
        }
      >
        <path
          d={[pathRing(floor), ...voids.map(pathRing)].join(' ')}
          fill="var(--accent-tint)"
          fillRule="evenodd"
          stroke="var(--accent)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
        {surfaces.map((wall) => (
          <g key={wall.id}>
            <path
              d={[pathRing(wall.points), ...wall.holes.map(pathRing)].join(' ')}
              fillRule="evenodd"
              fill={
                wall.furnitureTitle !== undefined
                  ? 'var(--accent)'
                  : model.wallSource === 'pdf-faces'
                    ? 'var(--accent)'
                    : wall.role !== 'face'
                      ? 'var(--line-strong)'
                      : 'var(--ink-2)'
              }
              fillOpacity={
                wall.furnitureTitle !== undefined
                  ? wall.footprintOnly
                    ? 0.12
                    : wall.role === 'cap'
                      ? 0.75
                      : 0.45
                  : model.wallSource === 'pdf-faces'
                    ? 0.24
                    : wall.kind === 'outer'
                      ? 0.65
                      : 0.35
              }
              stroke={
                wall.furnitureTitle !== undefined
                  ? 'var(--accent)'
                  : wall.solid && wall.role === 'face'
                    ? 'none'
                    : 'var(--ink)'
              }
              strokeDasharray={wall.footprintOnly ? '5 4' : undefined}
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            >
              <title>
                {wall.furnitureTitle !== undefined
                  ? `${wall.furnitureTitle} · ${wall.footprintOnly ? 'габарит на полу; высота не указана' : 'габаритный объём по размерам из 2D-расстановки'}`
                  : wall.role === 'reveal'
                    ? 'Откос проёма · толщина по обмеру'
                    : wall.role !== 'face'
                      ? 'Торец стены · толщина по обмеру'
                      : wall.measured
                        ? 'Стена · высота по введённым меркам'
                        : 'Стена · условная высота'}
              </title>
            </path>
            {wall.cutEdge.length === 2 ? (
              <line
                x1={wall.cutEdge[0]?.x}
                y1={wall.cutEdge[0]?.y}
                x2={wall.cutEdge[1]?.x}
                y2={wall.cutEdge[1]?.y}
                stroke="var(--ink)"
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
          </g>
        ))}
        {model.openings.map((opening) => {
          const title = opening.type === 'window' ? 'Окно' : 'Дверной проём'
          const color = opening.type === 'window' ? 'var(--accent)' : 'var(--danger)'
          if (opening.cut && opening.bottomCm !== undefined && opening.heightCm !== undefined) {
            const top = section
              ? Math.min(opening.bottomCm + opening.heightCm, sectionHeight)
              : opening.bottomCm + opening.heightCm
            if (top <= opening.bottomCm) return null
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
        {roomLayout
          ? furniture.map((item, index) => {
              const center = project(
                {
                  xCm: item.floor.reduce((sum, point) => sum + point.xCm, 0) / item.floor.length,
                  yCm: item.floor.reduce((sum, point) => sum + point.yCm, 0) / item.floor.length,
                },
                item.heightCm ?? 0,
              )
              return (
                <text
                  key={`label-${item.id}`}
                  x={center.x}
                  y={center.y}
                  fill="var(--ink)"
                  stroke="var(--paper)"
                  strokeWidth="3"
                  paintOrder="stroke"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize="18"
                  pointerEvents="none"
                >
                  {index + 1}
                </text>
              )
            })
          : null}
      </svg>
      {furniture.length > 0 ? (
        <div className="mt-3 border border-line px-3 py-2 text-sm text-ink-2">
          <p>Мебель показана габаритными блоками, а не точными моделями изделий.</p>
          {unknownHeights.length > 0 ? (
            <p className="mt-1">
              Пунктиром — только место на полу, высоту нужно уточнить:{' '}
              {[...new Set(unknownHeights.map((item) => item.title))].join(', ')}.
            </p>
          ) : null}
          <ul className="mt-2 space-y-1">
            {furniture.map((item, index) => (
              <li key={item.id}>
                {index + 1}. {item.title}
                {item.heightCm === undefined
                  ? ' · высота не указана'
                  : ` · высота ${item.heightCm} см`}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {roomLayout ? (
        <p className="mt-3 text-xs leading-relaxed text-ink-2">
          {model.layoutNote} Положения и габариты мебели совпадают с видом сверху; проверки проходов
          и рабочих зон смотрите на 2D-плане.
        </p>
      ) : (
        <p className="mt-3 text-xs leading-relaxed text-ink-2">
          {section
            ? `Стены показаны в срезе на ${sectionHeight} см для обзора комнат. Исходные высоты и мерки сохранены. `
            : null}
          {model.wallSource === 'pdf-faces'
            ? 'Показаны только подтверждённые участки граней из PDF — это не конструктивная толщина стен. '
            : 'Показаны стены подтверждённой 2D-схемы. '}
          {hasMeasuredWalls
            ? hasIllustrativeWalls
              ? 'Для стен с мерками использованы введённые высоты. Остальные стены показаны с условной высотой. '
              : 'Высоты стен показаны по меркам, введённым при проверке схемы. '
            : 'Высота стен показана условно. Добавьте мерки стен и проёмов в редакторе для просмотра по высоте. '}
          {model.solidFaces.length > 0
            ? model.joinedSolids
              ? 'Стыки стен с мерками объединены без внутренних граней. Это просмотр планировки, а не строительная ведомость объёмов. '
              : 'Толщина и откосы показаны только для стен с отдельно сверенной толщиной и осью. '
            : null}
          Цветной контур показывает проём с заданными нижней гранью и высотой; линия на полу — его
          положение, когда этих мерок ещё нет. Перед покупкой мебели сверьте размеры с обмером
          квартиры.
        </p>
      )}
    </div>
  )
}
