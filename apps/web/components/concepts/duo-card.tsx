'use client'

import type { DuoProposal } from '@uyut/ai'
import { Button } from '@uyut/ui'
import { useEffect, useState } from 'react'
import { loadDuoProposal, requestDuoConcepts } from '@/actions/concepts'

type Run = { runId: string; accessToken: string }

/**
 * Предложение вариантов на двоих: появляется, когда оба оценили по десять концептов
 * и ни один не понравился обоим. Запускает рендеры только владелец.
 */
export function DuoCard({
  roomId,
  canRun,
  otherName,
  onRun,
}: {
  roomId: string
  canRun: boolean
  otherName: string
  onRun: (run: Run) => void
}) {
  const [proposal, setProposal] = useState<DuoProposal | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void loadDuoProposal(roomId).then((result) => {
      if (cancelled) {
        return
      }
      if (result.ok) {
        setProposal(result.data)
      } else {
        setError(result.error)
      }
    })
    return () => {
      cancelled = true
    }
  }, [roomId])

  function start() {
    setBusy(true)
    void requestDuoConcepts(roomId).then((result) => {
      setBusy(false)
      if (!result.ok) {
        setError(result.error)
        return
      }
      onRun(result.data)
    })
  }

  return (
    <section className="border border-line-strong bg-muted p-5 sm:p-6" aria-labelledby="duo-title">
      <p id="duo-title" className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-2">
        Варианты на двоих
      </p>
      {proposal ? (
        <>
          <p className="mt-2 text-[15px] leading-relaxed text-ink">{proposal.summary}</p>
          <ol className="mt-4 flex flex-col gap-3">
            {proposal.bridges.map((bridge, index) => (
              <li key={bridge.title} className="grid grid-cols-[24px_1fr] gap-2 text-[15px]">
                <span className="font-mono text-[13px] text-accent">{index + 1}</span>
                <span>
                  <span className="font-medium text-ink">{bridge.title}</span>
                  <span className="text-ink-2"> — {bridge.idea}</span>
                </span>
              </li>
            ))}
          </ol>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {canRun ? (
              <>
                <Button onClick={start} pending={busy}>
                  {busy ? 'Запускаем…' : 'Сгенерировать три варианта на двоих'}
                </Button>
                <span className="text-[13px] text-ink-2">
                  три рендера, около тридцати секунд; появятся в стопке у обоих
                </span>
              </>
            ) : (
              <p className="text-[13px] text-ink-2">
                Запуск генерации у владельца проекта. {otherName} уже видит это предложение.
              </p>
            )}
          </div>
        </>
      ) : error ? (
        <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{error}</p>
      ) : (
        <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
          Ни один концепт не понравился обоим. Смотрим, где сходятся ваши вкусы…
        </p>
      )}
      {error && proposal ? <p className="mt-3 text-[13px] text-danger">{error}</p> : null}
    </section>
  )
}
