'use client'

import { useEffect, useRef, useState } from 'react'
import type { LikeMap } from '@/lib/concepts/votes'

export type PresenceState = {
  online: boolean
  roomId: string | null
  lastSeenAt: number | null
}

export type LiveState = {
  connected: boolean
  other: { name: string } | null
  presence: PresenceState | null
  /** Отметки комнаты с сервера; меняются, когда кто-то из двоих голосует */
  likes: LikeMap | null
  /** Счётчик обновлений отметок, чтобы показать «только что» */
  likesVersion: number
}

const initial: LiveState = {
  connected: false,
  other: null,
  presence: null,
  likes: null,
  likesVersion: 0,
}

/**
 * Подписка на живой канал проекта через EventSource. Браузер сам переподключается при обрыве,
 * сервер при переподключении присылает состояние заново.
 */
export function useProjectLive(input: {
  projectId: string
  roomId?: string | null
  enabled: boolean
}): LiveState {
  const [state, setState] = useState<LiveState>(initial)
  const sourceRef = useRef<EventSource | null>(null)

  useEffect(() => {
    if (!input.enabled || typeof EventSource === 'undefined') {
      return
    }
    const url = new URL(`/api/projects/${input.projectId}/live`, window.location.origin)
    if (input.roomId) {
      url.searchParams.set('room', input.roomId)
    }
    const source = new EventSource(url.toString())
    sourceRef.current = source
    source.onopen = () => setState((current) => ({ ...current, connected: true }))
    source.onerror = () => setState((current) => ({ ...current, connected: false }))
    source.addEventListener('hello', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { other: { name: string } | null }
      setState((current) => ({ ...current, other: data.other }))
    })
    source.addEventListener('presence', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as PresenceState
      setState((current) => ({ ...current, presence: data }))
    })
    source.addEventListener('likes', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as LikeMap
      setState((current) => ({ ...current, likes: data, likesVersion: current.likesVersion + 1 }))
    })
    return () => {
      source.close()
      sourceRef.current = null
      setState(initial)
    }
  }, [input.enabled, input.projectId, input.roomId])

  return state
}
