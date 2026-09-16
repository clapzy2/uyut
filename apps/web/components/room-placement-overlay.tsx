'use client'

import {
  type FloorReservation,
  type LayoutPoint,
  type Placement,
  type Rect,
  type RoomLayout,
  rectInsideFloor,
  rectOverlapsPolygon,
} from '@uyut/catalog'
import { toast } from '@uyut/ui'
import { useRouter } from 'next/navigation'
import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react'
import { setItemPlacement } from '@/actions/shopping'

type PlacementInput = RoomLayout['placementInputs'][number]
type WallReservation = RoomLayout['reservations'][number]
type PreviewBlock = Rect & { itemId?: string }

type ActiveDrag = {
  itemId: string
  placementId: string
  pointerId: number
  group: SVGGElement
  hitbox: SVGRectElement
  svg: SVGSVGElement
  startSvgX: number
  startSvgY: number
  originX: number
  originY: number
  nextX: number
  nextY: number
  widthCm: number
  depthCm: number
  rotation: 0 | 90
  valid: boolean
}

const GRID_CM = 5
const WALL_SNAP_CM = 10
const EPSILON = 0.01

function svgPoint(event: PointerEvent<SVGElement>, svg: SVGSVGElement) {
  const matrix = svg.getScreenCTM()
  if (!matrix) return null
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
  return { x: point.x, y: point.y }
}

function displayedRotation(place: Placement, input: PlacementInput): 0 | 90 {
  if (input.xCm !== undefined && input.yCm !== undefined) return input.rotation
  const normal =
    Math.abs(place.widthCm - input.widthCm) < 0.5 && Math.abs(place.depthCm - input.depthCm) < 0.5
  return normal ? 0 : 90
}

function pointOnSegment(point: LayoutPoint, start: LayoutPoint, end: LayoutPoint): boolean {
  const cross =
    (point.xCm - start.xCm) * (end.yCm - start.yCm) -
    (point.yCm - start.yCm) * (end.xCm - start.xCm)
  if (Math.abs(cross) > EPSILON) return false
  return (
    point.xCm >= Math.min(start.xCm, end.xCm) - EPSILON &&
    point.xCm <= Math.max(start.xCm, end.xCm) + EPSILON &&
    point.yCm >= Math.min(start.yCm, end.yCm) - EPSILON &&
    point.yCm <= Math.max(start.yCm, end.yCm) + EPSILON
  )
}

function pointInPolygon(point: LayoutPoint, polygon: readonly LayoutPoint[]): boolean {
  let inside = false
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index]
    const end = polygon[(index + 1) % polygon.length]
    if (!start || !end) continue
    if (pointOnSegment(point, start, end)) return true
    if (
      start.yCm > point.yCm !== end.yCm > point.yCm &&
      point.xCm <
        ((end.xCm - start.xCm) * (point.yCm - start.yCm)) / (end.yCm - start.yCm) + start.xCm
    ) {
      inside = !inside
    }
  }
  return inside
}

function overlaps(first: Rect, second: Rect): boolean {
  return (
    first.xCm < second.xCm + second.widthCm - EPSILON &&
    first.xCm + first.widthCm > second.xCm + EPSILON &&
    first.yCm < second.yCm + second.depthCm - EPSILON &&
    first.yCm + first.depthCm > second.yCm + EPSILON
  )
}

function exactClearanceRect(
  reservation: FloorReservation,
  polygon: readonly LayoutPoint[],
): Rect | null {
  if (reservation.clearanceCm <= 0) return null
  const horizontal = Math.abs(reservation.start.yCm - reservation.end.yCm) < 1
  if (horizontal) {
    const fromCm = Math.min(reservation.start.xCm, reservation.end.xCm)
    const toCm = Math.max(reservation.start.xCm, reservation.end.xCm)
    const yCm = (reservation.start.yCm + reservation.end.yCm) / 2
    const insideBelow = pointInPolygon({ xCm: (fromCm + toCm) / 2, yCm: yCm + 1 }, polygon)
    return {
      xCm: fromCm,
      yCm: insideBelow ? yCm : yCm - reservation.clearanceCm,
      widthCm: toCm - fromCm,
      depthCm: reservation.clearanceCm,
    }
  }
  const fromCm = Math.min(reservation.start.yCm, reservation.end.yCm)
  const toCm = Math.max(reservation.start.yCm, reservation.end.yCm)
  const xCm = (reservation.start.xCm + reservation.end.xCm) / 2
  const insideRight = pointInPolygon({ xCm: xCm + 1, yCm: (fromCm + toCm) / 2 }, polygon)
  return {
    xCm: insideRight ? xCm : xCm - reservation.clearanceCm,
    yCm: fromCm,
    widthCm: reservation.clearanceCm,
    depthCm: toCm - fromCm,
  }
}

function wallClearanceRect(
  reservation: WallReservation,
  roomWidthCm: number,
  roomDepthCm: number,
): Rect | null {
  if (reservation.clearanceCm <= 0) return null
  const length = reservation.toCm - reservation.fromCm
  if (reservation.wall === 'top' || reservation.wall === 'bottom') {
    return {
      xCm: reservation.fromCm,
      yCm: reservation.wall === 'bottom' ? roomDepthCm - reservation.clearanceCm : 0,
      widthCm: length,
      depthCm: reservation.clearanceCm,
    }
  }
  return {
    xCm: reservation.wall === 'right' ? roomWidthCm - reservation.clearanceCm : 0,
    yCm: reservation.fromCm,
    widthCm: reservation.clearanceCm,
    depthCm: length,
  }
}

function snappedPosition(
  xCm: number,
  yCm: number,
  widthCm: number,
  depthCm: number,
  roomWidthCm: number,
  roomDepthCm: number,
) {
  let x = Math.round(xCm / GRID_CM) * GRID_CM
  let y = Math.round(yCm / GRID_CM) * GRID_CM
  let wall = false
  if (Math.abs(x) <= WALL_SNAP_CM) {
    x = 0
    wall = true
  } else if (Math.abs(roomWidthCm - (x + widthCm)) <= WALL_SNAP_CM) {
    x = roomWidthCm - widthCm
    wall = true
  }
  if (Math.abs(y) <= WALL_SNAP_CM) {
    y = 0
    wall = true
  } else if (Math.abs(roomDepthCm - (y + depthCm)) <= WALL_SNAP_CM) {
    y = roomDepthCm - depthCm
    wall = true
  }
  return { xCm: x, yCm: y, wall }
}

/**
 * Прозрачный интерактивный слой над серверным SVG.
 * Во время движения меняются только атрибуты выбранного SVG-узла; React и сервер получают одно
 * обновление после отпускания. Сервер повторно выполняет полную проверку перед сохранением.
 */
export function RoomPlacementOverlay({
  placements,
  inputs,
  scale,
  padding,
  width,
  height,
  roomWidthCm,
  roomDepthCm,
  floorPolygon,
  reservations,
  floorReservations,
  keepClearZones,
  functionalZones,
}: {
  placements: Placement[]
  inputs: PlacementInput[]
  scale: number
  padding: number
  width: number
  height: number
  roomWidthCm: number
  roomDepthCm: number
  floorPolygon?: LayoutPoint[]
  reservations: RoomLayout['reservations']
  floorReservations: RoomLayout['floorReservations']
  keepClearZones: RoomLayout['keepClearZones']
  functionalZones: RoomLayout['functionalZones']
}) {
  const router = useRouter()
  const inputById = useMemo(() => new Map(inputs.map((input) => [input.id, input])), [inputs])
  const active = useRef<ActiveDrag | null>(null)
  const status = useRef<SVGTextElement | null>(null)
  const [ready, setReady] = useState(false)
  const [draggingPlacementId, setDraggingPlacementId] = useState<string>()
  const [saving, startSaving] = useTransition()

  const blocks = useMemo<PreviewBlock[]>(() => {
    const result: PreviewBlock[] = []
    for (const zone of functionalZones) result.push({ ...zone, itemId: zone.itemId })
    if (floorReservations.length > 0 && floorPolygon) {
      for (const reservation of floorReservations) {
        const rect = exactClearanceRect(reservation, floorPolygon)
        if (rect) result.push(rect)
      }
    } else {
      for (const reservation of reservations) {
        const rect = wallClearanceRect(reservation, roomWidthCm, roomDepthCm)
        if (rect) result.push(rect)
      }
    }
    return result
  }, [floorPolygon, floorReservations, functionalZones, reservations, roomDepthCm, roomWidthCm])

  useEffect(() => setReady(true), [])

  function isValid(candidate: Rect, placementId: string, itemId: string): boolean {
    const insideBounds =
      candidate.xCm >= 0 &&
      candidate.yCm >= 0 &&
      candidate.xCm + candidate.widthCm <= roomWidthCm + EPSILON &&
      candidate.yCm + candidate.depthCm <= roomDepthCm + EPSILON
    if (!insideBounds) return false
    if (floorPolygon && !rectInsideFloor(candidate, floorPolygon)) return false
    if (placements.some((place) => place.id !== placementId && overlaps(candidate, place))) {
      return false
    }
    if (keepClearZones.some((zone) => rectOverlapsPolygon(candidate, zone.polygon))) return false
    return !blocks.some((block) => block.itemId !== itemId && overlaps(candidate, block))
  }

  function setStatus(message: string, valid: boolean) {
    if (!status.current) return
    status.current.textContent = message
    status.current.setAttribute(
      'class',
      valid ? 'fill-accent text-[11px]' : 'fill-danger text-[11px]',
    )
  }

  function clearPreview(drag: ActiveDrag) {
    drag.group.removeAttribute('transform')
    drag.group.removeAttribute('data-preview')
    drag.hitbox.removeAttribute('data-preview')
    if (status.current) status.current.textContent = ''
  }

  function savePlacement(
    itemId: string,
    xCm: number,
    yCm: number,
    rotation: 0 | 90,
    successTitle: string,
  ) {
    startSaving(async () => {
      const result = await setItemPlacement(itemId, {
        mode: 'exact',
        xCm: String(xCm),
        yCm: String(yCm),
        rotation: String(rotation),
      })
      if (!result.ok) {
        toast({ title: result.error, tone: 'danger' })
        return
      }
      toast({ title: successTitle, tone: 'success' })
      router.refresh()
    })
  }

  function begin(event: PointerEvent<SVGGElement>, place: Placement) {
    if (saving) return
    const input = inputById.get(place.itemId)
    const svg = event.currentTarget.ownerSVGElement
    const hitbox = event.currentTarget.querySelector<SVGRectElement>('[data-hitbox]')
    if (!input || !svg || !hitbox) return
    const point = svgPoint(event, svg)
    if (!point) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    active.current = {
      itemId: place.itemId,
      placementId: place.id,
      pointerId: event.pointerId,
      group: event.currentTarget,
      hitbox,
      svg,
      startSvgX: point.x,
      startSvgY: point.y,
      originX: place.xCm,
      originY: place.yCm,
      nextX: place.xCm,
      nextY: place.yCm,
      widthCm: place.widthCm,
      depthCm: place.depthCm,
      rotation: displayedRotation(place, input),
      valid: true,
    }
    setDraggingPlacementId(place.id)
    setStatus('Двигайте предмет — место проверяется сразу', true)
  }

  function move(event: PointerEvent<SVGElement>) {
    const drag = active.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const point = svgPoint(event, drag.svg)
    if (!point) return
    const rawX = drag.originX + (point.x - drag.startSvgX) / scale
    const rawY = drag.originY + (point.y - drag.startSvgY) / scale
    const next = snappedPosition(rawX, rawY, drag.widthCm, drag.depthCm, roomWidthCm, roomDepthCm)
    const candidate = {
      xCm: next.xCm,
      yCm: next.yCm,
      widthCm: drag.widthCm,
      depthCm: drag.depthCm,
    }
    drag.nextX = next.xCm
    drag.nextY = next.yCm
    drag.valid = isValid(candidate, drag.placementId, drag.itemId)
    const preview = drag.valid ? 'valid' : 'invalid'
    drag.group.dataset.preview = preview
    drag.hitbox.dataset.preview = preview
    drag.group.setAttribute(
      'transform',
      `translate(${(next.xCm - drag.originX) * scale} ${(next.yCm - drag.originY) * scale})`,
    )
    setStatus(
      drag.valid
        ? next.wall
          ? 'Привязано к стене · место свободно'
          : `Место свободно · ${next.xCm} × ${next.yCm} см`
        : 'Сюда нельзя: мешает граница, проём или мебель',
      drag.valid,
    )
  }

  function cancel(event: PointerEvent<SVGElement>) {
    const drag = active.current
    if (!drag || drag.pointerId !== event.pointerId) return
    clearPreview(drag)
    active.current = null
    setDraggingPlacementId(undefined)
  }

  function finish(event: PointerEvent<SVGElement>) {
    const drag = active.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (drag.group.hasPointerCapture(event.pointerId))
      drag.group.releasePointerCapture(event.pointerId)
    clearPreview(drag)
    active.current = null
    setDraggingPlacementId(undefined)
    if (!drag.valid) {
      toast({
        title: 'Сюда поставить нельзя: мешает граница, проём или другая мебель',
        tone: 'danger',
      })
      return
    }
    savePlacement(drag.itemId, drag.nextX, drag.nextY, drag.rotation, 'Положение мебели проверено')
  }

  function rotate(place: Placement) {
    if (saving) return
    const input = inputById.get(place.itemId)
    if (!input) return
    const rotation = displayedRotation(place, input) === 0 ? 90 : 0
    const widthCm = rotation === 0 ? input.widthCm : input.depthCm
    const depthCm = rotation === 0 ? input.depthCm : input.widthCm
    const next = snappedPosition(place.xCm, place.yCm, widthCm, depthCm, roomWidthCm, roomDepthCm)
    if (!isValid({ xCm: next.xCm, yCm: next.yCm, widthCm, depthCm }, place.id, place.itemId)) {
      toast({ title: 'Для поворота здесь не хватает свободного места', tone: 'danger' })
      return
    }
    savePlacement(place.itemId, next.xCm, next.yCm, rotation, 'Мебель повёрнута и проверена')
  }

  function rotateFromKeyboard(event: KeyboardEvent<SVGGElement>, place: Placement) {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    rotate(place)
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className="absolute inset-0 h-auto max-w-full touch-none overflow-visible"
      aria-label="Перемещение мебели по плану"
      data-ready={ready ? 'true' : 'false'}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={cancel}
    >
      {placements.map((place) => {
        const movable = inputById.has(place.itemId)
        return (
          <g key={place.id}>
            <g
              role={movable ? 'button' : undefined}
              aria-label={movable ? `Переместить: ${place.title}` : undefined}
              data-dragging={draggingPlacementId === place.id ? 'true' : undefined}
              tabIndex={movable ? 0 : undefined}
              className={
                movable ? 'cursor-grab focus:outline-none active:cursor-grabbing' : undefined
              }
              onPointerDown={movable ? (event) => begin(event, place) : undefined}
              onPointerMove={movable ? move : undefined}
              onPointerUp={movable ? finish : undefined}
              onPointerCancel={movable ? cancel : undefined}
            >
              <rect
                data-hitbox
                x={padding + place.xCm * scale}
                y={padding + place.yCm * scale}
                width={place.widthCm * scale}
                height={place.depthCm * scale}
                rx="2"
                className="fill-transparent stroke-transparent transition-colors hover:fill-accent/10 hover:stroke-accent data-[preview=valid]:fill-accent/30 data-[preview=valid]:stroke-accent data-[preview=invalid]:fill-danger/30 data-[preview=invalid]:stroke-danger"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
                pointerEvents="all"
              />
            </g>
            {movable ? (
              // SVG has no native button element; the exact form below remains the non-pointer fallback.
              // biome-ignore lint/a11y/useSemanticElements: interactive SVG rotation handle
              <g
                role="button"
                aria-label={`Повернуть: ${place.title}`}
                tabIndex={0}
                className="cursor-pointer focus:outline-none"
                onPointerDown={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  rotate(place)
                }}
                onKeyDown={(event) => rotateFromKeyboard(event, place)}
              >
                <circle
                  cx={padding + (place.xCm + place.widthCm) * scale}
                  cy={padding + place.yCm * scale}
                  r={11}
                  className="fill-surface stroke-accent transition-colors hover:fill-accent-tint"
                  strokeWidth={1.5}
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  x={padding + (place.xCm + place.widthCm) * scale}
                  y={padding + place.yCm * scale + 0.5}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="pointer-events-none fill-accent text-[13px] font-medium"
                >
                  ↻
                </text>
              </g>
            ) : null}
          </g>
        )
      })}
      <text ref={status} x={padding} y={18} aria-live="polite" />
      {saving ? (
        <text x={padding} y={18} className="fill-ink-2 text-[11px]">
          Проверяем место…
        </text>
      ) : null}
    </svg>
  )
}
