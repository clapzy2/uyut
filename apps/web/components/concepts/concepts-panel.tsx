'use client'

import { useRealtimeRun } from '@trigger.dev/react-hooks'
import { Button, toast } from '@uyut/ui'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { refreshConcepts, requestConcepts, setConceptLike } from '@/actions/concepts'
import { FormError } from '@/components/form-error'
import { type SwipeCard, SwipeDeck } from '@/components/swipe-deck'

export type ConceptItem = {
  id: string
  status: 'pending' | 'ready' | 'failed'
  renderSrc: string | null
  likedByOwner: boolean | null
  orderIndex: number
}

type Progress = { stage?: string; done?: number; total?: number; failed?: number }

const stageLabels: Array<{ key: string; label: string }> = [
  { key: 'brief', label: 'Собираем бриф' },
  { key: 'prompt', label: 'Пишем задание для рендера' },
  { key: 'render', label: 'Рендерим' },
  { key: 'done', label: 'Готово' },
]

function stageIndex(stage: string | undefined): number {
  const found = stageLabels.findIndex((item) => item.key === stage)
  return found === -1 ? 0 : found
}

function RunProgress({
  runId,
  accessToken,
  onFinished,
}: {
  runId: string
  accessToken: string
  onFinished: () => void
}) {
  const { run, error } = useRealtimeRun(runId, { accessToken })
  const progress = (run?.metadata?.progress ?? {}) as Progress
  const current = stageIndex(progress.stage)
  const finished = run?.status === 'COMPLETED' || run?.status === 'FAILED'

  useEffect(() => {
    if (finished) {
      onFinished()
    }
  }, [finished, onFinished])

  if (error) {
    return (
      <p className="text-[15px] text-ink-2">
        Связь с очередью потерялась. Концепты всё равно досчитаются, обновите страницу через минуту.
      </p>
    )
  }

  return (
    <ol className="flex flex-col gap-2">
      {stageLabels.map((item, index) => {
        const done = index < current || progress.stage === 'done'
        const active = index === current && progress.stage !== 'done'
        return (
          <li key={item.key} className="flex items-center gap-3 text-[15px]">
            <span
              aria-hidden="true"
              className={
                done
                  ? 'grid h-4 w-4 place-items-center rounded-full border border-success bg-success text-[10px] text-paper'
                  : active
                    ? 'h-4 w-4 rounded-full border border-accent bg-accent-tint'
                    : 'h-4 w-4 rounded-full border border-line-strong'
              }
            >
              {done ? '✓' : ''}
            </span>
            <span className={done || active ? 'text-ink' : 'text-ink-2'}>
              {item.label}
              {item.key === 'render' && progress.total
                ? ` ${progress.done ?? 0} из ${progress.total}`
                : ''}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export function ConceptsPanel({
  roomId,
  hasPhoto,
  onboarded,
  projectId,
  items,
}: {
  roomId: string
  hasPhoto: boolean
  onboarded: boolean
  projectId: string
  items: ConceptItem[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [run, setRun] = useState<{ runId: string; accessToken: string } | null>(null)
  const [votes, setVotes] = useState<Record<string, boolean>>({})

  const ready = items.filter((item) => item.status === 'ready' && item.renderSrc)
  const failed = items.filter((item) => item.status === 'failed')
  const working = items.some((item) => item.status === 'pending')
  const unseen = ready.filter((item) => item.likedByOwner === null && votes[item.id] === undefined)
  const liked = ready.filter((item) => votes[item.id] ?? item.likedByOwner)

  const cards: SwipeCard[] = unseen.map((item) => ({
    id: item.id,
    src: item.renderSrc as string,
  }))

  function generate() {
    setError(null)
    startTransition(async () => {
      const result = await requestConcepts(roomId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setRun({ runId: result.data.runId, accessToken: result.data.accessToken })
    })
  }

  function vote(card: SwipeCard, isLiked: boolean) {
    setVotes((current) => ({ ...current, [card.id]: isLiked }))
    void setConceptLike(card.id, isLiked).then((result) => {
      if (!result.ok) {
        toast({ title: result.error, tone: 'danger' })
      }
    })
  }

  if (run) {
    return (
      <div className="flex flex-col gap-4">
        <RunProgress
          runId={run.runId}
          accessToken={run.accessToken}
          onFinished={() => {
            setRun(null)
            void refreshConcepts(roomId).then(() => router.refresh())
          }}
        />
        <p className="text-[15px] text-ink-2">
          Обычно около тридцати секунд. Можно уйти со страницы, концепты дождутся.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {cards.length > 0 ? (
        <SwipeDeck
          cards={cards}
          onVote={vote}
          likedCount={liked.length}
          className="mx-auto w-full max-w-xl"
        />
      ) : null}

      {liked.length > 0 ? (
        <div>
          <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-2">
            Понравилось {liked.length}
          </p>
          <ul className="grid grid-cols-2 gap-3">
            {liked.map((item) => (
              <li key={item.id} className="overflow-hidden border border-line bg-muted">
                {/* biome-ignore lint/performance/noImgElement: подписанная ссылка живёт час, оптимизатор next/image здесь не нужен */}
                <img
                  src={item.renderSrc as string}
                  alt="Понравившийся концепт"
                  className="block aspect-[4/3] w-full object-cover"
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {working ? (
        <p className="text-[15px] text-ink-2">
          Несколько рендеров ещё считаются.{' '}
          <button
            type="button"
            onClick={() => router.refresh()}
            className="underline decoration-line-strong underline-offset-4 hover:text-ink"
          >
            Обновить
          </button>
        </p>
      ) : null}

      {failed.length > 0 ? (
        <p className="text-[15px] text-ink-2">
          {failed.length} из {items.length} не отрисовались. Это бывает, когда модель отклоняет
          картинку. Попробуйте сгенерировать ещё раз.
        </p>
      ) : null}

      {!onboarded ? (
        <p className="border-l-2 border-line-strong pl-4 text-[15px] leading-relaxed text-ink-2">
          Мы ещё не знаем ваш вкус, поэтому возьмём стиль по умолчанию.{' '}
          <a
            href={`/onboarding/step-2?project=${projectId}`}
            className="text-accent underline decoration-line-strong underline-offset-4"
          >
            Ответьте на пять вопросов
          </a>
          , и концепты станут вашими.
        </p>
      ) : null}

      {!hasPhoto ? (
        <p className="text-[15px] leading-relaxed text-ink-2">
          Без фото комната рисуется с нуля, по площади и типу. С фото она будет вашей.
        </p>
      ) : null}

      <FormError message={error ?? undefined} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={generate} pending={pending}>
          {items.length === 0 ? 'Сгенерировать концепты' : 'Сгенерировать ещё 5'}
        </Button>
        {items.length === 0 ? (
          <span className="text-sm text-ink-2">пять вариантов, около тридцати секунд</span>
        ) : null}
      </div>
    </div>
  )
}
