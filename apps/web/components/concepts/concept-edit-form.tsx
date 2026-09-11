'use client'

import { Button, Textarea, toast } from '@uyut/ui'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { checkGeneration, refreshConcepts, reviseConcept } from '@/actions/concepts'
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
}: {
  conceptId: string
  roomId: string
  roomHref: string
  /** По этой комнате уже идёт расчёт: вторая правка сверху означала бы двойную оплату */
  busyElsewhere: boolean
}) {
  const router = useRouter()
  const [request, setRequest] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)
  const [sending, setSending] = useState(false)
  const [run, setRun] = useState<{ runId: string; accessToken: string } | null>(null)

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

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(undefined)
    setSending(true)
    const result = await reviseConcept(conceptId, { request })
    setSending(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
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

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3 border border-line p-5">
      <Textarea
        id={`edit-${conceptId}`}
        label="Поправить этот вариант"
        placeholder="Шкаф справа переставить под окно, остальное не трогать"
        value={request}
        onChange={(event) => setRequest(event.currentTarget.value)}
      />
      <p className="text-[13px] leading-relaxed text-ink-2">
        Правим именно эту картинку, а не фотографию комнаты. Всё, о чём вы не попросите, останется
        как выше. Придут три варианта одной правки.
      </p>
      <FormError message={error} />
      <Button
        type="submit"
        variant="secondary"
        pending={sending}
        disabled={request.trim().length < 3}
        className="self-start"
      >
        {sending ? 'Отправляем…' : 'Поправить'}
      </Button>
    </form>
  )
}
