// biome-ignore-all lint/suspicious/noArrayIndexKey: ordered native vertices
import type { PageContourDraft, PageContourTarget } from './plan-page-contour-editor-model'
import { finiteContourPoint } from './plan-page-contour-editor-model'
import { pageFeatureLabels } from './plan-page-features'

export function PlanPageFeatureOverlay({
  drafts,
  roomNumber,
  target,
}: {
  drafts: PageContourDraft[]
  roomNumber: number
  target: PageContourTarget
}) {
  return (
    <g pointerEvents="none">
      {drafts.map((room) => (
        <g key={room.roomSourceNumber}>
          {room.openings?.map((opening) => {
            const selected =
              room.roomSourceNumber === roomNumber &&
              target.kind === 'opening' &&
              target.id === opening.id
            const [start, end] = opening.points
            return (
              <g key={opening.id} className={selected ? 'text-accent' : 'text-ink-2'}>
                <title>
                  {pageFeatureLabels[opening.kind]}, комната № {room.roomSourceNumber}
                </title>
                {start && end && finiteContourPoint(start) && finiteContourPoint(end) ? (
                  <line
                    x1={start.x}
                    y1={start.y}
                    x2={end.x}
                    y2={end.y}
                    stroke="currentColor"
                    strokeWidth={selected ? 5 : 3}
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}
                {opening.points.filter(finiteContourPoint).map((point, index) => (
                  <circle
                    key={index}
                    cx={point.x}
                    cy={point.y}
                    r={5}
                    fill="currentColor"
                    stroke="white"
                    strokeWidth={1}
                  />
                ))}
              </g>
            )
          })}
          {room.obstacles?.map((obstacle) => {
            const selected =
              room.roomSourceNumber === roomNumber &&
              target.kind === 'obstacle' &&
              target.id === obstacle.id
            const valid = obstacle.polygon.every(finiteContourPoint)
            const coordinates = obstacle.polygon.map((point) => `${point.x},${point.y}`).join(' ')
            return (
              <g key={obstacle.id} className={selected ? 'text-accent' : 'text-ink-2'}>
                <title>
                  {pageFeatureLabels[obstacle.kind]}, комната № {room.roomSourceNumber}
                </title>
                {valid && obstacle.closed ? (
                  <polygon
                    points={coordinates}
                    fill="currentColor"
                    fillOpacity={0.32}
                    stroke="currentColor"
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                  />
                ) : valid ? (
                  <polyline
                    points={coordinates}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}
                {obstacle.polygon.filter(finiteContourPoint).map((point, index) => (
                  <circle
                    key={index}
                    cx={point.x}
                    cy={point.y}
                    r={4}
                    fill="currentColor"
                    stroke="white"
                    strokeWidth={1}
                  />
                ))}
              </g>
            )
          })}
          {room.roomSourceNumber === roomNumber && target.kind === 'opening'
            ? room.polygon.map((point, index) => {
                const next = room.polygon[(index + 1) % room.polygon.length]
                if (!next || !finiteContourPoint(point) || !finiteContourPoint(next)) return null
                return (
                  <text
                    key={index}
                    x={(point.x + next.x) / 2}
                    y={(point.y + next.y) / 2 - 5}
                    fill="#222"
                    stroke="white"
                    strokeWidth={3}
                    paintOrder="stroke"
                    fontSize={16}
                  >
                    С{index + 1}
                  </text>
                )
              })
            : null}
        </g>
      ))}
    </g>
  )
}
