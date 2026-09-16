// biome-ignore-all lint/suspicious/noArrayIndexKey: room and polygon point order is fixed and acts as editor identity

'use client'

import type {
  PlanGeometry,
  PlanObstacle,
  PlanOpening,
  PlanPoint,
  PlanRoomShape,
  PlanWall,
} from '@uyut/db'
import { Button, Dialog, DialogContent, DialogTrigger, Input, toast } from '@uyut/ui'
import { useRouter } from 'next/navigation'
import {
  type PointerEvent as ReactPointerEvent,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react'
import { savePlanGeometry } from '@/actions/projects'
import { FormError } from '@/components/form-error'
import { KitchenPlanEditor } from '@/components/kitchen-plan-editor'
import { PlanObstaclesEditor } from '@/components/plan-obstacles-editor'
import {
  inspectPlanGeometry,
  type PlanGeometryIssue,
} from '@/lib/projects/plan-geometry-inspection'

type Selection = `wall:${string}` | `opening:${string}` | `room:${number}`

type DragTarget =
  | { kind: 'wall'; id: string; endpoint: 'start' | 'end'; wall: PlanWall; pointerId: number }
  | { kind: 'opening'; id: string; opening: PlanOpening; pointerId: number }
  | { kind: 'room'; roomIndex: number; pointIndex: number; pointerId: number }

const numberClassName = 'grid grid-cols-2 gap-3'

function wallDistance(wall: PlanWall): number {
  return Math.hypot(wall.end.xCm - wall.start.xCm, wall.end.yCm - wall.start.yCm)
}

function wallLength(wall: PlanWall): number {
  return Math.round(wallDistance(wall))
}

function pointAlongWall(wall: PlanWall, distanceCm: number): PlanPoint {
  const length = wallDistance(wall)
  const ratio = length === 0 ? 0 : distanceCm / length
  return {
    xCm: wall.start.xCm + (wall.end.xCm - wall.start.xCm) * ratio,
    yCm: wall.start.yCm + (wall.end.yCm - wall.start.yCm) * ratio,
  }
}

function openingSegment(opening: PlanOpening, wall: PlanWall) {
  return {
    start: pointAlongWall(wall, opening.offsetCm),
    end: pointAlongWall(wall, opening.offsetCm + opening.widthCm),
    centre: pointAlongWall(wall, opening.offsetCm + opening.widthCm / 2),
  }
}

function roomCentre(points: PlanPoint[]): PlanPoint {
  const total = points.reduce(
    (result, point) => ({ xCm: result.xCm + point.xCm, yCm: result.yCm + point.yCm }),
    { xCm: 0, yCm: 0 },
  )
  return { xCm: total.xCm / points.length, yCm: total.yCm / points.length }
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(value, maximum))
}

function manualGeometryId() {
  return `manual_${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`
}

function openingLabel(type: PlanOpening['type']) {
  if (type === 'window') return 'Окно'
  if (type === 'balcony') return 'Балконный блок'
  return 'Дверь'
}

function snapToWallEndpoint(
  point: PlanPoint,
  walls: PlanWall[],
  excludedWallId: string,
): PlanPoint {
  let closest: PlanPoint | undefined
  let closestDistance = 13
  for (const wall of walls) {
    if (wall.id === excludedWallId) continue
    for (const endpoint of [wall.start, wall.end]) {
      const distance = Math.hypot(point.xCm - endpoint.xCm, point.yCm - endpoint.yCm)
      if (distance < closestDistance) {
        closest = endpoint
        closestDistance = distance
      }
    }
  }
  return closest ? { ...closest } : point
}

function PlanGeometryCanvas({
  geometry,
  walls,
  openings,
  rooms,
  selection,
  onSelectionChange,
  onWallsChange,
  onOpeningsChange,
  onRoomsChange,
  wallErrorIds,
  openingErrorIds,
  roomErrorIndexes,
}: {
  geometry: PlanGeometry
  walls: PlanWall[]
  openings: PlanOpening[]
  rooms: PlanRoomShape[]
  selection: Selection
  onSelectionChange: (selection: Selection) => void
  onWallsChange: (walls: PlanWall[]) => void
  onOpeningsChange: (openings: PlanOpening[]) => void
  onRoomsChange: (rooms: PlanRoomShape[]) => void
  wallErrorIds: ReadonlySet<string>
  openingErrorIds: ReadonlySet<string>
  roomErrorIndexes: ReadonlySet<number>
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<DragTarget | undefined>(undefined)
  const padding = Math.max(24, Math.min(geometry.widthCm, geometry.heightCm) * 0.06)
  const wallById = new Map(walls.map((wall) => [wall.id, wall]))
  const [selectionKind, selectionId] = selection.split(':')

  function canvasPoint(event: ReactPointerEvent<SVGSVGElement>): PlanPoint | null {
    const svg = svgRef.current
    const matrix = svg?.getScreenCTM()
    if (!svg || !matrix) return null
    const point = svg.createSVGPoint()
    point.x = event.clientX
    point.y = event.clientY
    const local = point.matrixTransform(matrix.inverse())
    return {
      xCm: Math.round(clamp(local.x, 0, geometry.widthCm)),
      yCm: Math.round(clamp(local.y, 0, geometry.heightCm)),
    }
  }

  function startWallDrag(
    event: ReactPointerEvent<SVGCircleElement>,
    wall: PlanWall,
    endpoint: 'start' | 'end',
  ) {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { kind: 'wall', id: wall.id, endpoint, wall, pointerId: event.pointerId }
    onSelectionChange(`wall:${wall.id}`)
  }

  function startOpeningDrag(event: ReactPointerEvent<SVGCircleElement>, opening: PlanOpening) {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { kind: 'opening', id: opening.id, opening, pointerId: event.pointerId }
    onSelectionChange(`opening:${opening.id}`)
  }

  function startRoomDrag(
    event: ReactPointerEvent<SVGCircleElement>,
    roomIndex: number,
    pointIndex: number,
  ) {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { kind: 'room', roomIndex, pointIndex, pointerId: event.pointerId }
    onSelectionChange(`room:${roomIndex}`)
  }

  function move(event: ReactPointerEvent<SVGSVGElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const point = canvasPoint(event)
    if (!point) return

    if (drag.kind === 'wall') {
      const other = drag.endpoint === 'start' ? drag.wall.end : drag.wall.start
      const dx = drag.wall.end.xCm - drag.wall.start.xCm
      const dy = drag.wall.end.yCm - drag.wall.start.yCm
      let snapped = { ...point }
      if (Math.abs(dx) >= Math.abs(dy) * 2) snapped.yCm = other.yCm
      else if (Math.abs(dy) >= Math.abs(dx) * 2) snapped.xCm = other.xCm
      snapped = snapToWallEndpoint(snapped, walls, drag.id)
      if (Math.hypot(snapped.xCm - other.xCm, snapped.yCm - other.yCm) < 20) return

      const nextWall: PlanWall = {
        ...drag.wall,
        [drag.endpoint]: snapped,
      }
      const nextLength = wallDistance(nextWall)
      onWallsChange(walls.map((wall) => (wall.id === drag.id ? nextWall : wall)))
      onOpeningsChange(
        openings.map((opening) =>
          opening.wallId === drag.id
            ? {
                ...opening,
                offsetCm: clamp(opening.offsetCm, 0, Math.max(0, nextLength - opening.widthCm)),
              }
            : opening,
        ),
      )
      return
    }

    if (drag.kind === 'room') {
      onRoomsChange(
        rooms.map((room, roomIndex) =>
          roomIndex === drag.roomIndex
            ? {
                ...room,
                polygon: room.polygon.map((vertex, pointIndex) =>
                  pointIndex === drag.pointIndex ? point : vertex,
                ),
              }
            : room,
        ),
      )
      return
    }

    const wall = wallById.get(drag.opening.wallId)
    if (!wall) return
    const wallDx = wall.end.xCm - wall.start.xCm
    const wallDy = wall.end.yCm - wall.start.yCm
    const length = Math.hypot(wallDx, wallDy)
    if (length === 0) return
    const projected =
      ((point.xCm - wall.start.xCm) * wallDx + (point.yCm - wall.start.yCm) * wallDy) / length
    const offsetCm = Math.round(
      clamp(projected - drag.opening.widthCm / 2, 0, Math.max(0, length - drag.opening.widthCm)),
    )
    onOpeningsChange(
      openings.map((opening) => (opening.id === drag.id ? { ...opening, offsetCm } : opening)),
    )
  }

  function stop(event: ReactPointerEvent<SVGSVGElement>) {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = undefined
  }

  return (
    <div className="border border-line bg-paper p-3 sm:p-5">
      <svg
        ref={svgRef}
        viewBox={`${-padding} ${-padding} ${geometry.widthCm + padding * 2} ${geometry.heightCm + padding * 2}`}
        role="img"
        aria-label="Интерактивная схема квартиры"
        className="block aspect-[16/9] w-full touch-none select-none"
        onPointerMove={move}
        onPointerUp={stop}
        onPointerCancel={stop}
      >
        {rooms.map((room, roomIndex) => {
          const centre = roomCentre(room.polygon)
          const points = room.polygon.map((point) => `${point.xCm},${point.yCm}`).join(' ')
          const selected = selectionKind === 'room' && Number(selectionId) === roomIndex
          const hasError = roomErrorIndexes.has(roomIndex)
          return (
            <g key={`${roomIndex}-${room.name}`}>
              <polygon
                points={points}
                fill="var(--accent-tint)"
                fillOpacity={selected ? 0.55 : 0.3}
                stroke={hasError ? 'var(--danger)' : selected ? 'var(--accent)' : 'transparent'}
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
                className="cursor-pointer transition-colors"
                onPointerDown={(event) => {
                  event.stopPropagation()
                  onSelectionChange(`room:${roomIndex}`)
                }}
              />
              <text
                x={centre.xCm}
                y={centre.yCm}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="var(--ink-2)"
                fontSize="12"
                className="pointer-events-none font-mono"
              >
                {room.name.toUpperCase()}
              </text>
            </g>
          )
        })}

        {walls.map((wall) => {
          const selected = selectionKind === 'wall' && selectionId === wall.id
          const hasError = wallErrorIds.has(wall.id)
          return (
            <g key={wall.id}>
              <line
                x1={wall.start.xCm}
                y1={wall.start.yCm}
                x2={wall.end.xCm}
                y2={wall.end.yCm}
                stroke={hasError ? 'var(--danger)' : selected ? 'var(--accent)' : 'var(--ink)'}
                strokeWidth={selected ? 7 : wall.kind === 'outer' ? 6 : 4}
                strokeLinecap="square"
                vectorEffect="non-scaling-stroke"
                className="transition-colors"
              />
              <line
                x1={wall.start.xCm}
                y1={wall.start.yCm}
                x2={wall.end.xCm}
                y2={wall.end.yCm}
                stroke="transparent"
                strokeWidth="22"
                vectorEffect="non-scaling-stroke"
                className="cursor-pointer"
                onPointerDown={(event) => {
                  event.stopPropagation()
                  onSelectionChange(`wall:${wall.id}`)
                }}
              />
              {selected
                ? (['start', 'end'] as const).map((endpoint) => (
                    <circle
                      key={endpoint}
                      cx={wall[endpoint].xCm}
                      cy={wall[endpoint].yCm}
                      r="8"
                      fill="var(--paper)"
                      stroke="var(--accent)"
                      strokeWidth="3"
                      vectorEffect="non-scaling-stroke"
                      className="cursor-grab active:cursor-grabbing"
                      onPointerDown={(event) => startWallDrag(event, wall, endpoint)}
                    />
                  ))
                : null}
            </g>
          )
        })}

        {openings.map((opening) => {
          const wall = wallById.get(opening.wallId)
          if (!wall) return null
          const segment = openingSegment(opening, wall)
          const selected = selectionKind === 'opening' && selectionId === opening.id
          const hasError = openingErrorIds.has(opening.id)
          return (
            <g key={opening.id}>
              <line
                x1={segment.start.xCm}
                y1={segment.start.yCm}
                x2={segment.end.xCm}
                y2={segment.end.yCm}
                stroke="var(--paper)"
                strokeWidth="12"
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1={segment.start.xCm}
                y1={segment.start.yCm}
                x2={segment.end.xCm}
                y2={segment.end.yCm}
                stroke="transparent"
                strokeWidth="22"
                vectorEffect="non-scaling-stroke"
                className="cursor-pointer"
                onPointerDown={(event) => {
                  event.stopPropagation()
                  onSelectionChange(`opening:${opening.id}`)
                }}
              />
              <line
                x1={segment.start.xCm}
                y1={segment.start.yCm}
                x2={segment.end.xCm}
                y2={segment.end.yCm}
                stroke={hasError ? 'var(--danger)' : selected ? 'var(--accent)' : 'var(--ink-2)'}
                strokeWidth={selected ? 5 : 3}
                strokeDasharray={opening.type === 'door' ? '7 5' : undefined}
                vectorEffect="non-scaling-stroke"
                className="pointer-events-none"
              />
              {selected ? (
                <circle
                  cx={segment.centre.xCm}
                  cy={segment.centre.yCm}
                  r="8"
                  fill="var(--accent)"
                  stroke="var(--paper)"
                  strokeWidth="3"
                  vectorEffect="non-scaling-stroke"
                  className="cursor-grab active:cursor-grabbing"
                  onPointerDown={(event) => startOpeningDrag(event, opening)}
                />
              ) : null}
            </g>
          )
        })}

        {selectionKind === 'room'
          ? rooms[Number(selectionId)]?.polygon.map((vertex, pointIndex) => (
              <circle
                key={pointIndex}
                cx={vertex.xCm}
                cy={vertex.yCm}
                r="7"
                fill="var(--paper)"
                stroke="var(--accent)"
                strokeWidth="3"
                vectorEffect="non-scaling-stroke"
                className="cursor-grab active:cursor-grabbing"
                onPointerDown={(event) => startRoomDrag(event, Number(selectionId), pointIndex)}
              />
            ))
          : null}
      </svg>
      <p className="mt-3 text-[12px] leading-relaxed text-ink-2">
        Нажмите на стену, проём или комнату. Концы стен магнитятся друг к другу вблизи, проёмы
        двигаются вдоль стены, а точки контура меняют форму комнаты.
      </p>
    </div>
  )
}

export function PlanGeometryEditor({
  projectId,
  geometry,
}: {
  projectId: string
  geometry: PlanGeometry
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [walls, setWalls] = useState(() => geometry.walls)
  const [openings, setOpenings] = useState(() => geometry.openings)
  const [rooms, setRooms] = useState(() => geometry.rooms)
  const [kitchenItems, setKitchenItems] = useState(() => geometry.kitchenItems ?? [])
  const [utilityPoints, setUtilityPoints] = useState(() => geometry.utilityPoints ?? [])
  const [obstacles, setObstacles] = useState<PlanObstacle[]>(() => geometry.obstacles ?? [])
  const [routeWidthCm, setRouteWidthCm] = useState(() => geometry.routeWidthCm)
  const [routeStartOpeningId, setRouteStartOpeningId] = useState(() => geometry.routeStartOpeningId)
  const [selection, setSelection] = useState<Selection>(() =>
    geometry.walls[0]
      ? `wall:${geometry.walls[0].id}`
      : geometry.openings[0]
        ? `opening:${geometry.openings[0].id}`
        : geometry.rooms[0]
          ? 'room:0'
          : 'wall:',
  )
  const [error, setError] = useState<string>()
  const [saving, startSaving] = useTransition()
  const [selectionKind, selectionId] = selection.split(':')
  const selectedWall =
    selectionKind === 'wall' ? walls.find((wall) => wall.id === selectionId) : null
  const selectedOpening =
    selectionKind === 'opening' ? openings.find((opening) => opening.id === selectionId) : null
  const selectedRoom = selectionKind === 'room' ? rooms[Number(selectionId)] : undefined
  const issues = useMemo(
    () => inspectPlanGeometry({ ...geometry, walls, openings, rooms }),
    [geometry, walls, openings, rooms],
  )
  const blockingIssues = issues.filter((issue) => issue.severity === 'error')
  const wallErrorIds = new Set(blockingIssues.flatMap((issue) => issue.wallIds ?? []))
  const openingErrorIds = new Set(blockingIssues.flatMap((issue) => issue.openingIds ?? []))
  const roomErrorIndexes = new Set(blockingIssues.flatMap((issue) => issue.roomIndexes ?? []))

  function selectIssue(issue: PlanGeometryIssue) {
    const openingId = issue.openingIds?.[0]
    const wallId = issue.wallIds?.[0]
    const roomIndex = issue.roomIndexes?.[0]
    if (openingId) setSelection(`opening:${openingId}`)
    else if (wallId) setSelection(`wall:${wallId}`)
    else if (roomIndex !== undefined) setSelection(`room:${roomIndex}`)
  }

  function patchWall(patch: Partial<PlanWall>) {
    if (!selectedWall) return
    setWalls((current) =>
      current.map((wall) => (wall.id === selectedWall.id ? { ...wall, ...patch } : wall)),
    )
  }

  function patchOpening(patch: Partial<PlanOpening>) {
    if (!selectedOpening) return
    if (patch.type === 'window' && routeStartOpeningId === selectedOpening.id)
      setRouteStartOpeningId(undefined)
    setOpenings((current) =>
      current.map((opening) =>
        opening.id === selectedOpening.id ? { ...opening, ...patch } : opening,
      ),
    )
  }

  function addWall() {
    setError(undefined)
    if (walls.length >= 200) {
      setError('В одной схеме может быть не больше 200 стен.')
      return
    }
    const length = Math.round(clamp(geometry.widthCm * 0.35, 60, 200))
    const centreX = geometry.widthCm / 2
    const stagger = ((walls.length % 5) - 2) * 18
    const yCm = Math.round(clamp(geometry.heightCm / 2 + stagger, 0, geometry.heightCm))
    const wall: PlanWall = {
      id: manualGeometryId(),
      kind: 'inner',
      start: { xCm: Math.round(clamp(centreX - length / 2, 0, geometry.widthCm)), yCm },
      end: { xCm: Math.round(clamp(centreX + length / 2, 0, geometry.widthCm)), yCm },
    }
    setWalls((current) => [...current, wall])
    setSelection(`wall:${wall.id}`)
  }

  function addOpening(type: PlanOpening['type']) {
    setError(undefined)
    if (openings.length >= 200) {
      setError('В одной схеме может быть не больше 200 проёмов.')
      return
    }
    const preferredWallId = selectedWall?.id ?? selectedOpening?.wallId
    const hostWall =
      walls.find((wall) => wall.id === preferredWallId && wallDistance(wall) >= 60) ??
      walls.find((wall) => wallDistance(wall) >= 60)
    if (!hostWall) {
      setError('Сначала добавьте или выберите стену длиной не меньше 60 см.')
      return
    }
    const hostLength = wallDistance(hostWall)
    const preferredWidth = type === 'window' ? 120 : type === 'balcony' ? 150 : 90
    const widthCm = Math.floor(Math.min(preferredWidth, hostLength - 30))
    const opening: PlanOpening = {
      id: manualGeometryId(),
      type,
      wallId: hostWall.id,
      widthCm,
      offsetCm: Math.round((hostLength - widthCm) / 2),
    }
    setOpenings((current) => [...current, opening])
    setSelection(`opening:${opening.id}`)
  }

  function nextSelection(nextWalls: PlanWall[], nextOpenings: PlanOpening[]): Selection {
    if (nextWalls[0]) return `wall:${nextWalls[0].id}`
    if (nextOpenings[0]) return `opening:${nextOpenings[0].id}`
    return rooms[0] ? 'room:0' : 'wall:'
  }

  function removeSelected() {
    if (selectedWall) {
      const nextWalls = walls.filter((wall) => wall.id !== selectedWall.id)
      const nextOpenings = openings.filter((opening) => opening.wallId !== selectedWall.id)
      setWalls(nextWalls)
      setOpenings(nextOpenings)
      if (!nextOpenings.some((opening) => opening.id === routeStartOpeningId))
        setRouteStartOpeningId(undefined)
      setSelection(nextSelection(nextWalls, nextOpenings))
      return
    }
    if (selectedOpening) {
      const nextOpenings = openings.filter((opening) => opening.id !== selectedOpening.id)
      setOpenings(nextOpenings)
      if (selectedOpening.id === routeStartOpeningId) setRouteStartOpeningId(undefined)
      setSelection(nextSelection(walls, nextOpenings))
    }
  }

  function reset() {
    setWalls(geometry.walls)
    setOpenings(geometry.openings)
    setRooms(geometry.rooms)
    setKitchenItems(geometry.kitchenItems ?? [])
    setUtilityPoints(geometry.utilityPoints ?? [])
    setObstacles(geometry.obstacles ?? [])
    setRouteWidthCm(geometry.routeWidthCm)
    setRouteStartOpeningId(geometry.routeStartOpeningId)
    setSelection(nextSelection(geometry.walls, geometry.openings))
    setError(undefined)
  }

  function save() {
    setError(undefined)
    startSaving(async () => {
      const result = await savePlanGeometry(projectId, {
        ...geometry,
        walls,
        openings,
        rooms,
        kitchenItems,
        utilityPoints,
        obstacles,
        routeWidthCm,
        routeStartOpeningId,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      toast({ title: '2D-схема подтверждена', tone: 'success' })
      setOpen(false)
      router.refresh()
    })
  }

  const selectClassName =
    'h-11 w-full rounded-sm border border-control bg-paper px-3 text-[14px] text-ink outline-none transition-colors focus:border-accent'

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!saving) setOpen(next)
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary">
          {geometry.status === 'confirmed' ? 'Изменить схему' : 'Проверить схему'}
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Проверка 2D-схемы"
        description="Двигайте элементы на чертеже или задайте точные сантиметры вручную."
        className="max-h-[calc(100dvh-2rem)] max-w-4xl overflow-y-auto"
      >
        <fieldset disabled={saving} inert={saving} className="min-w-0 border-0 p-0">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="mr-1 text-[12px] font-medium uppercase tracking-[0.1em] text-ink-2">
              Добавить
            </span>
            <Button type="button" variant="secondary" size="sm" onClick={addWall}>
              Стену
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => addOpening('door')}>
              Дверь
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => addOpening('window')}
            >
              Окно
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => addOpening('balcony')}
            >
              Балконный блок
            </Button>
          </div>

          <PlanGeometryCanvas
            geometry={geometry}
            walls={walls}
            openings={openings}
            rooms={rooms}
            selection={selection}
            onSelectionChange={setSelection}
            onWallsChange={setWalls}
            onOpeningsChange={setOpenings}
            onRoomsChange={setRooms}
            wallErrorIds={wallErrorIds}
            openingErrorIds={openingErrorIds}
            roomErrorIndexes={roomErrorIndexes}
          />

          <div
            className={`mt-4 border p-4 ${blockingIssues.length > 0 ? 'border-danger/50 bg-paper' : issues.length > 0 ? 'border-accent/40 bg-accent-tint/20' : 'border-line bg-muted'}`}
            aria-live="polite"
          >
            <p className="text-[12px] font-medium uppercase tracking-[0.1em] text-ink-2">
              Проверка геометрии
            </p>
            {issues.length === 0 ? (
              <p className="mt-2 text-[14px] leading-relaxed text-ink">
                Явных ошибок нет: стены соединены, а проёмы помещаются на своих стенах.
              </p>
            ) : (
              <>
                <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
                  {blockingIssues.length > 0
                    ? 'Исправьте красные элементы перед сохранением.'
                    : 'Схему можно сохранить, но внешний контур стоит перепроверить.'}
                </p>
                <ul className="mt-3 space-y-2">
                  {issues.slice(0, 8).map((issue) => (
                    <li key={issue.id}>
                      <button
                        type="button"
                        onClick={() => selectIssue(issue)}
                        className={`text-left text-[13px] leading-relaxed underline decoration-line-strong underline-offset-4 transition-colors hover:text-ink ${issue.severity === 'error' ? 'text-danger' : 'text-ink-2'}`}
                      >
                        {issue.severity === 'error' ? 'Ошибка: ' : 'Проверьте: '}
                        {issue.message}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <PlanObstaclesEditor
            geometry={{ ...geometry, walls, rooms }}
            obstacles={obstacles}
            onChange={setObstacles}
          />
          <KitchenPlanEditor
            geometry={{
              ...geometry,
              walls,
              openings,
              rooms,
              utilityPoints,
              obstacles,
              routeWidthCm,
              routeStartOpeningId,
            }}
            items={kitchenItems}
            onChange={setKitchenItems}
            onOpeningsChange={setOpenings}
            onUtilityPointsChange={setUtilityPoints}
            onRouteWidthChange={setRouteWidthCm}
            onRouteStartChange={setRouteStartOpeningId}
          />
          <div className="mt-6 grid gap-6 sm:grid-cols-[minmax(0,1fr)_minmax(15rem,1fr)]">
            <div>
              <label htmlFor="geometry-element" className="mb-2 block text-[13px] text-ink-2">
                Элемент схемы
              </label>
              <select
                id="geometry-element"
                value={selection}
                onChange={(event) => setSelection(event.currentTarget.value as Selection)}
                className={selectClassName}
              >
                <optgroup label="Стены">
                  {walls.map((wall, index) => (
                    <option key={wall.id} value={`wall:${wall.id}`}>
                      Стена {index + 1} · {wallLength(wall)} см
                    </option>
                  ))}
                </optgroup>
                {openings.length > 0 ? (
                  <optgroup label="Проёмы">
                    {openings.map((opening, index) => (
                      <option key={opening.id} value={`opening:${opening.id}`}>
                        {openingLabel(opening.type)} {index + 1} · {opening.widthCm} см
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {rooms.length > 0 ? (
                  <optgroup label="Контуры комнат">
                    {rooms.map((room, index) => {
                      return (
                        <option key={`${index}-${room.name}`} value={`room:${index}`}>
                          {room.name} · {room.polygon.length} точек
                        </option>
                      )
                    })}
                  </optgroup>
                ) : null}
              </select>

              <div className="mt-5 border border-line bg-muted p-4 text-[13px] leading-relaxed text-ink-2">
                Координаты считаются от левого верхнего угла квартиры: X идёт вправо, Y — вниз.
                Удаление стены также уберёт все привязанные к ней проёмы.
              </div>
            </div>

            <div className="min-w-0">
              {selectedWall ? (
                <div className="space-y-4">
                  <div>
                    <p className="mb-2 text-[13px] text-ink-2">Тип стены</p>
                    <div className="flex gap-2">
                      {(['inner', 'outer'] as const).map((kind) => (
                        <button
                          key={kind}
                          type="button"
                          onClick={() => patchWall({ kind })}
                          className={`rounded-full border px-3 py-2 text-[13px] transition-colors ${selectedWall.kind === kind ? 'border-accent bg-accent-tint text-ink' : 'border-control text-ink-2 hover:border-ink'}`}
                        >
                          {kind === 'outer' ? 'Несущая/внешняя' : 'Перегородка'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className={numberClassName}>
                    <Input
                      id="wall-start-x"
                      label="Начало X, см"
                      type="number"
                      min="0"
                      step="1"
                      value={selectedWall.start.xCm}
                      onChange={(event) =>
                        patchWall({
                          start: { ...selectedWall.start, xCm: Number(event.currentTarget.value) },
                        })
                      }
                    />
                    <Input
                      id="wall-start-y"
                      label="Начало Y, см"
                      type="number"
                      min="0"
                      step="1"
                      value={selectedWall.start.yCm}
                      onChange={(event) =>
                        patchWall({
                          start: { ...selectedWall.start, yCm: Number(event.currentTarget.value) },
                        })
                      }
                    />
                    <Input
                      id="wall-end-x"
                      label="Конец X, см"
                      type="number"
                      min="0"
                      step="1"
                      value={selectedWall.end.xCm}
                      onChange={(event) =>
                        patchWall({
                          end: { ...selectedWall.end, xCm: Number(event.currentTarget.value) },
                        })
                      }
                    />
                    <Input
                      id="wall-end-y"
                      label="Конец Y, см"
                      type="number"
                      min="0"
                      step="1"
                      value={selectedWall.end.yCm}
                      onChange={(event) =>
                        patchWall({
                          end: { ...selectedWall.end, yCm: Number(event.currentTarget.value) },
                        })
                      }
                    />
                  </div>
                </div>
              ) : null}

              {selectedOpening ? (
                <div className="space-y-4">
                  <div>
                    <label htmlFor="opening-type" className="mb-2 block text-[13px] text-ink-2">
                      Тип проёма
                    </label>
                    <select
                      id="opening-type"
                      value={selectedOpening.type}
                      onChange={(event) =>
                        patchOpening({ type: event.currentTarget.value as PlanOpening['type'] })
                      }
                      className={selectClassName}
                    >
                      <option value="door">Дверь</option>
                      <option value="window">Окно</option>
                      <option value="balcony">Балконный блок</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="opening-wall" className="mb-2 block text-[13px] text-ink-2">
                      Стена
                    </label>
                    <select
                      id="opening-wall"
                      value={selectedOpening.wallId}
                      onChange={(event) => patchOpening({ wallId: event.currentTarget.value })}
                      className={selectClassName}
                    >
                      {walls.map((wall, index) => (
                        <option key={wall.id} value={wall.id}>
                          Стена {index + 1} · {wallLength(wall)} см
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className={numberClassName}>
                    <Input
                      id="opening-offset"
                      label="От начала стены, см"
                      type="number"
                      min="0"
                      step="1"
                      value={selectedOpening.offsetCm}
                      onChange={(event) =>
                        patchOpening({ offsetCm: Number(event.currentTarget.value) })
                      }
                    />
                    <Input
                      id="opening-width"
                      label="Ширина, см"
                      type="number"
                      min="30"
                      step="1"
                      value={selectedOpening.widthCm}
                      onChange={(event) =>
                        patchOpening({ widthCm: Number(event.currentTarget.value) })
                      }
                    />
                  </div>
                </div>
              ) : null}

              {selectedRoom ? (
                <div className="border border-line bg-muted p-4">
                  <p className="font-serif text-xl text-ink">{selectedRoom.name}</p>
                  <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
                    Перетаскивайте розовые точки на чертеже. После сохранения контур будет проверен
                    по площади, указанной на исходном плане.
                  </p>
                  <p className="mt-3 font-mono text-[12px] text-ink-2">
                    {selectedRoom.polygon.length} точек контура
                  </p>
                </div>
              ) : null}

              {selectedWall || selectedOpening ? (
                <button
                  type="button"
                  onClick={removeSelected}
                  className="mt-5 text-[13px] text-danger underline decoration-line-strong underline-offset-4"
                >
                  Убрать этот элемент из схемы
                </button>
              ) : !selectedRoom ? (
                <p className="text-[14px] text-ink-2">В схеме не осталось элементов.</p>
              ) : null}
            </div>
          </div>

          <FormError message={error} />
          <div className="mt-6 flex flex-wrap gap-3 border-t border-line pt-5">
            <Button
              type="button"
              onClick={save}
              pending={saving}
              disabled={walls.length < 3 || blockingIssues.length > 0}
            >
              {saving ? 'Проверяем…' : 'Подтвердить и сохранить'}
            </Button>
            <Button type="button" variant="ghost" onClick={reset} disabled={saving}>
              Сбросить правки
            </Button>
          </div>
        </fieldset>
      </DialogContent>
    </Dialog>
  )
}
