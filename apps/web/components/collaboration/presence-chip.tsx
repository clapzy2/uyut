'use client'

import { cn } from '@uyut/ui'
import type { PresenceState } from '@/lib/collaboration/live-client'

export function relativeMinutes(fromMs: number, nowMs = Date.now()): string {
  const minutes = Math.max(0, Math.round((nowMs - fromMs) / 60_000))
  if (minutes < 1) {
    return 'только что'
  }
  if (minutes < 60) {
    return `${minutes} мин назад`
  }
  const hours = Math.round(minutes / 60)
  if (hours < 24) {
    return `${hours} ч назад`
  }
  const days = Math.round(hours / 24)
  return `${days} дн назад`
}

/** Плашка у заголовка: онлайн ли второй участник и в этой ли он комнате */
export function PresenceChip({
  name,
  presence,
  roomId,
  className,
}: {
  name: string
  presence: PresenceState | null
  roomId?: string | null
  className?: string
}) {
  const online = presence?.online ?? false
  const here = online && roomId !== undefined && roomId !== null && presence?.roomId === roomId
  const text = online
    ? here
      ? `${name} онлайн · в этой комнате`
      : `${name} онлайн`
    : presence?.lastSeenAt
      ? `${name} офлайн · ${relativeMinutes(presence.lastSeenAt)}`
      : `${name} офлайн`
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full border border-line-strong bg-paper px-3 py-1 text-[13px] text-ink',
        className,
      )}
      aria-live="polite"
    >
      <span
        aria-hidden="true"
        className={cn(
          'block size-2 rounded-full',
          online ? 'bg-success ring-[3px] ring-success/20' : 'bg-line-strong',
        )}
      />
      {text}
    </span>
  )
}
