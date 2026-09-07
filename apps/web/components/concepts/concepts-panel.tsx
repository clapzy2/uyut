'use client'

import { useRealtimeRun } from '@trigger.dev/react-hooks'
import type { ProjectRole } from '@uyut/db'
import { Button, cn, toast } from '@uyut/ui'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { refreshConcepts, requestConcepts, setConceptLike } from '@/actions/concepts'
import { PresenceChip } from '@/components/collaboration/presence-chip'
import { DuoCard } from '@/components/concepts/duo-card'
import { FormError } from '@/components/form-error'
import { type SwipeCard, SwipeDeck } from '@/components/swipe-deck'
import { useProjectLive } from '@/lib/collaboration/live-client'
import {
  duoEligibility,
  type LikeMap,
  mergeVotes,
  myVote,
  splitVotes,
  theirVote,
} from '@/lib/concepts/votes'

export type ConceptItem = {
  id: string
  batchId: string
  batchKind: 'regular' | 'duo'
  title: string | null
  status: 'pending' | 'ready' | 'failed'
  renderSrc: string | null
  owner: boolean | null
  partner: boolean | null
  orderIndex: number
}

type Progress = { stage?: string; done?: number; total?: number; failed?: number }

type Tab = 'all' | 'mine' | 'theirs' | 'both'

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

/** Что изменилось у второго участника между двумя снимками отметок: для строки «только что» */
function theirChange(
  previous: LikeMap | null,
  next: LikeMap,
  role: ProjectRole,
): { conceptId: string; liked: boolean } | null {
  if (!previous) {
    return null
  }
  for (const [conceptId, pair] of Object.entries(next)) {
    const before = theirVote(previous[conceptId] ?? { owner: null, partner: null }, role)
    const after = theirVote(pair, role)
    if (after !== null && after !== before) {
      return { conceptId, liked: after }
    }
  }
  return null
}

export function ConceptsPanel({
  roomId,
  hasPhoto,
  onboarded,
  projectId,
  items,
  latestBatchId,
  canGenerate = true,
  role,
  other,
}: {
  roomId: string
  hasPhoto: boolean
  onboarded: boolean
  projectId: string
  /** Все концепты комнаты, свежий запуск первым */
  items: ConceptItem[]
  latestBatchId: string | null
  /** Генерация стоит денег: второй участник только смотрит и отмечает */
  canGenerate?: boolean
  role: ProjectRole
  /** Второй человек в проекте, если он есть: его имя в метках и вкладках */
  other: { name: string } | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [run, setRun] = useState<{ runId: string; accessToken: string } | null>(null)
  const conceptHref = (conceptId: string) =>
    `/projects/${projectId}/rooms/${roomId}/concepts/${conceptId}`
  const [votes, setVotes] = useState<Record<string, boolean>>({})
  const [tab, setTab] = useState<Tab>('mine')
  const [recent, setRecent] = useState<{ conceptId: string; liked: boolean } | null>(null)
  const live = useProjectLive({ projectId, roomId, enabled: other !== null })
  const previousLikes = useRef<LikeMap | null>(null)

  // Свои голоса ложатся поверх серверных сразу, чужие приходят по живому каналу
  const current = useMemo(() => {
    const withLive = live.likes ? mergeVotes(items, live.likes, role, votes) : items
    return withLive.map((item) => {
      const local = votes[item.id]
      if (local === undefined) {
        return item
      }
      return role === 'owner' ? { ...item, owner: local } : { ...item, partner: local }
    })
  }, [items, live.likes, role, votes])

  useEffect(() => {
    if (!live.likes) {
      return
    }
    const change = theirChange(previousLikes.current, live.likes, role)
    previousLikes.current = live.likes
    if (change) {
      setRecent(change)
    }
  }, [live.likes, role])

  const ready = current.filter((item) => item.status === 'ready' && item.renderSrc)
  const latest = current.filter((item) => item.batchId === latestBatchId)
  const failed = latest.filter((item) => item.status === 'failed')
  const working = latest.some((item) => item.status === 'pending')
  const split = splitVotes(ready, role)
  const duo = other ? duoEligibility(current) : null
  const unseen = split.unseen.filter((item) => votes[item.id] === undefined)

  const cards: SwipeCard[] = unseen.map((item) => ({
    id: item.id,
    src: item.renderSrc as string,
    caption: item.batchKind === 'duo' ? `На двоих · ${item.title ?? ''}`.trim() : undefined,
    badge: other && theirVote(item, role) === true ? `♥ ${other.name} · нравится` : undefined,
  }))

  const tabs: Array<{ key: Tab; label: string; count: number }> = other
    ? [
        { key: 'all', label: 'Все', count: ready.length },
        { key: 'mine', label: 'Мои', count: split.mine.length },
        { key: 'theirs', label: other.name, count: split.theirs.length },
        { key: 'both', label: 'Общие', count: split.both.length },
      ]
    : []
  const shown =
    tab === 'all'
      ? ready
      : tab === 'theirs'
        ? split.theirs
        : tab === 'both'
          ? split.both
          : split.mine
  const recentItem = recent ? current.find((item) => item.id === recent.conceptId) : null

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
    setVotes((state) => ({ ...state, [card.id]: isLiked }))
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-2">Концепты</p>
        {other ? <PresenceChip name={other.name} presence={live.presence} roomId={roomId} /> : null}
      </div>

      {cards.length > 0 ? (
        <>
          <SwipeDeck
            cards={cards}
            onVote={vote}
            onOpen={(card) => router.push(`${conceptHref(card.id)}`)}
            likedCount={split.mine.length}
            className="mx-auto w-full max-w-xl"
          />
          <p className="text-center text-[13px] text-ink-2">
            Нажмите на картинку, чтобы открыть концепт с подбором товаров.
          </p>
        </>
      ) : null}

      {other && recent && recentItem ? (
        <p className="flex items-center gap-2 text-[13px] text-ink-2" aria-live="polite">
          <span aria-hidden="true" className="block size-1.5 rounded-full bg-accent" />
          Только что · {other.name} · концепт {recentItem.orderIndex + 1} ·{' '}
          {recent.liked ? 'нравится' : 'не нравится'}
        </p>
      ) : null}

      {other && duo?.eligible ? (
        <DuoCard
          roomId={roomId}
          canRun={canGenerate}
          otherName={other.name}
          onRun={(started) => setRun(started)}
        />
      ) : null}

      {tabs.length > 0 ? (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Отметки">
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={tab === item.key}
              onClick={() => setTab(item.key)}
              className={cn(
                'h-8 rounded-full border px-3 text-[13px] transition-colors duration-200 ease-ui',
                tab === item.key
                  ? 'border-accent bg-accent-tint text-accent'
                  : 'border-line-strong text-ink-2 hover:text-ink',
              )}
            >
              {item.label} {item.count}
            </button>
          ))}
        </div>
      ) : null}

      {shown.length > 0 ? (
        <div>
          {tabs.length === 0 ? (
            <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-2">
              Понравилось {shown.length}
            </p>
          ) : null}
          <ul className="grid grid-cols-2 gap-3">
            {shown.map((item) => {
              const mine = myVote(item, role) === true
              const theirs = other ? theirVote(item, role) === true : false
              const mark = mine && theirs ? '♥♥' : mine ? '♥' : theirs ? `♥ ${other?.name}` : null
              return (
                <li
                  key={item.id}
                  className={cn(
                    'relative overflow-hidden border bg-muted',
                    mine && theirs ? 'border-accent' : 'border-line',
                  )}
                >
                  <a href={conceptHref(item.id)} className="block">
                    {/* biome-ignore lint/performance/noImgElement: подписанная ссылка живёт час, оптимизатор next/image здесь не нужен */}
                    <img
                      src={item.renderSrc as string}
                      alt={`Концепт ${item.orderIndex + 1}, открыть`}
                      className="block aspect-[4/3] w-full object-cover transition-opacity duration-200 ease-ui hover:opacity-90"
                    />
                  </a>
                  {mark ? (
                    <span className="pointer-events-none absolute bottom-2 right-2 rounded-full bg-paper/90 px-2 py-0.5 text-[12px] text-accent">
                      {mark}
                    </span>
                  ) : null}
                  {item.batchKind === 'duo' ? (
                    <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-paper/90 px-2 py-0.5 text-[11px] text-ink-2">
                      на двоих
                    </span>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </div>
      ) : tabs.length > 0 && ready.length > 0 ? (
        <p className="text-[15px] text-ink-2">
          {tab === 'both'
            ? 'Общих отметок пока нет: как только один и тот же концепт понравится обоим, он появится здесь.'
            : tab === 'theirs'
              ? `${other?.name} пока ничего не отметил(а).`
              : 'Пока ничего не отмечено.'}
        </p>
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
          {failed.length} из {latest.length} не отрисовались. Это бывает, когда модель отклоняет
          картинку. Попробуйте сгенерировать ещё раз.
        </p>
      ) : null}

      {!canGenerate ? (
        <p className="text-[15px] leading-relaxed text-ink-2">
          {items.length === 0
            ? 'Концептов пока нет: их генерирует владелец проекта.'
            : 'Новые концепты генерирует владелец проекта.'}
        </p>
      ) : null}

      {canGenerate && !onboarded ? (
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

      {canGenerate && !hasPhoto ? (
        <p className="text-[15px] leading-relaxed text-ink-2">
          Без фото комната рисуется с нуля, по площади и типу. С фото она будет вашей.
        </p>
      ) : null}

      {canGenerate ? (
        <>
          <FormError message={error ?? undefined} />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={generate} pending={pending}>
              {items.length === 0 ? 'Сгенерировать концепты' : 'Сгенерировать ещё 5'}
            </Button>
            {items.length === 0 ? (
              <span className="text-sm text-ink-2">пять вариантов, около тридцати секунд</span>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  )
}
