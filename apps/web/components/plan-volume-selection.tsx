'use client'

import Link from 'next/link'
import type { PlanVolume } from '@/lib/projects/plan-volume'

export type VolumeSelection = { kind: 'room' | 'furniture'; id: string } | null

export function PlanVolumeSelection({
  model,
  selection,
  onSelect,
  projectId,
}: {
  model: PlanVolume
  selection: VolumeSelection
  onSelect: (selection: VolumeSelection) => void
  projectId?: string
}) {
  const rooms = model.rooms ?? []
  const item =
    selection?.kind === 'furniture'
      ? model.furniture?.find((candidate) => candidate.id === selection.id)
      : undefined
  const roomId = selection?.kind === 'room' ? selection.id : item?.roomId
  const room = rooms.find((candidate) => candidate.id === roomId)
  const roomHref =
    projectId && room
      ? `/projects/${encodeURIComponent(projectId)}/rooms/${encodeURIComponent(room.id)}`
      : null
  const width = item
    ? Math.max(...item.floor.map((point) => point.xCm)) -
      Math.min(...item.floor.map((point) => point.xCm))
    : null
  const depth = item
    ? Math.max(...item.floor.map((point) => point.yCm)) -
      Math.min(...item.floor.map((point) => point.yCm))
    : null
  const format = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })

  return (
    <div className="border-x border-line px-3 py-3 text-sm">
      {rooms.length > 0 ? (
        <fieldset className="flex flex-wrap items-center gap-2" aria-label="Выбор комнаты в обзоре">
          <span className="mr-1 text-ink-2">Комнаты</span>
          {rooms.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              aria-pressed={roomId === candidate.id}
              onClick={() => onSelect({ kind: 'room', id: candidate.id })}
              className={`min-h-11 border px-3 py-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                roomId === candidate.id
                  ? 'border-accent bg-accent-tint text-ink'
                  : 'border-line text-ink-2 hover:border-accent hover:text-ink'
              }`}
            >
              {candidate.title}
            </button>
          ))}
        </fieldset>
      ) : null}
      <div className={rooms.length > 0 ? 'mt-3' : ''} aria-live="polite" aria-atomic="true">
        {item || room ? (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-medium text-ink">
                {item ? `Выбран предмет: ${item.title}` : `Выбрана комната: ${room?.title}`}
              </p>
              <button
                type="button"
                onClick={() => onSelect(null)}
                className="min-h-11 text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
              >
                Снять выделение
              </button>
            </div>
            {item && width !== null && depth !== null ? (
              <p className="text-ink-2">
                Габарит на схеме: {format(width)} × {format(depth)} см.
                {item.heightCm === undefined
                  ? ' Высоту нужно уточнить.'
                  : ` Высота ${format(item.heightCm)} см.`}
              </p>
            ) : null}
            {roomHref ? (
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
                <Link
                  href={roomHref}
                  className="min-h-11 py-2 text-accent underline underline-offset-4"
                >
                  Открыть комнату →
                </Link>
                <Link
                  href={`${roomHref}#room-plan`}
                  className="min-h-11 py-2 text-accent underline underline-offset-4"
                >
                  План 2D
                </Link>
                <Link
                  href={`${roomHref}#room-checks`}
                  className="min-h-11 py-2 text-accent underline underline-offset-4"
                >
                  Проверки расстановки
                </Link>
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-ink-2">
            Выберите комнату или предмет на схеме либо в списке. Выделение не меняет расстановку.
          </p>
        )}
      </div>
    </div>
  )
}
