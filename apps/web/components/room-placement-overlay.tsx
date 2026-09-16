'use client'

import type { Placement, RoomLayout } from '@uyut/catalog'
import { toast } from '@uyut/ui'
import { useRouter } from 'next/navigation'
import { type PointerEvent, useEffect, useRef, useState, useTransition } from 'react'
import { setItemPlacement } from '@/actions/shopping'

type PlacementInput = RoomLayout['placementInputs'][number]

type ActiveDrag = {
  itemId: string
  pointerId: number
  group: SVGGElement
  svg: SVGSVGElement
  startSvgX: number
  startSvgY: number
  originX: number
  originY: number
  nextX: number
  nextY: number
  rotation: 0 | 90
}

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

/**
 * Прозрачный интерактивный слой над серверным SVG.
 * Во время движения меняется только transform выбранного SVG-узла; React и сервер получают одно
 * обновление после отпускания. Так указатель не тормозит даже на большой схеме.
 */
export function RoomPlacementOverlay({
  placements,
  inputs,
  scale,
  padding,
  width,
  height,
}: {
  placements: Placement[]
  inputs: PlacementInput[]
  scale: number
  padding: number
  width: number
  height: number
}) {
  const router = useRouter()
  const inputById = new Map(inputs.map((input) => [input.id, input]))
  const active = useRef<ActiveDrag | null>(null)
  const [ready, setReady] = useState(false)
  const [draggingPlacementId, setDraggingPlacementId] = useState<string>()
  const [saving, startSaving] = useTransition()

  useEffect(() => setReady(true), [])

  function begin(event: PointerEvent<SVGGElement>, place: Placement) {
    if (saving) return
    const input = inputById.get(place.itemId)
    const svg = event.currentTarget.ownerSVGElement
    if (!input || !svg) return
    const point = svgPoint(event, svg)
    if (!point) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    active.current = {
      itemId: place.itemId,
      pointerId: event.pointerId,
      group: event.currentTarget,
      svg,
      startSvgX: point.x,
      startSvgY: point.y,
      originX: place.xCm,
      originY: place.yCm,
      nextX: place.xCm,
      nextY: place.yCm,
      rotation: displayedRotation(place, input),
    }
    setDraggingPlacementId(place.id)
  }

  function move(event: PointerEvent<SVGElement>) {
    const drag = active.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const point = svgPoint(event, drag.svg)
    if (!point) return
    const nextX = Math.round(drag.originX + (point.x - drag.startSvgX) / scale)
    const nextY = Math.round(drag.originY + (point.y - drag.startSvgY) / scale)
    drag.nextX = nextX
    drag.nextY = nextY
    drag.group.setAttribute(
      'transform',
      `translate(${(nextX - drag.originX) * scale} ${(nextY - drag.originY) * scale})`,
    )
  }

  function cancel(event: PointerEvent<SVGElement>) {
    const drag = active.current
    if (!drag || drag.pointerId !== event.pointerId) return
    drag.group.removeAttribute('transform')
    active.current = null
    setDraggingPlacementId(undefined)
  }

  function finish(event: PointerEvent<SVGElement>) {
    const drag = active.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (drag.group.hasPointerCapture(event.pointerId)) {
      drag.group.releasePointerCapture(event.pointerId)
    }
    drag.group.removeAttribute('transform')
    active.current = null
    setDraggingPlacementId(undefined)
    startSaving(async () => {
      const result = await setItemPlacement(drag.itemId, {
        mode: 'exact',
        xCm: String(Math.max(0, drag.nextX)),
        yCm: String(Math.max(0, drag.nextY)),
        rotation: String(drag.rotation),
      })
      if (!result.ok) {
        toast({ title: result.error, tone: 'danger' })
        return
      }
      toast({ title: 'Положение мебели проверено', tone: 'success' })
      router.refresh()
    })
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
          <g
            key={place.id}
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
              x={padding + place.xCm * scale}
              y={padding + place.yCm * scale}
              width={place.widthCm * scale}
              height={place.depthCm * scale}
              rx="2"
              className={
                draggingPlacementId === place.id
                  ? 'fill-accent/25 stroke-accent'
                  : 'fill-transparent stroke-transparent transition-colors hover:fill-accent/10 hover:stroke-accent'
              }
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              pointerEvents="all"
            />
          </g>
        )
      })}
      {saving ? (
        <text x={padding} y={18} className="fill-ink-2 text-[11px]">
          Проверяем место…
        </text>
      ) : null}
    </svg>
  )
}
