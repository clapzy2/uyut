import type { LayoutProblem, RoomLayout } from '@uyut/catalog'
import { WALKWAY_CM } from '@uyut/catalog'

/**
 * План комнаты сверху: прямоугольник комнаты и прямоугольники мебели в масштабе.
 *
 * Рисунок намеренно грубый. Он не показывает, как будет красиво, он показывает, помещается ли
 * купленное в комнату и остаётся ли где пройти. Красиво показывает рендер, но у рендера нет
 * сантиметров, поэтому эти две картинки отвечают на разные вопросы и обе нужны.
 */

const PADDING = 28
const MAX_WIDTH = 520
/** Вытянутая комната иначе растягивает страницу на полтора экрана чертежа */
const MAX_HEIGHT = 620

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
          <rect
            x={PADDING}
            y={PADDING}
            width={roomWidth}
            height={roomHeight}
            className="fill-muted stroke-ink"
            strokeWidth={2}
          />
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
    </div>
  )
}

export function RoomPlan({ layout }: { layout: RoomLayout }) {
  const problems = layout.problems
  return (
    <div>
      <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-2">
        Вид сверху
      </p>
      <p className="mb-4 text-[13px] leading-relaxed text-ink-2">
        Комната {Math.round(layout.widthCm)} × {Math.round(layout.depthCm)} см и то, что вы выбрали,
        в масштабе. Мы раскладываем крупное вдоль стен, а стол — посередине. Где на самом деле дверь
        и окно, план не знает, поэтому свободной стены осталось {layout.freeWallCm} см, и это запас,
        из которого ещё вычтется дверь.
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
        <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
          Без габаритов в карточке магазина и потому не на плане: {layout.unmeasured.join(', ')}.
        </p>
      ) : null}
      {layout.offFloor.length > 0 ? (
        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
          Пол не занимают: {layout.offFloor.join(', ')}.
        </p>
      ) : null}
    </div>
  )
}
