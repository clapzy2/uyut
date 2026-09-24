import type { PlanGeometry, PlanOpening, PlanPoint, PlanWall } from '@uyut/db'
import type { ReactNode } from 'react'
import { doorClearanceZone } from '@/lib/projects/clearance-zones'
import { obstacleTitle } from '@/lib/projects/plan-obstacles'

function along(wall: PlanWall, distanceCm: number): PlanPoint {
  const length = Math.hypot(wall.end.xCm - wall.start.xCm, wall.end.yCm - wall.start.yCm)
  const ratio = length === 0 ? 0 : distanceCm / length
  return {
    xCm: wall.start.xCm + (wall.end.xCm - wall.start.xCm) * ratio,
    yCm: wall.start.yCm + (wall.end.yCm - wall.start.yCm) * ratio,
  }
}

function openingLine(opening: PlanOpening, wall: PlanWall): { start: PlanPoint; end: PlanPoint } {
  return {
    start: along(wall, opening.offsetCm),
    end: along(wall, opening.offsetCm + opening.widthCm),
  }
}

function centre(points: PlanPoint[]): PlanPoint {
  const sum = points.reduce(
    (result, point) => ({ xCm: result.xCm + point.xCm, yCm: result.yCm + point.yCm }),
    { xCm: 0, yCm: 0 },
  )
  return { xCm: sum.xCm / points.length, yCm: sum.yCm / points.length }
}

export function PlanGeometryPreview({
  geometry,
  action,
}: {
  geometry: PlanGeometry
  action?: ReactNode
}) {
  const padding = Math.max(20, Math.min(geometry.widthCm, geometry.heightCm) * 0.06)
  const wallById = new Map(geometry.walls.map((wall) => [wall.id, wall]))
  let description =
    'Схема построена по изображению плана и прошла машинную проверку размеров. Она пока не является обмерным чертежом: перед расчётом мебели нужно сверить стены и проёмы с оригиналом.'
  if (geometry.source === 'manual') {
    description =
      geometry.status === 'draft'
        ? 'Это ручной черновик. Программа не прочитала план и не добавила стен сама. Нанесите линии и контуры по оригиналу; пустая сетка не является планировкой квартиры.'
        : 'Схему составил и сверил с планом владелец. Она не заменяет обмер квартиры на месте: перед покупкой мебели проверьте ключевые размеры.'
  }

  return (
    <section className="mt-12 animate-[rise-in_450ms_var(--ease-appear)] border-t border-line pt-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-2">
            2D-схема · {geometry.status === 'confirmed' ? 'подтверждена' : 'черновик'}
            {geometry.source === 'manual' ? ' · составлена вручную' : ''}
          </p>
          <h2 className="mt-2 font-serif text-3xl text-ink">Стены и проёмы</h2>
        </div>
        <p className="font-mono text-[12px] text-ink-2">
          {geometry.walls.length} стен · {geometry.openings.length} проёмов ·{' '}
          {geometry.rooms.length} контуров
        </p>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,8fr)_minmax(15rem,4fr)]">
        <div className="blueprint-grid overflow-hidden border border-line bg-paper p-4 sm:p-7">
          <svg
            viewBox={`${-padding} ${-padding} ${geometry.widthCm + padding * 2} ${geometry.heightCm + padding * 2}`}
            role="img"
            aria-label="Черновая двухмерная схема квартиры"
            className="block aspect-[4/3] w-full"
          >
            <g fill="none" stroke="var(--ink-2)" strokeOpacity="0.75">
              <line
                x1="0"
                y1={-padding * 0.48}
                x2={geometry.widthCm}
                y2={-padding * 0.48}
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1="0"
                y1={-padding * 0.68}
                x2="0"
                y2={-padding * 0.28}
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1={geometry.widthCm}
                y1={-padding * 0.68}
                x2={geometry.widthCm}
                y2={-padding * 0.28}
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1={-padding * 0.48}
                y1="0"
                x2={-padding * 0.48}
                y2={geometry.heightCm}
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1={-padding * 0.68}
                y1="0"
                x2={-padding * 0.28}
                y2="0"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1={-padding * 0.68}
                y1={geometry.heightCm}
                x2={-padding * 0.28}
                y2={geometry.heightCm}
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            </g>
            <g fill="var(--ink-2)" fontSize="11" textAnchor="middle" className="font-mono">
              <text x={geometry.widthCm / 2} y={-padding * 0.62}>
                {geometry.widthCm} см
              </text>
              <text
                x={-padding * 0.62}
                y={geometry.heightCm / 2}
                transform={`rotate(-90 ${-padding * 0.62} ${geometry.heightCm / 2})`}
              >
                {geometry.heightCm} см
              </text>
            </g>

            {geometry.rooms.map((room) => {
              const label = centre(room.polygon)
              const points = room.polygon.map((point) => `${point.xCm},${point.yCm}`).join(' ')
              return (
                <g key={`${room.name}-${points}`}>
                  <polygon points={points} fill="var(--accent-tint)" fillOpacity="0.35" />
                  <text
                    x={label.xCm}
                    y={label.yCm}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="var(--ink-2)"
                    fontSize="13"
                    className="font-mono"
                  >
                    {room.name.toUpperCase()}
                  </text>
                </g>
              )
            })}

            {geometry.walls.map((wall) => (
              <line
                key={wall.id}
                x1={wall.start.xCm}
                y1={wall.start.yCm}
                x2={wall.end.xCm}
                y2={wall.end.yCm}
                stroke="var(--ink)"
                strokeWidth={wall.kind === 'outer' ? 7 : 4}
                strokeLinecap="square"
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {geometry.openings.map((opening) => {
              const zone = doorClearanceZone(opening, geometry)
              if (!zone) return null
              return (
                <polygon
                  key={`clearance-${opening.id}`}
                  points={zone.polygon.map((point) => `${point.xCm},${point.yCm}`).join(' ')}
                  fill="var(--danger)"
                  fillOpacity="0.1"
                  stroke="var(--danger)"
                  strokeWidth="1.5"
                  strokeDasharray="5 4"
                  vectorEffect="non-scaling-stroke"
                >
                  <title>{zone.label}</title>
                </polygon>
              )
            })}

            {geometry.openings.map((opening) => {
              const wall = wallById.get(opening.wallId)
              if (!wall) return null
              const line = openingLine(opening, wall)
              const colour = opening.type === 'window' ? 'var(--accent)' : 'var(--ink-2)'
              return (
                <g key={opening.id}>
                  <line
                    x1={line.start.xCm}
                    y1={line.start.yCm}
                    x2={line.end.xCm}
                    y2={line.end.yCm}
                    stroke="var(--paper)"
                    strokeWidth="11"
                    strokeLinecap="butt"
                    vectorEffect="non-scaling-stroke"
                  />
                  <line
                    x1={line.start.xCm}
                    y1={line.start.yCm}
                    x2={line.end.xCm}
                    y2={line.end.yCm}
                    stroke={colour}
                    strokeWidth={opening.type === 'window' ? 3 : 2}
                    strokeDasharray={opening.type === 'door' ? '7 5' : undefined}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              )
            })}

            {(geometry.obstacles ?? []).map((obstacle) => (
              <rect
                key={obstacle.id}
                x={obstacle.xCm}
                y={obstacle.yCm}
                width={obstacle.widthCm}
                height={obstacle.depthCm}
                fill="var(--danger)"
                fillOpacity="0.16"
                stroke="var(--danger)"
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
              >
                <title>{obstacleTitle(obstacle)}</title>
              </rect>
            ))}
          </svg>
        </div>

        <div className="border border-line bg-paper p-5 sm:p-6">
          <p className="text-[15px] leading-relaxed text-ink">{description}</p>
          <dl className="mt-5 space-y-3 border-t border-line pt-4 text-[14px]">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-2">Габарит схемы</dt>
              <dd className="font-mono text-ink">
                {geometry.widthCm} × {geometry.heightCm} см
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-2">Препятствия</dt>
              <dd className="font-mono text-ink">{geometry.obstacles?.length ?? 0}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-2">Окна</dt>
              <dd className="font-mono text-ink">
                {geometry.openings.filter((opening) => opening.type === 'window').length}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-2">Двери и балкон</dt>
              <dd className="font-mono text-ink">
                {
                  geometry.openings.filter(
                    (opening) => opening.type === 'door' || opening.type === 'balcony',
                  ).length
                }
              </dd>
            </div>
          </dl>
          {geometry.warnings.length > 0 && geometry.source !== 'manual' ? (
            <div className="mt-5 border-l-2 border-accent pl-3 text-[13px] leading-relaxed text-ink-2">
              Часть сомнительных линий не попала в схему. Это безопаснее, чем принять мебель или
              размерную цепочку за стену.
            </div>
          ) : null}
          <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[12px] text-ink-2">
            <span>
              <i className="mr-2 inline-block h-0.5 w-5 bg-accent align-middle" />
              окно
            </span>
            <span>
              <i className="mr-2 inline-block w-5 border-t-2 border-dashed border-ink-2 align-middle" />
              дверь
            </span>
            <span>
              <i className="mr-2 inline-block h-3 w-5 border border-dashed border-danger bg-danger/10 align-middle" />
              зона открывания
            </span>
          </div>
          {action ? <div className="mt-6">{action}</div> : null}
        </div>
      </div>
    </section>
  )
}
