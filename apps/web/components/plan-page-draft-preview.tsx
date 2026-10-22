import type { PageContourPoint, PlanFillHints } from './plan-page-contour-editor-model'

type DraftRoom = {
  number: number
  name: string
  polygon: PageContourPoint[]
}

/** Only unambiguous source paint is shown. This is never project geometry. */
export function draftRoomsFromFillHints(hints: PlanFillHints): DraftRoom[] {
  if (hints.status !== 'diagnostic') return []

  const fillUse = new Map<string, number>()
  for (const room of hints.roomHints) {
    for (const id of room.fillIds) fillUse.set(id, (fillUse.get(id) ?? 0) + 1)
  }

  return hints.roomHints.flatMap((room) => {
    const fillId = room.fillIds[0]
    if (room.fillIds.length !== 1 || !fillId || fillUse.get(fillId) !== 1) return []
    const fill = hints.candidates.find((candidate) => candidate.id === fillId)
    return fill ? [{ number: room.sourceNumber, name: room.name, polygon: fill.polygon }] : []
  })
}

function pagePoints(polygon: PageContourPoint[]) {
  return polygon.map(({ x, y }) => `${x},${y}`).join(' ')
}

function raisedPoint({ x, y }: PageContourPoint) {
  return { x: 520 + (x - y) * 0.68, y: 35 + (x + y) * 0.34 }
}

function bounds(points: PageContourPoint[]) {
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const left = Math.min(...xs) - 24
  const top = Math.min(...ys) - 24
  const width = Math.max(...xs) - left + 24
  const height = Math.max(...ys) - top + 24
  return `${left} ${top} ${Math.max(width, 1)} ${Math.max(height, 1)}`
}

export function PlanPageDraftPreview({ hints }: { hints: PlanFillHints }) {
  const rooms = draftRoomsFromFillHints(hints)
  const allPoints = rooms.flatMap((room) => room.polygon)
  const raisedPoints = allPoints.map(raisedPoint)

  if (hints.status === 'held') {
    return (
      <p className="border-t border-line pt-3 text-xs text-ink-2">
        Черновой просмотр недоступен: исходный слой PDF не прошёл проверку.
      </p>
    )
  }

  return (
    <section
      aria-label="Неподтверждённый просмотр плана"
      className="space-y-3 border-t border-line pt-3"
    >
      <div>
        <h3 className="text-sm font-medium text-ink">Черновой просмотр областей</h3>
        <p className="mt-1 text-xs leading-relaxed text-ink-2">
          Это расположение заливок из PDF, а не доказанные границы пола, стены или обмеры. Вид
          справа условно приподнят для наглядности: высота, масштаб и проходы по нему не
          определяются. Просмотр не сохраняется в схему и не используется для 3D-модели, сметы или
          PDF.
        </p>
      </div>
      <p className="text-xs text-ink-2">
        Однозначные области: {rooms.length} из {hints.roomHints.length} помещений.
        {hints.truncated ? ' Набор исходных заливок неполный.' : ''}
        {rooms.length < hints.roomHints.length
          ? ' Остальные комнаты не показаны: заливка отсутствует или неоднозначна.'
          : ''}
      </p>
      {rooms.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          <figure className="min-w-0 space-y-1">
            <svg
              aria-label="Области PDF на плоскости листа"
              className="h-52 w-full border border-line bg-surface"
              role="img"
              viewBox={bounds(allPoints)}
            >
              {rooms.map((room) => (
                <polygon
                  key={room.number}
                  points={pagePoints(room.polygon)}
                  fill="currentColor"
                  fillOpacity="0.16"
                  stroke="currentColor"
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                >
                  <title>
                    № {room.number} {room.name}: неподтверждённая заливка
                  </title>
                </polygon>
              ))}
            </svg>
            <figcaption className="text-xs text-ink-2">2D: заливки на листе</figcaption>
          </figure>
          <figure className="min-w-0 space-y-1">
            <svg
              aria-label="Условный объёмный вид областей PDF без высот"
              className="h-52 w-full border border-line bg-surface"
              role="img"
              viewBox={bounds([
                ...raisedPoints,
                ...raisedPoints.map((p) => ({ x: p.x, y: p.y + 18 })),
              ])}
            >
              {rooms.map((room) => {
                const raised = room.polygon.map(raisedPoint)
                return (
                  <g key={room.number}>
                    <polygon
                      points={pagePoints(raised.map((p) => ({ x: p.x, y: p.y + 18 })))}
                      fill="currentColor"
                      fillOpacity="0.08"
                    />
                    <polygon
                      points={pagePoints(raised)}
                      fill="currentColor"
                      fillOpacity="0.25"
                      stroke="currentColor"
                      strokeWidth="2"
                      vectorEffect="non-scaling-stroke"
                    >
                      <title>
                        № {room.number} {room.name}: условная визуализация, не высота
                      </title>
                    </polygon>
                  </g>
                )
              })}
            </svg>
            <figcaption className="text-xs text-ink-2">Условный 3D: без стен и высот</figcaption>
          </figure>
        </div>
      ) : (
        <p className="text-xs text-ink-2">
          Для этого листа нет однозначных областей для просмотра.
        </p>
      )}
      {rooms.length ? (
        <p className="text-xs text-ink-2">
          Показаны: {rooms.map((room) => `№ ${room.number} ${room.name}`).join(', ')}.
        </p>
      ) : null}
    </section>
  )
}
