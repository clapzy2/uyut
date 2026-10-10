'use client'

import { useMemo, useRef, useState } from 'react'
import { signedElevationSum } from '@/lib/projects/plan-vertical-floor-geometry'
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
import { PlanVolumeSelection, type VolumeSelection } from './plan-volume-selection'

function polygonPoints(points: VolumeScreenPoint[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(' ')
}

function pathRing(points: VolumeScreenPoint[]): string {
  return `M ${points.map((point) => `${point.x} ${point.y}`).join(' L ')} Z`
}

function openingTop(model: PlanVolume, opening: PlanVolume['openings'][number]): number {
  const bottom = opening.bottomCm ?? 0
  const height = opening.heightCm ?? 0
  return model.floorSurfaces === undefined ? bottom + height : signedElevationSum(bottom, height)
}

function facesViewer(points: VolumeScreenPoint[]): boolean {
  return (
    points.reduce((area, point, index) => {
      const next = points[(index + 1) % points.length]
      return next ? area + point.x * next.y - next.x * point.y : area
    }, 0) > 1e-7
  )
}

function measurableFloorRing(points: PlanVolume['floor']): boolean {
  const first = points[0]
  const last = points[points.length - 1]
  const ring =
    first && last && first.xCm === last.xCm && first.yCm === last.yCm ? points.slice(0, -1) : points
  if (ring.length < 3) return false
  let area = 0
  for (const [index, point] of ring.entries()) {
    const next = ring[(index + 1) % ring.length]
    if (!next || !Number.isFinite(point.xCm) || !Number.isFinite(point.yCm)) return false
    if (point.xCm === next.xCm && point.yCm === next.yCm) return false
    area += point.xCm * next.yCm - next.xCm * point.yCm
  }
  return Number.isFinite(area) && area !== 0
}

function VerticalModelMeasurements({
  report,
}: {
  report: NonNullable<PlanVolume['verticalMeasurements']>
}) {
  const missing = [
    { label: 'Высота стен', ids: report.missingWallHeightIds },
    { label: 'Толщина стен', ids: report.missingWallThicknessIds },
    { label: 'Высота проёмов', ids: report.missingOpeningHeightIds },
    { label: 'Нижняя грань проёмов', ids: report.missingOpeningBottomIds },
  ]
  return (
    <section
      className="mb-3 border border-line px-3 py-2 text-sm leading-relaxed text-ink-2"
      aria-label="Мерки объёмной модели"
    >
      <h3 className="font-medium text-ink">Мерки объёмной модели</h3>
      <p className="mt-1">
        {report.surfaceStatus === 'invalid'
          ? 'Некоторые вертикальные мерки некорректны. Исправьте их в редакторе; объём не считается сверенным.'
          : report.surfaceStatus === 'partial'
            ? 'Вертикальные мерки заполнены частично. Условные поверхности оставлены для обзора; недостающие значения нужно ввести в редакторе.'
            : report.missingWallThicknessIds.length
              ? 'Высоты и нижние грани заполнены; толщины стен ещё неполные.'
              : 'Высоты, нижние грани и толщины заполнены.'}
      </p>
      <p className="mt-1 text-xs">
        Это полнота введённых полей, не подтверждение обмера, высоты потолка или физического
        прохода.
      </p>
      {missing.some(({ ids }) => ids.length) ? (
        <details className="mt-1 text-xs">
          <summary className="min-h-11 cursor-pointer py-2">Какие мерки нужно уточнить</summary>
          <ul className="list-disc space-y-1 pl-4">
            {missing
              .filter(({ ids }) => ids.length)
              .map(({ label, ids }) => (
                <li key={label} className="break-all">
                  {label}: {ids.length} — {ids.join(', ')}.
                </li>
              ))}
          </ul>
        </details>
      ) : null}
      {report.unknownThresholdIds.length ? (
        <p className="mt-1 text-xs break-all">
          Уровень порога не указан: {report.unknownThresholdIds.length} —{' '}
          {report.unknownThresholdIds.join(', ')}.
        </p>
      ) : null}
      {report.raisedThresholdIds.length ? (
        <p className="mt-1 text-xs break-all">
          Поднятая нижняя грань: {report.raisedThresholdIds.length} —{' '}
          {report.raisedThresholdIds.join(', ')}. Это не непрерывный ровный пол.
        </p>
      ) : null}
    </section>
  )
}

export default function PlanVolumeViewer({
  model,
  projectId,
}: {
  model: PlanVolume
  projectId?: string
}) {
  const [angle, setAngle] = useState(0)
  const [tilt, setTilt] = useState(DEFAULT_VOLUME_TILT)
  const [zoom, setZoom] = useState(1)
  const [section, setSection] = useState(false)
  const [savedSectionHeight, setSectionHeight] = useState(90)
  const [showZones, setShowZones] = useState(true)
  const [selection, setSelection] = useState<VolumeSelection>(null)
  const press = useRef<{
    pointerId: number
    x: number
    y: number
    target: EventTarget
    moved: boolean
  } | null>(null)
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
  const rooms = model.rooms ?? []
  const selectedItem =
    selection?.kind === 'furniture' ? furniture.find((item) => item.id === selection.id) : undefined
  const selectedRoomId = selection?.kind === 'room' ? selection.id : selectedItem?.roomId
  const selectedRoom = rooms.find((room) => room.id === selectedRoomId)
  const highlightedIds = new Set(
    selection?.kind === 'furniture'
      ? [selection.id]
      : furniture
          .filter((item) => selectedRoomId !== undefined && item.roomId === selectedRoomId)
          .map((item) => item.id),
  )
  const unknownHeights = furniture.filter((item) => item.heightCm === undefined)
  const floorZones = model.floorZones ?? []
  const floorSurfaces = model.floorSurfaces ?? [
    {
      id: 'floor',
      floor: model.floor,
      voids: model.voids,
      elevationCm: 0,
      title: 'Пол',
      roomId: undefined,
    },
  ]
  if (
    floorSurfaces.length === 0 ||
    floorSurfaces.some(
      (floor) =>
        !Number.isFinite(floor.elevationCm) ||
        !measurableFloorRing(floor.floor) ||
        floor.voids.some((hole) => !measurableFloorRing(hole)),
    )
  )
    throw new Error('Invalid floor surfaces')
  const projectedFloors = floorSurfaces.map((floor) => ({
    ...floor,
    points: floor.floor.map((point) => project(point, floor.elevationCm)),
    holes: floor.voids.map((hole) => hole.map((point) => project(point, floor.elevationCm))),
  }))
  const thresholds = (model.thresholds ?? []).map((threshold) => ({
    ...threshold,
    points: threshold.floor.map((point) => project(point, threshold.elevationCm)),
  }))
  const zones = floorZones.map((zone) => ({
    ...zone,
    points: zone.floor.map((point) => project(point, zone.baseCm ?? 0)),
  }))

  // This rise is a drawing parameter, not a ceiling measurement or saved geometry.
  const xCoordinates = model.floor.map((point) => point.xCm)
  const yCoordinates = model.floor.map((point) => point.yCm)
  const illustrativeRise =
    Math.min(
      Math.max(...xCoordinates) - Math.min(...xCoordinates),
      Math.max(...yCoordinates) - Math.min(...yCoordinates),
    ) * 0.3
  const floor = projectedFloors.flatMap((surface) => surface.points)
  const sectionMin = model.floorSurfaces
    ? Math.floor(
        Math.min(
          ...floorSurfaces.map((surface) => surface.elevationCm),
          ...model.walls.map((wall) => wall.bottomCm),
        ),
      )
    : 20
  const sectionMax = model.floorSurfaces
    ? Math.max(
        sectionMin + 1,
        ...model.walls.map((wall) => Math.ceil(wall.topCm ?? wall.bottomCm + illustrativeRise)),
      )
    : 300
  const sectionHeight = Math.max(sectionMin, Math.min(savedSectionHeight, sectionMax))
  const hasMeasuredWalls = model.walls.some((wall) => wall.topCm !== undefined)
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
              ? Math.min(wall.topCm ?? wall.bottomCm + illustrativeRise, sectionHeight)
              : (wall.topCm ?? wall.bottomCm + illustrativeRise),
          ),
          project(
            wall.start,
            section
              ? Math.min(wall.topCm ?? wall.bottomCm + illustrativeRise, sectionHeight)
              : (wall.topCm ?? wall.bottomCm + illustrativeRise),
          ),
        ],
        holes: [],
        cutEdge: [],
        furnitureTitle: undefined,
        furnitureId: undefined,
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
        furnitureId: undefined,
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
    ...thresholds.flatMap((threshold) => threshold.points),
    ...rooms.flatMap((room) => room.floor.map((point) => project(point, room.baseCm ?? 0))),
    ...zones.flatMap((zone) => zone.points),
    ...surfaces.flatMap((wall) => wall.points),
    ...model.openings.flatMap((opening) =>
      opening.bottomCm !== undefined && opening.heightCm !== undefined
        ? [
            project(
              opening.start,
              section
                ? Math.min(openingTop(model, opening), sectionHeight)
                : openingTop(model, opening),
            ),
            project(
              opening.end,
              section
                ? Math.min(openingTop(model, opening), sectionHeight)
                : openingTop(model, opening),
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
    setShowZones(true)
    setSelection(null)
    drag.current = null
    press.current = null
  }

  return (
    <div className="mt-4">
      {model.verticalDatum ? (
        <p className="mb-3 text-sm text-ink-2">
          Отметки полов и верха порогов показаны от общего нуля; низ проёма — отдельная грань.
          Толщина порога не достраивается.
        </p>
      ) : null}
      {!roomLayout && model.verticalMeasurements ? (
        <VerticalModelMeasurements report={model.verticalMeasurements} />
      ) : null}
      {model.issues.length > 0 ? (
        <div className="mb-3 border border-danger px-4 py-3 text-sm text-ink" role="status">
          <p>Уточните замечания перед выбором расстановки:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {model.issues.map((issue) => (
              <li key={issue.id}>{issue.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <PlanVolumeControls
        sectionMin={sectionMin}
        sectionMax={sectionMax}
        commonDatum={model.verticalDatum !== undefined}
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
      {rooms.length > 0 || furniture.length > 0 ? (
        <PlanVolumeSelection
          model={model}
          selection={selection}
          onSelect={setSelection}
          projectId={projectId}
        />
      ) : null}
      {floorZones.length > 0 ? (
        <label className="flex items-center gap-2 border-x border-line px-3 py-2 text-sm text-ink-2">
          <input
            type="checkbox"
            checked={showZones}
            onChange={(event) => setShowZones(event.target.checked)}
            className="accent-accent"
          />
          Показать препятствия и зоны использования
        </label>
      ) : null}
      <svg
        viewBox={volumeViewBox(projectedCorners, zoom)}
        className="block h-[420px] w-full cursor-grab select-none border-x border-b border-line bg-paper active:cursor-grabbing sm:h-[520px]"
        style={{ touchAction: 'pan-y' }}
        onPointerDown={(event) => {
          press.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            target: event.target,
            moved: false,
          }
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
          const down = press.current
          if (
            down?.pointerId === event.pointerId &&
            Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4
          )
            down.moved = true
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
          const down = press.current
          if (down?.pointerId === event.pointerId) {
            press.current = null
            if (!down.moved && event.button === 0 && down.target instanceof Element) {
              const furnitureId = down.target
                .closest('[data-volume-furniture]')
                ?.getAttribute('data-volume-furniture')
              const roomId = down.target
                .closest('[data-volume-room]')
                ?.getAttribute('data-volume-room')
              if (furnitureId) setSelection({ kind: 'furniture', id: furnitureId })
              else if (roomId) setSelection({ kind: 'room', id: roomId })
            }
          }
          if (drag.current?.pointerId !== event.pointerId) return
          drag.current = null
          event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onPointerCancel={() => {
          drag.current = null
          press.current = null
        }}
        onLostPointerCapture={() => {
          drag.current = null
          press.current = null
        }}
        role="img"
        aria-label={
          roomLayout
            ? 'Объёмный просмотр текущей расстановки мебели'
            : 'Объёмный просмотр подтверждённой двухмерной схемы'
        }
      >
        {projectedFloors.map((surface) => (
          <path
            key={surface.id}
            data-volume-floor={surface.id}
            data-volume-room={surface.roomId}
            d={[pathRing(surface.points), ...surface.holes.map(pathRing)].join(' ')}
            fill={
              surface.roomId !== undefined && selectedRoomId === surface.roomId
                ? 'var(--accent)'
                : 'var(--accent-tint)'
            }
            fillRule="evenodd"
            stroke="var(--accent)"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          >
            <title>{`${surface.title}${model.verticalDatum ? ` · отметка ${surface.elevationCm} см от общего нуля` : ''}`}</title>
          </path>
        ))}
        {thresholds.map((threshold) => (
          <polygon
            key={threshold.id}
            data-volume-threshold={threshold.id}
            points={polygonPoints(threshold.points)}
            fill="var(--accent)"
            stroke="var(--ink)"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          >
            <title>{`Верх порога · отметка ${threshold.elevationCm} см от общего нуля; толщина не указана`}</title>
          </polygon>
        ))}
        {(model.floorSurfaces === undefined ? rooms : []).map((room) => (
          <polygon
            key={`room-${room.id}`}
            data-volume-room={room.id}
            points={polygonPoints(room.floor.map((point) => project(point, room.baseCm ?? 0)))}
            fill={selectedRoomId === room.id ? 'var(--accent)' : 'transparent'}
            fillOpacity={selectedRoomId === room.id ? 0.2 : 0}
            stroke={selectedRoomId === room.id ? 'var(--accent)' : 'none'}
            strokeWidth="3"
            vectorEffect="non-scaling-stroke"
            className="cursor-pointer"
          >
            <title>{room.title}</title>
          </polygon>
        ))}
        {showZones
          ? zones.map((zone) => (
              <polygon
                key={`zone-${zone.id}`}
                points={polygonPoints(zone.points)}
                fill={zone.kind === 'operation' ? 'var(--accent)' : 'var(--danger)'}
                fillOpacity={zone.kind === 'obstacle' ? 0.25 : 0.1}
                stroke={zone.kind === 'operation' ? 'var(--accent)' : 'var(--danger)'}
                strokeDasharray={zone.kind === 'obstacle' ? undefined : '5 4'}
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              >
                <title>
                  {zone.title}
                  {zone.preliminary ? ' · предварительный запас' : ''}
                </title>
              </polygon>
            ))
          : null}
        {surfaces.map((wall) => (
          <g key={wall.id}>
            <path
              data-volume-furniture={wall.furnitureId}
              className={wall.furnitureId ? 'cursor-pointer' : undefined}
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
                wall.furnitureId !== undefined && highlightedIds.has(wall.furnitureId)
                  ? 0.85
                  : wall.furnitureTitle !== undefined
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
              strokeWidth={
                wall.furnitureId !== undefined && highlightedIds.has(wall.furnitureId) ? '3' : '1.5'
              }
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
          if (opening.bottomCm !== undefined && opening.heightCm !== undefined) {
            const top = section
              ? Math.min(openingTop(model, opening), sectionHeight)
              : openingTop(model, opening)
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
                <title>{`${title} · низ ${opening.bottomCm} см${model.verticalDatum ? ' от общего нуля' : ''} · высота ${opening.heightCm} см`}</title>
              </polygon>
            )
          }
          const start = project(opening.start, opening.baseCm ?? 0)
          const end = project(opening.end, opening.baseCm ?? 0)
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
        {furniture.length > 0
          ? furniture.map((item, index) => {
              const center = project(
                {
                  xCm: item.floor.reduce((sum, point) => sum + point.xCm, 0) / item.floor.length,
                  yCm: item.floor.reduce((sum, point) => sum + point.yCm, 0) / item.floor.length,
                },
                (item.baseCm ?? 0) + (item.heightCm ?? 0),
              )
              return (
                <text
                  key={`label-${item.id}`}
                  data-volume-furniture={item.id}
                  x={center.x}
                  y={center.y}
                  fill="var(--ink)"
                  stroke="var(--paper)"
                  strokeWidth="3"
                  paintOrder="stroke"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize="18"
                  className="cursor-pointer"
                  fontWeight={highlightedIds.has(item.id) ? '700' : undefined}
                >
                  {index + 1}
                </text>
              )
            })
          : null}
      </svg>
      {selectedRoom ? (
        <p className="mt-2 text-sm text-ink-2">
          Подсвечена комната: {selectedRoom.title}. Стены и остальные предметы оставлены для
          ориентира.
        </p>
      ) : null}
      {floorZones.length > 0 ? (
        <div className="mt-3 text-sm leading-relaxed text-ink-2">
          <p>
            Красным — препятствия и зоны, которые нужно оставить свободными; розовым пунктиром —
            место для использования мебели. Они перенесены из 2D без изменения размеров.
          </p>
          {floorZones.some((zone) => zone.kind === 'obstacle') ? (
            <p className="mt-1">Препятствия отмечены на полу: их высота здесь не достраивается.</p>
          ) : null}
          {floorZones.some((zone) => zone.preliminary) ? (
            <p className="mt-1">
              Есть предварительные рабочие запасы — уточните их по данным изделия.
            </p>
          ) : null}
        </div>
      ) : null}
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
                <button
                  type="button"
                  aria-pressed={selection?.kind === 'furniture' && selection.id === item.id}
                  onClick={() => setSelection({ kind: 'furniture', id: item.id })}
                  className={`min-h-11 w-full border-l-2 px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-accent ${
                    highlightedIds.has(item.id)
                      ? 'border-accent bg-accent-tint text-ink'
                      : 'border-transparent hover:bg-accent-tint hover:text-ink'
                  }`}
                >
                  {index + 1}. {item.title}
                  {item.heightCm === undefined
                    ? ' · высота не указана'
                    : ` · высота ${item.heightCm} см`}
                </button>
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
