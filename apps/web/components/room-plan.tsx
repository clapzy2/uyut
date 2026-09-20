import type {
  FloorReservation,
  LayoutPoint,
  LayoutProblem,
  LayoutWall,
  RoomLayout,
  WallReservationKind,
} from '@uyut/catalog'
import { WALKWAY_CM } from '@uyut/catalog'
import { ItemOperationForm } from '@/components/item-operation-form'
import { ItemPlacementForm } from '@/components/item-placement-form'
import { ItemSizeForm } from '@/components/item-size-form'
import { RoomPlacementOverlay } from '@/components/room-placement-overlay'

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
const DIRECTION_ARROW = { up: '↑', right: '→', down: '↓', left: '←' } as const

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
    case 'invalidPlacement':
      return problem.reason === 'outside'
        ? `${problem.title}: заданное место выходит за контур комнаты вместе с рабочей зоной.`
        : problem.reason === 'collision'
          ? `${problem.title}: заданное место пересекается с другой мебелью или её рабочей зоной.`
          : `${problem.title}: заданное место перекрывает дверь, окно, радиатор или их обязательную свободную зону.`
    default:
      return 'Размеры комнаты не заданы, расставлять не по чему.'
  }
}

/** Сам чертёж с номерами и расшифровкой. Отдельно от текста: тот же рисунок нужен и на главной. */
export function RoomPlanDrawing({
  layout,
  editable = false,
}: {
  layout: RoomLayout
  editable?: boolean
}) {
  // Масштаб по узкой стороне коробки: комната 220 на 600 см иначе рисуется на полтора экрана
  const scale = Math.min(MAX_WIDTH / layout.widthCm, MAX_HEIGHT / layout.depthCm)
  const roomWidth = layout.widthCm * scale
  const roomHeight = layout.depthCm * scale
  const width = roomWidth + PADDING * 2
  const height = roomHeight + PADDING * 2

  return (
    <div>
      <div className="overflow-x-auto">
        <div className="relative w-fit max-w-full">
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
            {layout.keepClearZones.map((zone) => (
              <polygon
                key={`${zone.kind}-${zone.label}-${zone.polygon[0]?.xCm}-${zone.polygon[0]?.yCm}`}
                points={zone.polygon
                  .map((point) => `${PADDING + point.xCm * scale},${PADDING + point.yCm * scale}`)
                  .join(' ')}
                className="fill-danger/10 stroke-danger"
                strokeWidth={1}
                strokeDasharray="5 4"
              >
                <title>{zone.label}</title>
              </polygon>
            ))}
            {layout.functionalZones.map((zone) => (
              <g
                key={`${zone.itemId}-${zone.kind}-${zone.xCm}-${zone.yCm}`}
                data-functional-zone-placement-id={zone.placementId}
              >
                <rect
                  x={PADDING + zone.xCm * scale}
                  y={PADDING + zone.yCm * scale}
                  width={zone.widthCm * scale}
                  height={zone.depthCm * scale}
                  className={
                    zone.source === 'measured'
                      ? 'fill-accent/10 stroke-accent'
                      : 'fill-muted/40 stroke-ink-2'
                  }
                  strokeWidth={1}
                  strokeDasharray="4 4"
                >
                  <title>
                    {zone.title}: рабочая зона {zone.clearanceCm} см
                    {zone.source === 'preliminary' ? ' (предварительно)' : ''}
                  </title>
                </rect>
                {zone.direction !== 'around' ? (
                  <text
                    x={PADDING + (zone.xCm + zone.widthCm / 2) * scale}
                    y={PADDING + (zone.yCm + zone.depthCm / 2) * scale}
                    textAnchor="middle"
                    dominantBaseline="central"
                    className="pointer-events-none fill-accent text-[15px] font-medium"
                  >
                    {DIRECTION_ARROW[zone.direction]}
                  </text>
                ) : null}
              </g>
            ))}
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
          {editable && layout.placed.length > 0 ? (
            <RoomPlacementOverlay
              placements={layout.placed}
              inputs={layout.placementInputs}
              scale={scale}
              padding={PADDING}
              width={width}
              height={height}
              roomWidthCm={layout.widthCm}
              roomDepthCm={layout.depthCm}
              floorPolygon={layout.floorPolygon}
              reservations={layout.reservations}
              floorReservations={layout.floorReservations}
              keepClearZones={layout.keepClearZones}
              functionalZones={layout.functionalZones}
            />
          ) : null}
        </div>
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
      {layout.reservations.length > 0 ||
      layout.floorReservations.length > 0 ||
      layout.keepClearZones.length > 0 ? (
        <p className="mt-3 text-[12px] leading-relaxed text-ink-2">
          {layout.reservationSource === 'geometry'
            ? 'Учтено по подтверждённой 2D-схеме: '
            : 'Учтено из описания: '}
          {(layout.floorReservations.length > 0 ? layout.floorReservations : layout.reservations)
            .map((reservation) => RESERVATION_LABELS[reservation.kind])
            .join(', ')}
          . Пунктиром показаны введённые зоны открывания и радиаторов.
        </p>
      ) : null}
      {layout.functionalZones.length > 0 ? (
        <p className="mt-2 text-[12px] leading-relaxed text-ink-2">
          Второй пунктир — место для использования мебели: открывания, раскладывания и стульев. При
          перемещении он едет вместе с предметом и тоже проверяется. Серым показана предварительная
          зона, розовым — введённый точный размер. Стрелка показывает, куда открывается или
          раскладывается предмет.
        </p>
      ) : null}
    </div>
  )
}

export function RoomPlan({ layout, canEdit = false }: { layout: RoomLayout; canEdit?: boolean }) {
  const problems = layout.problems
  const hasOpenings =
    layout.reservations.length > 0 ||
    layout.floorReservations.length > 0 ||
    layout.keepClearZones.length > 0
  return (
    <div>
      <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-2">
        Вид сверху
      </p>
      <p className="mb-4 text-[13px] leading-relaxed text-ink-2">
        Комната {Math.round(layout.widthCm)} × {Math.round(layout.depthCm)} см и то, что вы выбрали,
        в масштабе. Сервис сравнил {layout.alternativesEvaluated} варианта расстановки: крупное
        вдоль стен, стол — в свободной центральной зоне.{' '}
        {layout.reservationSource === 'geometry' && hasOpenings
          ? `Двери и окна взяты из подтверждённой 2D-схемы; свободной стены осталось ${layout.freeWallCm} см.`
          : layout.reservationSource === 'geometry'
            ? `Подтверждённая 2D-схема не содержит проёмов на границах этой комнаты; свободной стены осталось ${layout.freeWallCm} см.`
            : hasOpenings
              ? `Указанные проёмы и инженерные зоны учтены; свободной стены осталось ${layout.freeWallCm} см.`
              : `Расположение проёмов не указано, поэтому свободные ${layout.freeWallCm} см — предварительная оценка.`}
        {canEdit && layout.placed.length > 0
          ? ' Предмет на схеме можно перетащить мышкой или пальцем и повернуть кнопкой ↻. Свободное место подсвечивается сразу, а после отпускания ещё раз строго проверяется и сохраняется.'
          : ''}
      </p>

      {layout.measurementNote ? (
        <p className="mb-4 text-[13px] leading-relaxed text-ink-2">{layout.measurementNote}</p>
      ) : null}
      <RoomPlanDrawing layout={layout} editable={canEdit} />

      <section
        className={`mt-4 border p-3 ${
          layout.safetySummary.status === 'checked'
            ? 'border-success/40 bg-success/5'
            : layout.safetySummary.status === 'blocked'
              ? 'border-danger/40 bg-danger/5'
              : 'border-accent/40 bg-accent-tint'
        }`}
        aria-live="polite"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[13px] font-medium text-ink">{layout.safetySummary.title}</p>
          <span
            className={`rounded-full border px-2 py-0.5 text-[11px] ${
              layout.safetySummary.status === 'checked'
                ? 'border-success/40 text-success'
                : layout.safetySummary.status === 'blocked'
                  ? 'border-danger/40 text-danger'
                  : layout.safetySummary.status === 'preliminary'
                    ? 'border-accent/40 text-accent'
                    : 'border-line-strong text-ink-2'
            }`}
          >
            {
              {
                checked: 'Можно сверять покупки',
                preliminary: 'Нужна финальная сверка',
                'needs-data': 'Расчёт неполный',
                blocked: 'Покупать рано',
              }[layout.safetySummary.status]
            }
          </span>
        </div>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-2">{layout.safetySummary.detail}</p>
      </section>

      {layout.functionChecks.length > 0 ? (
        <section
          className="mt-4 border border-line bg-surface p-3"
          aria-labelledby="room-functions-title"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 id="room-functions-title" className="text-[13px] font-medium text-ink">
              Функции комнаты
              {layout.functionProfile
                ? ` · ${
                    {
                      living: 'гостиная',
                      bedroom: 'спальня',
                      kitchen: 'кухня',
                      kid: 'детская',
                      studio: 'студия',
                    }[layout.functionProfile]
                  }`
                : ''}
            </h3>
            <span className="text-[11px] text-ink-2">обязательное отделено от желательного</span>
          </div>
          <ul className="mt-3 space-y-3">
            {layout.functionChecks.map((check) => {
              const copy =
                check.status === 'met'
                  ? { label: 'Закрыто', className: 'border-success/40 text-success' }
                  : check.status === 'missing'
                    ? { label: 'Не хватает', className: 'border-danger/40 text-danger' }
                    : { label: 'Уточнить', className: 'border-accent/40 text-accent' }
              return (
                <li key={check.id} className="grid gap-1 sm:grid-cols-[1fr_auto] sm:gap-3">
                  <div>
                    <p className="text-[13px] font-medium text-ink">
                      {check.label}{' '}
                      <span className="font-normal text-ink-2">
                        · {check.importance === 'required' ? 'обязательно' : 'желательно'}
                      </span>
                    </p>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-ink-2">{check.detail}</p>
                  </div>
                  <span
                    className={`h-fit w-fit rounded-full border px-2 py-0.5 text-[11px] ${copy.className}`}
                  >
                    {copy.label}
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}

      {layout.safetyChecks.length > 0 ? (
        <section
          className="mt-4 border border-line bg-surface p-3"
          aria-labelledby="room-checks-title"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 id="room-checks-title" className="text-[13px] font-medium text-ink">
              Проверки этой комнаты
            </h3>
            <span className="text-[11px] text-ink-2">точные и предварительные отдельно</span>
          </div>
          <ul className="mt-3 space-y-3">
            {layout.safetyChecks.map((check) => {
              const copy = {
                checked: { label: 'Проверено', className: 'border-success/40 text-success' },
                preliminary: { label: 'Предварительно', className: 'border-accent/40 text-accent' },
                'needs-data': { label: 'Нужны данные', className: 'border-line-strong text-ink-2' },
                blocked: { label: 'Не проходит', className: 'border-danger/40 text-danger' },
              }[check.status]
              return (
                <li key={check.id} className="grid gap-1 sm:grid-cols-[1fr_auto] sm:gap-3">
                  <div>
                    <p className="text-[13px] font-medium text-ink">{check.label}</p>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-ink-2">{check.detail}</p>
                  </div>
                  <span
                    className={`h-fit w-fit rounded-full border px-2 py-0.5 text-[11px] ${copy.className}`}
                  >
                    {copy.label}
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}

      {layout.relationships.length > 0 ? (
        <section
          className="mt-4 border border-line bg-surface p-3"
          aria-labelledby="room-relations-title"
        >
          <h3 id="room-relations-title" className="text-[13px] font-medium text-ink">
            Связи в комнате
          </h3>
          <ul className="mt-3 space-y-3">
            {layout.relationships.map((relation) => (
              <li key={relation.id} className="grid gap-1 sm:grid-cols-[1fr_auto] sm:gap-3">
                <div>
                  <p className="text-[13px] font-medium text-ink">{relation.label}</p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-ink-2">{relation.detail}</p>
                </div>
                <span
                  className={`h-fit w-fit rounded-full border px-2 py-0.5 text-[11px] ${
                    relation.status === 'checked'
                      ? 'border-success/40 text-success'
                      : relation.status === 'needs-data'
                        ? 'border-line-strong text-ink-2'
                        : 'border-accent/40 text-accent'
                  }`}
                >
                  {relation.status === 'checked'
                    ? 'Учтено'
                    : relation.status === 'needs-data'
                      ? 'Нужны данные'
                      : 'Проверить на месте'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {canEdit && layout.placementInputs.length > 0 ? (
        <details className="mt-4 border border-line bg-surface p-3">
          <summary className="cursor-pointer text-[13px] font-medium text-ink">
            Точное положение мебели ·{' '}
            {layout.placementInputs.filter((item) => item.xCm !== undefined).length}/
            {layout.placementInputs.length}
          </summary>
          <p className="mt-2 text-[12px] leading-relaxed text-ink-2">
            Координаты идут от левого верхнего угла локального контура комнаты. Закреплённое место
            проверяется по настоящему габариту, проёмам, радиаторам и рабочим зонам; остальные
            предметы сервис расставит вокруг него автоматически. Если предмет стоит не у стены,
            укажите его рабочую сторону — без неё сервис оставит безопасный запас со всех сторон.
          </p>
          <div className="mt-3">
            {layout.placementInputs.map((item) => (
              <ItemPlacementForm key={item.id} {...item} itemId={item.id} />
            ))}
          </div>
        </details>
      ) : null}

      {layout.missingSafetyData.length > 0 ? (
        <div className="mt-4 border border-accent/40 bg-accent-tint p-3">
          <p className="text-[13px] leading-relaxed text-ink">
            Для точной проверки не хватает данных:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-ink-2">
            {layout.missingSafetyData.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {canEdit && layout.operationInputs.length > 0 ? (
        <details className="mt-4 border border-line bg-surface p-3">
          <summary className="cursor-pointer text-[13px] font-medium text-ink">
            Рабочие зоны мебели · уточнить точность
          </summary>
          <p className="mt-2 text-[12px] leading-relaxed text-ink-2">
            Берите число из инструкции товара или измерьте сами. Пока поля пустые, шкафы, диваны и
            кровати проверяются только по закрытому габариту; для столов показана предварительная
            зона.
          </p>
          <div className="mt-3">
            {layout.operationInputs.map((item) => (
              <ItemOperationForm key={`${item.id}-${item.kind}`} {...item} itemId={item.id} />
            ))}
          </div>
        </details>
      ) : null}

      {layout.rejections.length > 0 ? (
        <section className="mt-4 border border-danger/40 bg-danger/5 p-3">
          <h3 className="text-[13px] font-medium text-ink">Почему предметы не разместились</h3>
          <ul className="mt-2 space-y-2">
            {layout.rejections.map((rejection) => (
              <li key={rejection.itemId} className="text-[13px] leading-relaxed text-ink-2">
                <span className="font-medium text-ink">{rejection.title}:</span> {rejection.detail}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] leading-relaxed text-ink-2">
            Причина выбрана по всем проверенным положениям, а не по одному первому варианту.
          </p>
        </section>
      ) : null}

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
          {canEdit ? (
            <div className="mt-3 flex flex-col gap-2">
              {layout.unmeasured.map((item) => (
                <ItemSizeForm key={item.id} itemId={item.id} title={item.title} />
              ))}
            </div>
          ) : null}
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
