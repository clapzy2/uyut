import type { RoomLayout } from '@uyut/catalog'
import { WALKWAY_CM } from '@uyut/catalog'
import Link from 'next/link'

/**
 * Что из выбранного не встанет, на той странице, где человек собирается платить.
 *
 * Внутри комнаты это видно на виде сверху, но покупают со страницы итогов, и до комнаты
 * человек может уже не вернуться. Здесь только плохие новости: если всё помещается, блока нет.
 */

export type RoomFit = { roomId: string; roomName: string; layout: RoomLayout }

function lines(layout: RoomLayout): string[] {
  const result: string[] = []
  for (const problem of layout.problems) {
    if (problem.kind === 'noWall') {
      result.push(`${problem.title} шириной ${problem.widthCm} см не встаёт ни к одной стене`)
    }
    if (problem.kind === 'noCenter') {
      result.push(`${problem.title} не помещается посреди комнаты`)
    }
    if (problem.kind === 'narrowWalkway') {
      result.push(
        `проход посередине ${problem.gapCm} см, свободно ходить получается от ${WALKWAY_CM}`,
      )
    }
  }
  for (const missing of layout.missingSafetyData) result.push(missing)
  return result
}

export function FitWarnings({ rooms, projectId }: { rooms: RoomFit[]; projectId: string }) {
  const trouble = rooms
    .map((room) => ({ ...room, lines: lines(room.layout) }))
    .filter((room) => room.lines.length > 0)
  if (trouble.length === 0) {
    return null
  }
  const geometryRooms = trouble.filter(
    (room) => room.layout.reservationSource === 'geometry',
  ).length
  return (
    <div className="mt-8 animate-[rise-in_350ms_var(--ease-appear)] border border-danger/40 bg-paper p-5">
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-danger">
        Нужна проверка размеров
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {trouble.map((room) => (
          <li key={room.roomId} className="text-[14px] leading-relaxed text-ink">
            <Link
              href={`/projects/${projectId}/rooms/${room.roomId}`}
              className="text-ink underline decoration-accent decoration-1 underline-offset-4"
            >
              {room.roomName}
            </Link>
            : {room.lines.join('; ')}.
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
        {geometryRooms === trouble.length
          ? 'Считаем по размерам комнаты, габаритам товаров и дверям с окнами из подтверждённой 2D-схемы.'
          : geometryRooms > 0
            ? 'Для части комнат двери и окна взяты из подтверждённой 2D-схемы. В остальных их положение нужно проверить по месту.'
            : 'Считаем по размерам комнаты и габаритам из карточек магазинов. Где дверь и окно, план не знает, поэтому проверьте по месту, прежде чем покупать.'}
      </p>
    </div>
  )
}
