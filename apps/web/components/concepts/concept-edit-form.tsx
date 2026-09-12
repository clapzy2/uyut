'use client'

import type { EditPlan } from '@uyut/ai'
import { Button, Textarea, toast } from '@uyut/ui'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import {
  checkGeneration,
  planConceptEdit,
  refreshConcepts,
  reviseConcept,
} from '@/actions/concepts'
import { FormError } from '@/components/form-error'
import { useRunWatch } from '@/lib/queue/use-run-watch'

// Правка рисует три варианта вместо пяти, так что ждать её меньше, чем обычную генерацию
const SLOW_AFTER_MS = 90_000
// Задача живёт до десяти минут, поэтому раньше сдаваться нельзя: иначе готовую правку
// объявишь несостоявшейся и пригласишь заплатить второй раз
const GIVE_UP_AFTER_MS = 10 * 60_000
const SERVER_CHECK_MS = 15_000

function Waiting({
  runId,
  accessToken,
  roomId,
  roomHref,
  onFinished,
}: {
  runId: string
  accessToken: string
  roomId: string
  roomHref: string
  onFinished: (failed: boolean) => void
}) {
  const { slow, lost } = useRunWatch({
    runId,
    accessToken,
    slowAfterMs: SLOW_AFTER_MS,
    giveUpAfterMs: GIVE_UP_AFTER_MS,
    onFinished,
  })

  // Поток событий из очереди умеет замолчать без единой ошибки: экран ждёт, а рендеры давно
  // готовы. Поэтому раз в пятнадцать секунд спрашиваем сервер, который смотрит на сами концепты.
  useEffect(() => {
    const timer = setInterval(() => {
      void checkGeneration(roomId).then((result) => {
        if (result.ok && !result.data.running) {
          onFinished(false)
        }
      })
    }, SERVER_CHECK_MS)
    return () => clearInterval(timer)
  }, [roomId, onFinished])

  if (lost) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[15px] leading-relaxed text-ink-2">
          Связь с очередью потерялась. Правка всё равно досчитается.
        </p>
        <Link
          href={roomHref}
          className="self-start py-1 text-[14px] text-accent underline decoration-accent/40 underline-offset-4 transition-colors duration-200 ease-ui hover:decoration-accent"
        >
          Ко всем вариантам
        </Link>
      </div>
    )
  }
  return (
    <p className="text-[15px] leading-relaxed text-ink-2">
      <span className="inline-block size-2 animate-pulse rounded-full bg-accent align-middle" />{' '}
      Правим выбранный вариант, три прочтения вашей просьбы.
      {slow ? ' Идёт дольше обычного, но идёт.' : ''}
    </p>
  )
}

/**
 * «Вот этот вариант, но шкаф под окном».
 *
 * Стоит прямо под рендером, потому что просьба всегда относится к тому, что человек видит.
 * Заметки комнаты для этого не годятся: они уходят в следующую генерацию с нуля и к выбранному
 * варианту отношения не имеют.
 */
export function ConceptEditForm({
  conceptId,
  roomId,
  roomHref,
  busyElsewhere,
  objects,
}: {
  conceptId: string
  roomId: string
  roomHref: string
  /** По этой комнате уже идёт расчёт: вторая правка сверху означала бы двойную оплату */
  busyElsewhere: boolean
  /** Предметы, найденные на этом рендере: любой можно приложить к просьбе картинкой */
  objects: Array<{ id: string; label: string }>
}) {
  const router = useRouter()
  const [request, setRequest] = useState('')
  // Предмет, приложенный к просьбе картинкой. Словами модель рисует похожую мебель,
  // кадром — ту же самую, поэтому «переставить вот этот шкаф» без кадра не работает.
  const [objectId, setObjectId] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)
  const [sending, setSending] = useState(false)
  const [run, setRun] = useState<{ runId: string; accessToken: string } | null>(null)
  // План считается бесплатно и показывается до расчёта: человек видит, за что платит
  const [plan, setPlan] = useState<EditPlan | null>(null)

  const finished = useCallback(
    (failed: boolean) => {
      setRun(null)
      void refreshConcepts(roomId)
      if (failed) {
        setError('Правка не досчиталась. Откройте комнату и проверьте, потом попробуйте ещё раз.')
        return
      }
      toast({ title: 'Правка готова', tone: 'success' })
      router.push(roomHref)
    },
    [router, roomHref, roomId],
  )

  async function askForPlan(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(undefined)
    setSending(true)
    const result = await planConceptEdit(conceptId, { request })
    setSending(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setPlan(result.data)
  }

  async function confirm() {
    setError(undefined)
    setSending(true)
    const result = await reviseConcept(conceptId, { request, objectId })
    setSending(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setPlan(null)
    setRun({ runId: result.data.runId, accessToken: result.data.accessToken })
  }

  if (run) {
    return (
      <div className="border border-line bg-muted p-5">
        <Waiting
          runId={run.runId}
          accessToken={run.accessToken}
          roomId={roomId}
          roomHref={roomHref}
          onFinished={finished}
        />
      </div>
    )
  }

  if (busyElsewhere) {
    return (
      <div className="border border-line bg-muted p-5">
        <p className="text-[15px] leading-relaxed text-ink-2">
          По этой комнате уже идёт расчёт. Дождитесь его, иначе заплатите за два сразу.
        </p>
        <Link
          href={roomHref}
          className="mt-2 inline-block py-1 text-[14px] text-accent underline decoration-accent/40 underline-offset-4 transition-colors duration-200 ease-ui hover:decoration-accent"
        >
          Посмотреть, как идёт
        </Link>
      </div>
    )
  }

  if (plan) {
    return (
      <div className="flex flex-col gap-4 border border-line p-5">
        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-2">
            Что мы сделаем
          </p>
          {plan.steps.length > 0 ? (
            <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[15px] leading-relaxed text-ink">
              {plan.steps.map((step) => (
                <li key={step.prompt}>{step.titleRu}</li>
              ))}
            </ol>
          ) : (
            <p className="text-[15px] leading-relaxed text-ink-2">Делать нечего.</p>
          )}
        </div>
        {plan.warningRu ? (
          <p className="text-[13px] leading-relaxed text-danger">{plan.warningRu}</p>
        ) : null}
        {/* Модель не переносит предметы одним заданием, поэтому просьба и делится на шаги */}
        <p className="text-[13px] leading-relaxed text-ink-2">
          Шаги идут по очереди, каждый поверх предыдущего. Придут три варианта.
        </p>
        <FormError message={error} />
        <div className="flex flex-wrap gap-3">
          {plan.steps.length > 0 ? (
            <Button
              type="button"
              variant="secondary"
              pending={sending}
              onClick={() => void confirm()}
            >
              {sending ? 'Запускаем…' : 'Запустить'}
            </Button>
          ) : null}
          <Button type="button" variant="ghost" onClick={() => setPlan(null)}>
            Изменить просьбу
          </Button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={askForPlan} noValidate className="flex flex-col gap-3 border border-line p-5">
      <Textarea
        id={`edit-${conceptId}`}
        label="Поправить этот вариант"
        placeholder="Шкаф справа переставить под окно, остальное не трогать"
        value={request}
        onChange={(event) => setRequest(event.currentTarget.value)}
      />
      {objects.length > 0 ? (
        <div>
          <p className="mb-2 text-[13px] text-ink-2">
            О каком предмете речь? Приложим его картинкой, и модель перерисует именно его, а не
            похожий.
          </p>
          <div className="flex flex-wrap gap-2">
            {objects.map((object) => (
              <button
                key={object.id}
                type="button"
                onClick={() => setObjectId(objectId === object.id ? '' : object.id)}
                aria-pressed={objectId === object.id}
                className={`inline-flex h-9 items-center rounded-full border px-4 text-sm transition-[color,background-color,border-color,transform] duration-200 ease-ui active:scale-[0.98] ${
                  objectId === object.id
                    ? 'border-accent text-ink'
                    : 'border-control text-ink-2 hover:text-ink'
                }`}
              >
                {object.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <p className="text-[13px] leading-relaxed text-ink-2">
        Правим именно эту картинку, а не фотографию комнаты. Сначала покажем, что собираемся делать,
        и только после вашего согласия потратим расчёт.
      </p>
      <FormError message={error} />
      <Button
        type="submit"
        variant="secondary"
        pending={sending}
        disabled={request.trim().length < 3}
        className="self-start"
      >
        {sending ? 'Думаем…' : 'Показать, что сделаем'}
      </Button>
    </form>
  )
}
