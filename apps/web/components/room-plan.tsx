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

export function RoomPlan({ layout }: { layout: RoomLayout }) {
  const scale = MAX_WIDTH / layout.widthCm
  const width = MAX_WIDTH + PADDING * 2
  const height = layout.depthCm * scale + PADDING * 2
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
            width={MAX_WIDTH}
            height={layout.depthCm * scale}
            className="fill-muted stroke-ink"
            strokeWidth={2}
          />
          {layout.placed.map((place) => (
            <g key={place.id}>
              <rect
                x={PADDING + place.xCm * scale}
                y={PADDING + place.yCm * scale}
                width={place.widthCm * scale}
                height={place.depthCm * scale}
                className="fill-accent-tint stroke-accent"
                strokeWidth={1.5}
              />
              <text
                x={PADDING + (place.xCm + place.widthCm / 2) * scale}
                y={PADDING + (place.yCm + place.depthCm / 2) * scale}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-ink text-[10px]"
              >
                {place.title.length > 18 ? `${place.title.slice(0, 17)}…` : place.title}
              </text>
            </g>
          ))}
        </svg>
      </div>

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
