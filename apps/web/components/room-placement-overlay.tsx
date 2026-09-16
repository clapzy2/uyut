'use client'

import type { FloorReservation, LayoutPoint, Placement, RoomLayout } from '@uyut/catalog'
import {
  functionalZoneRect,
  type Rect,
  rectInsideFloor,
  rectOverlapsPolygon,
} from '@uyut/catalog/layout'
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
type PreviewBlock = Rect & { placementId?: string }
type PreviewIssue = 'outside' | 'collision' | 'blocked' | 'operation'

type ActiveDrag = {
  itemId: string
  placementId: string
  pointerId: number
  group: SVGGElement
  hitbox: SVGRectElement
  zonePreview: SVGRectElement | null
  baseZones: SVGElement[]
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
  issue?: PreviewIssue
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
  let verticalWall: 'left' | 'right' | undefined
  let horizontalWall: 'top' | 'bottom' | undefined
  if (Math.abs(x) <= WALL_SNAP_CM) {
    x = 0
    verticalWall = 'left'
  } else if (Math.abs(roomWidthCm - (x + widthCm)) <= WALL_SNAP_CM) {
    x = roomWidthCm - widthCm
    verticalWall = 'right'
  }
  if (Math.abs(y) <= WALL_SNAP_CM) {
    y = 0
    horizontalWall = 'top'
  } else if (Math.abs(roomDepthCm - (y + depthCm)) <= WALL_SNAP_CM) {
    y = roomDepthCm - depthCm
    horizontalWall = 'bottom'
  }
  return { xCm: x, yCm: y, verticalWall, horizontalWall }
}

function wallForRect(rect: Rect, roomWidthCm: number, roomDepthCm: number): Placement['wall'] {
  if (Math.abs(rect.yCm) <= EPSILON) return 'top'
  if (Math.abs(rect.yCm + rect.depthCm - roomDepthCm) <= EPSILON) return 'bottom'
  if (Math.abs(rect.xCm) <= EPSILON) return 'left'
  if (Math.abs(rect.xCm + rect.widthCm - roomWidthCm) <= EPSILON) return 'right'
  return 'center'
}

const ISSUE_TEXT: Record<PreviewIssue, string> = {
  outside: 'Сюда нельзя: предмет выходит за границу комнаты',
  collision: 'Сюда нельзя: мешает другая мебель',
  blocked: 'Сюда нельзя: мешает проём или инженерная зона',
  operation: 'Сюда нельзя: не хватает места для открывания или использования',
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
  const zoneByPlacementId = useMemo(
    () => new Map(functionalZones.map((zone) => [zone.placementId, zone])),
    [functionalZones],
  )
  const active = useRef<ActiveDrag | null>(null)
  const status = useRef<SVGTextElement | null>(null)
  const verticalGuide = useRef<SVGLineElement | null>(null)
  const horizontalGuide = useRef<SVGLineElement | null>(null)
  const [ready, setReady] = useState(false)
  const [draggingPlacementId, setDraggingPlacementId] = useState<string>()
  const [saving, startSaving] = useTransition()

  const blocks = useMemo<PreviewBlock[]>(() => {
    const result: PreviewBlock[] = []
    for (const zone of functionalZones) result.push({ ...zone, placementId: zone.placementId })
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

  function insideRoom(candidate: Rect): boolean {
    const insideBounds =
      candidate.xCm >= 0 &&
      candidate.yCm >= 0 &&
      candidate.xCm + candidate.widthCm <= roomWidthCm + EPSILON &&
      candidate.yCm + candidate.depthCm <= roomDepthCm + EPSILON
    if (!insideBounds) return false
    return !floorPolygon || rectInsideFloor(candidate, floorPolygon)
  }

  function previewVerdict(
    candidate: Rect,
    placementId: string,
    candidateZone?: Rect,
  ): { valid: boolean; issue?: PreviewIssue } {
    if (!insideRoom(candidate)) return { valid: false, issue: 'outside' }
    if (placements.some((place) => place.id !== placementId && overlaps(candidate, place))) {
      return { valid: false, issue: 'collision' }
    }
    if (keepClearZones.some((zone) => rectOverlapsPolygon(candidate, zone.polygon))) {
      return { valid: false, issue: 'blocked' }
    }
    if (blocks.some((block) => block.placementId !== placementId && overlaps(candidate, block))) {
      return { valid: false, issue: 'blocked' }
    }
    if (!candidateZone) return { valid: true }
    if (!insideRoom(candidateZone)) return { valid: false, issue: 'operation' }
    if (
      placements.some((place) => place.id !== placementId && overlaps(candidateZone, place)) ||
      blocks.some((block) => block.placementId !== placementId && overlaps(candidateZone, block)) ||
      keepClearZones.some((zone) => rectOverlapsPolygon(candidateZone, zone.polygon))
    ) {
      return { valid: false, issue: 'operation' }
    }
    return { valid: true }
  }

  function operationZoneAt(candidate: Rect, placementId: string): Rect | undefined {
    const zone = zoneByPlacementId.get(placementId)
    if (!zone) return undefined
    const wall = wallForRect(candidate, roomWidthCm, roomDepthCm)
    return functionalZoneRect(candidate, zone, wall)
  }

  function setStatus(message: string, valid: boolean) {
    if (!status.current) return
    status.current.textContent = message
    status.current.setAttribute(
      'class',
      valid ? 'fill-accent text-[11px]' : 'fill-danger text-[11px]',
    )
  }

  function setGuides(next: ReturnType<typeof snappedPosition>) {
    if (verticalGuide.current) {
      if (next.verticalWall) {
        const x = next.verticalWall === 'left' ? padding : padding + roomWidthCm * scale
        verticalGuide.current.setAttribute('x1', String(x))
        verticalGuide.current.setAttribute('x2', String(x))
        verticalGuide.current.setAttribute('data-visible', 'true')
      } else {
        verticalGuide.current.removeAttribute('data-visible')
      }
    }
    if (horizontalGuide.current) {
      if (next.horizontalWall) {
        const y = next.horizontalWall === 'top' ? padding : padding + roomDepthCm * scale
        horizontalGuide.current.setAttribute('y1', String(y))
        horizontalGuide.current.setAttribute('y2', String(y))
        horizontalGuide.current.setAttribute('data-visible', 'true')
      } else {
        horizontalGuide.current.removeAttribute('data-visible')
      }
    }
  }

  function showZonePreview(drag: ActiveDrag, zone: Rect | undefined, valid: boolean) {
    const preview = drag.zonePreview
    if (!preview || !zone) {
      preview?.removeAttribute('data-visible')
      return
    }
    preview.setAttribute('x', String(padding + zone.xCm * scale))
    preview.setAttribute('y', String(padding + zone.yCm * scale))
    preview.setAttribute('width', String(zone.widthCm * scale))
    preview.setAttribute('height', String(zone.depthCm * scale))
    preview.setAttribute('data-preview', valid ? 'valid' : 'invalid')
    preview.setAttribute('data-visible', 'true')
  }

  function clearPreview(drag: ActiveDrag) {
    drag.group.removeAttribute('transform')
    drag.group.removeAttribute('data-preview')
    drag.hitbox.removeAttribute('data-preview')
    drag.zonePreview?.removeAttribute('data-visible')
    drag.zonePreview?.removeAttribute('data-preview')
    for (const zone of drag.baseZones) zone.removeAttribute('visibility')
    verticalGuide.current?.removeAttribute('data-visible')
    horizontalGuide.current?.removeAttribute('data-visible')
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
    const zonePreview =
      event.currentTarget.parentElement?.querySelector<SVGRectElement>('[data-zone-preview]') ??
      null
    if (!input || !svg || !hitbox) return
    const point = svgPoint(event, svg)
    if (!point) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const baseZones = Array.from(
      svg.parentElement?.querySelectorAll<SVGElement>('[data-functional-zone-placement-id]') ?? [],
    ).filter((zone) => zone.getAttribute('data-functional-zone-placement-id') === place.id)
    for (const zone of baseZones) zone.setAttribute('visibility', 'hidden')
    active.current = {
      itemId: place.itemId,
      placementId: place.id,
      pointerId: event.pointerId,
      group: event.currentTarget,
      hitbox,
      zonePreview,
      baseZones,
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
    const candidateZone = operationZoneAt(candidate, drag.placementId)
    const verdict = previewVerdict(candidate, drag.placementId, candidateZone)
    drag.valid = verdict.valid
    drag.issue = verdict.issue
    const preview = drag.valid ? 'valid' : 'invalid'
    drag.group.dataset.preview = preview
    drag.hitbox.dataset.preview = preview
    drag.group.setAttribute(
      'transform',
      `translate(${(next.xCm - drag.originX) * scale} ${(next.yCm - drag.originY) * scale})`,
    )
    showZonePreview(drag, candidateZone, verdict.valid)
    setGuides(next)
    setStatus(
      drag.valid
        ? next.verticalWall || next.horizontalWall
          ? candidateZone
            ? 'Привязано к стене · мебель и рабочая зона помещаются'
            : 'Привязано к стене · место свободно'
          : candidateZone
            ? `Место и рабочая зона свободны · ${next.xCm} × ${next.yCm} см`
            : `Место свободно · ${next.xCm} × ${next.yCm} см`
        : ISSUE_TEXT[verdict.issue ?? 'blocked'],
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
        title: ISSUE_TEXT[drag.issue ?? 'blocked'],
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
    const candidate = { xCm: next.xCm, yCm: next.yCm, widthCm, depthCm }
    const verdict = previewVerdict(candidate, place.id, operationZoneAt(candidate, place.id))
    if (!verdict.valid) {
      toast({
        title:
          verdict.issue === 'operation'
            ? 'После поворота не хватает места для открывания или использования'
            : ISSUE_TEXT[verdict.issue ?? 'blocked'],
        tone: 'danger',
      })
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
            {movable ? (
              <rect
                data-zone-preview
                x={0}
                y={0}
                width={0}
                height={0}
                pointerEvents="none"
                className="opacity-0 transition-opacity data-[visible=true]:opacity-100 data-[preview=valid]:fill-accent/10 data-[preview=valid]:stroke-accent data-[preview=invalid]:fill-danger/15 data-[preview=invalid]:stroke-danger"
                strokeWidth={1.5}
                strokeDasharray="5 4"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
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
      <line
        ref={verticalGuide}
        y1={padding}
        y2={padding + roomDepthCm * scale}
        pointerEvents="none"
        className="stroke-accent opacity-0 transition-opacity data-[visible=true]:opacity-100"
        strokeWidth={1.5}
        strokeDasharray="3 3"
        vectorEffect="non-scaling-stroke"
      />
      <line
        ref={horizontalGuide}
        x1={padding}
        x2={padding + roomWidthCm * scale}
        pointerEvents="none"
        className="stroke-accent opacity-0 transition-opacity data-[visible=true]:opacity-100"
        strokeWidth={1.5}
        strokeDasharray="3 3"
        vectorEffect="non-scaling-stroke"
      />
      <text ref={status} x={padding} y={18} aria-live="polite" />
      {saving ? (
        <text x={padding} y={18} className="fill-ink-2 text-[11px]">
          Проверяем место…
        </text>
      ) : null}
    </svg>
  )
}
