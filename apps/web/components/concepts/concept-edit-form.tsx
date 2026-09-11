'use client'

import { Button, Textarea, toast } from '@uyut/ui'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import { reviseConcept } from '@/actions/concepts'
import { FormError } from '@/components/form-error'
import { useRunWatch } from '@/lib/queue/use-run-watch'

// Правка рисует три варианта вместо пяти, так что ждать её меньше, чем обычную генерацию
const SLOW_AFTER_MS = 90_000
const GIVE_UP_AFTER_MS = 6 * 60_000

function Waiting({
  runId,
  accessToken,
  onFinished,
}: {
  runId: string
  accessToken: string
  onFinished: (failed: boolean) => void
}) {
  const { slow, lost } = useRunWatch({
    runId,
    accessToken,
    slowAfterMs: SLOW_AFTER_MS,
    giveUpAfterMs: GIVE_UP_AFTER_MS,
    onFinished,
  })
  if (lost) {
    return (
      <p className="text-[15px] text-ink-2">
        Связь с очередью потерялась. Правка всё равно досчитается, обновите страницу через минуту.
      </p>
    )
  }
  return (
    <p className="text-[15px] text-ink-2">
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
export function ConceptEditForm({ conceptId, roomHref }: { conceptId: string; roomHref: string }) {
  const router = useRouter()
  const [request, setRequest] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)
  const [sending, setSending] = useState(false)
  const [run, setRun] = useState<{ runId: string; accessToken: string } | null>(null)

  const finished = useCallback(
    (failed: boolean) => {
      setRun(null)
      if (failed) {
        setError('Правка не досчиталась. Попробуйте ещё раз.')
        return
      }
      toast({ title: 'Правка готова', tone: 'success' })
      router.push(roomHref)
    },
    [router, roomHref],
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
    setRequest('')
    setRun({ runId: result.data.runId, accessToken: result.data.accessToken })
  }

  if (run) {
    return (
      <div className="border border-line bg-muted p-5">
        <Waiting runId={run.runId} accessToken={run.accessToken} onFinished={finished} />
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
        Правим именно этот рендер, а не фотографию комнаты. Всё, о чём вы не попросите, останется
        как на картинке выше. Получите три варианта одной правки.
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
