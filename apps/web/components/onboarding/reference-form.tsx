'use client'

import { Button, FieldHint, Input, toast } from '@uyut/ui'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { finishOnboarding, saveReferenceLink, uploadReference } from '@/actions/onboarding'
import { FileUploader } from '@/components/file-uploader'
import { FormError } from '@/components/form-error'
import { PHOTO_ACCEPT, PHOTO_LIMIT_TEXT, PHOTO_MAX_BYTES } from '@/lib/files/rules'

export function ReferenceForm({
  projectId,
  referenceSrc,
}: {
  projectId: string
  referenceSrc: string | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const uploadForProject = uploadReference.bind(null, projectId)

  function finish() {
    setError(null)
    startTransition(async () => {
      if (url.trim() !== '') {
        const saved = await saveReferenceLink(projectId, { url })
        if (!saved.ok) {
          setError(saved.error)
          return
        }
      }
      const result = await finishOnboarding(projectId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      toast({ title: 'Всё готово', description: 'Можно генерировать концепты' })
      router.push(`/projects/${projectId}`)
    })
  }

  return (
    <div className="flex flex-col gap-7">
      {referenceSrc ? (
        <div className="overflow-hidden border border-line bg-muted">
          {/* biome-ignore lint/performance/noImgElement: подписанная ссылка живёт 15 минут, оптимизатор next/image здесь не нужен */}
          <img src={referenceSrc} alt="Ваш референс" className="block w-full" />
        </div>
      ) : null}

      <Input
        id="reference-url"
        label="Ссылка на картинку"
        hint="Ссылка на саму картинку работает всегда. Pinterest иногда закрывается от нас, тогда сохраните картинку и загрузите файлом."
        inputMode="url"
        placeholder="https://…"
        value={url}
        onChange={(event) => setUrl(event.target.value)}
      />

      <div>
        <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-2">
          Или файл
        </p>
        <FileUploader
          inputId="reference"
          field="reference"
          accept={PHOTO_ACCEPT}
          maxBytes={PHOTO_MAX_BYTES}
          label={referenceSrc ? 'Заменить' : 'Загрузить картинку'}
          pendingLabel="Загружаем…"
          successTitle="Картинка сохранена"
          action={uploadForProject}
        />
        <FieldHint id="reference-limit">{PHOTO_LIMIT_TEXT}</FieldHint>
      </div>

      <FormError message={error ?? undefined} />
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="secondary"
          onClick={() => router.push(`/onboarding/step-4?project=${projectId}`)}
        >
          Назад
        </Button>
        <Button type="button" disabled={pending} onClick={finish}>
          {pending ? 'Сохраняем…' : 'Готово'}
        </Button>
      </div>
      <button
        type="button"
        onClick={() => {
          setUrl('')
          finish()
        }}
        disabled={pending}
        className="self-start py-1.5 text-sm text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink"
      >
        Пропустить этот шаг
      </button>
    </div>
  )
}
