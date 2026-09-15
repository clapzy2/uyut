import type {
  FloorReservation,
  LayoutPoint,
  LayoutProblem,
  LayoutWall,
  RoomLayout,
  WallReservationKind,
} from '@uyut/catalog'
import { WALKWAY_CM } from '@uyut/catalog'
import { ItemSizeForm } from '@/components/item-size-form'

/**
 * План комнаты сверху: реальный контур комнаты и прямоугольники мебели в масштабе.
 *
 * Рисунок намеренно грубый. Он не показывает, как будет красиво, он показывает, помещается ли
 * купленное в комнату и остаётся ли где пройти. Красиво показывает рендер, но у рендера нет
 * сантиметров, поэтому эти две картинки отвечают на разные вопросы и обе нужны.
 */

const PADDING = 28
const MAX_WIDTH = 520
/** Вытянутая комната иначе растягивает страницу на полтора экрана чертежа */
const MAX_HEIGHT = 620

const RESERVATION_LABELS: Record<WallReservationKind, string> = {
  door: 'дверь',
  window: 'окно',
  balcony: 'выход на балкон',
  radiator: 'радиатор',
  ventilation: 'вентиляция',
}

function wallLine(
  wall: LayoutWall,
  fromCm: number,
  toCm: number,
  scale: number,
  roomWidth: number,
  roomHeight: number,
) {
  switch (wall) {
    case 'top':
      return { x1: PADDING + fromCm * scale, y1: PADDING, x2: PADDING + toCm * scale, y2: PADDING }
    case 'bottom':
      return {
        x1: PADDING + fromCm * scale,
        y1: PADDING + roomHeight,
        x2: PADDING + toCm * scale,
        y2: PADDING + roomHeight,
      }
    case 'left':
      return { x1: PADDING, y1: PADDING + fromCm * scale, x2: PADDING, y2: PADDING + toCm * scale }
    case 'right':
      return {
        x1: PADDING + roomWidth,
        y1: PADDING + fromCm * scale,
        x2: PADDING + roomWidth,
        y2: PADDING + toCm * scale,
      }
  }
}

function pointInPolygon(point: LayoutPoint, polygon: readonly LayoutPoint[]): boolean {
  let inside = false
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index]
    const end = polygon[(index + 1) % polygon.length]
    if (!start || !end) continue
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

function exactClearanceRect(
  reservation: FloorReservation,
  polygon: readonly LayoutPoint[],
): { xCm: number; yCm: number; widthCm: number; depthCm: number } | null {
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

/**
 * Размер предмета так, как он написан в магазине: сначала длинная сторона.
 * На чертеже у стены он повёрнут, и «95 × 220» вместо «220 × 95» человека только путает.
 */
function sizeLabel(place: { widthCm: number; depthCm: number }): string {
  const long = Math.round(Math.max(place.widthCm, place.depthCm))
  const short = Math.round(Math.min(place.widthCm, place.depthCm))
  return `${long} × ${short}`
}

function problemText(problem: LayoutProblem): string {
  switch (problem.kind) {
    case 'noWall':
      return `${problem.title} шириной ${problem.widthCm} см не встаёт ни к одной стене: свободной стены такой длины не осталось.`
    case 'noCenter':
      return `${problem.title} посреди комнаты не помещается: вокруг него не остаётся места, чтобы отодвинуть стул и пройти.`
    case 'narrowWalkway':
      return `Проход посередине ${problem.gapCm} см. Свободно ходить получается от ${WALKWAY_CM} см.`
    default:
      return 'Размеры комнаты не заданы, расставлять не по чему.'
  }
}

/** Сам чертёж с номерами и расшифровкой. Отдельно от текста: тот же рисунок нужен и на главной. */
export function RoomPlanDrawing({ layout }: { layout: RoomLayout }) {
  // Масштаб по узкой стороне коробки: комната 220 на 600 см иначе рисуется на полтора экрана
  const scale = Math.min(MAX_WIDTH / layout.widthCm, MAX_HEIGHT / layout.depthCm)
  const roomWidth = layout.widthCm * scale
  const roomHeight = layout.depthCm * scale
  const width = roomWidth + PADDING * 2
  const height = roomHeight + PADDING * 2

  return (
    <div>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          className="h-auto max-w-full"
          role="img"
          aria-label={`План комнаты ${Math.round(layout.widthCm)} на ${Math.round(layout.depthCm)} сантиметров, предметов: ${layout.placed.length}`}
        >
          <title>План комнаты сверху</title>
          {layout.floorPolygon ? (
            <polygon
              points={layout.floorPolygon
                .map((point) => `${PADDING + point.xCm * scale},${PADDING + point.yCm * scale}`)
                .join(' ')}
              className="fill-muted stroke-ink"
              strokeWidth={2}
            />
          ) : (
            <rect
              x={PADDING}
              y={PADDING}
              width={roomWidth}
              height={roomHeight}
              className="fill-muted stroke-ink"
              strokeWidth={2}
            />
          )}
          {layout.floorReservations.map((reservation) => {
            const clearance = layout.floorPolygon
              ? exactClearanceRect(reservation, layout.floorPolygon)
              : null
            return (
              <g
                key={`${reservation.kind}-${reservation.start.xCm}-${reservation.start.yCm}-${reservation.end.xCm}-${reservation.end.yCm}`}
              >
                {clearance ? (
                  <rect
                    x={PADDING + clearance.xCm * scale}
                    y={PADDING + clearance.yCm * scale}
                    width={clearance.widthCm * scale}
                    height={clearance.depthCm * scale}
                    className="fill-accent-tint stroke-accent"
                    strokeWidth={1}
                    strokeDasharray="5 4"
                  />
                ) : null}
                <line
                  x1={PADDING + reservation.start.xCm * scale}
                  y1={PADDING + reservation.start.yCm * scale}
                  x2={PADDING + reservation.end.xCm * scale}
                  y2={PADDING + reservation.end.yCm * scale}
                  className={reservation.clearanceCm > 0 ? 'stroke-danger' : 'stroke-accent'}
                  strokeWidth={5}
                  strokeLinecap="round"
                />
              </g>
            )
          })}
          {layout.floorReservations.length === 0
            ? layout.reservations.map((reservation) => {
                const line = wallLine(
                  reservation.wall,
                  reservation.fromCm,
                  reservation.toCm,
                  scale,
                  roomWidth,
                  roomHeight,
                )
                const length = reservation.toCm - reservation.fromCm
                const clearance = reservation.clearanceCm
                const isHorizontal = reservation.wall === 'top' || reservation.wall === 'bottom'
                const clearanceX =
                  reservation.wall === 'right'
                    ? PADDING + roomWidth - clearance * scale
                    : PADDING + (isHorizontal ? reservation.fromCm : 0) * scale
                const clearanceY =
                  reservation.wall === 'bottom'
                    ? PADDING + roomHeight - clearance * scale
                    : PADDING + (isHorizontal ? 0 : reservation.fromCm) * scale
                return (
                  <g
                    key={`${reservation.kind}-${reservation.wall}-${reservation.fromCm}-${reservation.toCm}`}
                  >
                    {clearance > 0 ? (
                      <rect
                        x={clearanceX}
                        y={clearanceY}
                        width={(isHorizontal ? length : clearance) * scale}
                        height={(isHorizontal ? clearance : length) * scale}
                        className="fill-accent-tint stroke-accent"
                        strokeWidth={1}
                        strokeDasharray="5 4"
                      />
                    ) : null}
                    <line
                      {...line}
                      className={clearance > 0 ? 'stroke-danger' : 'stroke-accent'}
                      strokeWidth={5}
                      strokeLinecap="round"
                    />
                  </g>
                )
              })
            : null}
          {layout.placed.map((place, index) => (
            <g key={place.id}>
              <rect
                x={PADDING + place.xCm * scale}
                y={PADDING + place.yCm * scale}
                width={place.widthCm * scale}
                height={place.depthCm * scale}
                className="fill-accent-tint stroke-accent"
                strokeWidth={1.5}
              />
              {/* Внутри прямоугольника только номер: название шкафа глубиной 60 см
                  не помещается в него ни при каком шрифте и лезет на соседей */}
              <text
                x={PADDING + (place.xCm + place.widthCm / 2) * scale}
                y={PADDING + (place.yCm + place.depthCm / 2) * scale}
                textAnchor="middle"
                dominantBaseline="central"
                className="fill-ink text-[11px] font-medium"
              >
                {index + 1}
              </text>
            </g>
          ))}
        </svg>
      </div>

      <ol className="mt-3 flex flex-col gap-1">
        {layout.placed.map((place, index) => (
          <li key={place.id} className="flex gap-2 text-[13px] leading-relaxed text-ink-2">
            <span className="w-4 shrink-0 font-mono text-[12px] text-accent">{index + 1}</span>
            <span className="min-w-0">
              {place.title}
              <span className="text-ink-2/80">
                {' · '}
                {sizeLabel(place)} см
              </span>
            </span>
          </li>
        ))}
      </ol>
      {layout.reservations.length > 0 || layout.floorReservations.length > 0 ? (
        <p className="mt-3 text-[12px] leading-relaxed text-ink-2">
          {layout.reservationSource === 'geometry'
            ? 'Учтено по подтверждённой 2D-схеме: '
            : 'Учтено из описания: '}
          {(layout.floorReservations.length > 0 ? layout.floorReservations : layout.reservations)
            .map((reservation) => RESERVATION_LABELS[reservation.kind])
            .join(', ')}
          . Пунктиром показан свободный подход к двери или балкону.
        </p>
      ) : null}
    </div>
  )
}

export function RoomPlan({ layout }: { layout: RoomLayout }) {
  const problems = layout.problems
  const hasOpenings = layout.reservations.length > 0 || layout.floorReservations.length > 0
  return (
    <div>
      <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-2">
        Вид сверху
      </p>
      <p className="mb-4 text-[13px] leading-relaxed text-ink-2">
        Комната {Math.round(layout.widthCm)} × {Math.round(layout.depthCm)} см и то, что вы выбрали,
        в масштабе. Мы раскладываем крупное вдоль стен, а стол — посередине.{' '}
        {layout.reservationSource === 'geometry' && hasOpenings
          ? `Двери и окна взяты из подтверждённой 2D-схемы; свободной стены осталось ${layout.freeWallCm} см.`
          : layout.reservationSource === 'geometry'
            ? `Подтверждённая 2D-схема не содержит проёмов на границах этой комнаты; свободной стены осталось ${layout.freeWallCm} см.`
            : hasOpenings
              ? `Указанные проёмы и инженерные зоны учтены; свободной стены осталось ${layout.freeWallCm} см.`
              : `Расположение проёмов не указано, поэтому свободные ${layout.freeWallCm} см — предварительная оценка.`}
      </p>

      <RoomPlanDrawing layout={layout} />

      {problems.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-2">
          {problems.map((problem) => (
            <li
              key={`${problem.kind}-${'title' in problem ? problem.title : ''}`}
              className="text-[14px] leading-relaxed text-danger"
            >
              {problemText(problem)}
            </li>
          ))}
        </ul>
      ) : layout.placed.length > 0 ? (
        <p className="mt-4 text-[14px] leading-relaxed text-ink-2">
          Всё выбранное помещается, проход посередине {layout.walkwayCm} см.
        </p>
      ) : null}

      {layout.unmeasured.length > 0 ? (
        <div className="mt-4 border-t border-line pt-4">
          <p className="text-[13px] leading-relaxed text-ink-2">
            У этих товаров магазин не указал габариты, поэтому на плане их нет. Диваны так почти
            всегда: перепишите два числа с карточки товара, и они встанут на место.
          </p>
          <div className="mt-3 flex flex-col gap-2">
            {layout.unmeasured.map((item) => (
              <ItemSizeForm key={item.id} itemId={item.id} title={item.title} />
            ))}
          </div>
        </div>
      ) : null}
      {layout.offFloor.length > 0 ? (
        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
          Пол не занимают: {layout.offFloor.join(', ')}.
        </p>
      ) : null}
    </div>
  )
}
