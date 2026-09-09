'use client'

import { useRealtimeRun } from '@trigger.dev/react-hooks'
import { useEffect, useState } from 'react'
import { isFailedRunStatus, isTerminalRunStatus } from './run-status'

export type RunProgressMeta = { stage?: string; done?: number; total?: number; failed?: number }

/**
 * Слежение за фоновой задачей для экрана ожидания.
 *
 * Кроме статусов держит два срока. Первый — когда сказать, что идёт дольше обычного:
 * задача жива, но человек уже начал сомневаться. Второй — когда перестать ждать совсем.
 * Второй срок нужен потому, что молчание бывает без всякого статуса: воркер не задеплоен,
 * задача так и не вышла из очереди, связь оборвалась и восстанавливается вечно. Без срока
 * экран в таких случаях висел бы до перезагрузки страницы.
 *
 * Сама задача при этом не отменяется: она может дорисовать своё в фоне, и обновление
 * страницы это покажет.
 */
export function useRunWatch({
  runId,
  accessToken,
  slowAfterMs,
  giveUpAfterMs,
  onFinished,
}: {
  runId: string
  accessToken: string
  slowAfterMs: number
  giveUpAfterMs: number
  onFinished: (failed: boolean) => void
}): { progress: RunProgressMeta; slow: boolean; lost: boolean } {
  const { run, error } = useRealtimeRun(runId, { accessToken })
  const [slow, setSlow] = useState(false)
  const [gaveUp, setGaveUp] = useState(false)

  useEffect(() => {
    const slowTimer = setTimeout(() => setSlow(true), slowAfterMs)
    const giveUpTimer = setTimeout(() => setGaveUp(true), giveUpAfterMs)
    return () => {
      clearTimeout(slowTimer)
      clearTimeout(giveUpTimer)
    }
  }, [slowAfterMs, giveUpAfterMs])

  const status = run?.status
  const finished = gaveUp || isTerminalRunStatus(status)
  const failed = gaveUp || isFailedRunStatus(status)

  useEffect(() => {
    if (finished) {
      onFinished(failed)
    }
  }, [finished, failed, onFinished])

  return {
    progress: (run?.metadata?.progress ?? {}) as RunProgressMeta,
    slow: slow && !finished,
    lost: Boolean(error),
  }
}
