'use client'

import { useEffect, useRef, useState } from 'react'
import {
  detachFurnitureReference,
  type FurnitureReferenceView,
  uploadFurnitureReference,
} from '@/actions/furniture-reference'
import { PHOTO_ACCEPT, PHOTO_LIMIT_TEXT, PHOTO_MAX_BYTES, tooLargeMessage } from '@/lib/files/rules'

export function FurniturePhotoUpload({
  roomId,
  photoRevision,
  initialReference = null,
  onChange,
  onPendingChange,
}: {
  roomId: string
  photoRevision: number
  initialReference?: FurnitureReferenceView | null
  onChange: (token: string | null) => void
  onPendingChange: (pending: boolean) => void
}) {
  const [pending, setPending] = useState(false)
  const [ready, setReady] = useState(false)
  const [preview, setPreview] = useState<string | null>(initialReference?.previewUrl ?? null)
  const [token, setToken] = useState<string | null>(initialReference?.token ?? null)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    setReady(true)
  }, [])

  useEffect(() => {
    setPreview(initialReference?.previewUrl ?? null)
    setToken(initialReference?.token ?? null)
  }, [initialReference?.token, initialReference?.previewUrl])

  return (
    <div className="border border-line p-4">
      <p className="font-medium">Фото предмета для переноса</p>
      <p className="my-2 text-sm text-ink-2">
        Фото комнаты задаёт окружение, а этот снимок — внешний вид конкретной мебели. Снимите
        предмет целиком, лучше спереди. В заметках укажите, куда его поставить. Точное совпадение
        деталей и возможность установки нужно проверить отдельно.
      </p>
      <input
        ref={input}
        type="file"
        accept={PHOTO_ACCEPT}
        className="sr-only"
        aria-label="Загрузить отдельное фото предмета"
        disabled={!ready || pending}
        onChange={async (event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file || inFlight.current) return
          setError(null)
          if (file.size > PHOTO_MAX_BYTES) {
            setError(tooLargeMessage(file.size, PHOTO_MAX_BYTES))
            return
          }
          inFlight.current = true
          setPending(true)
          onPendingChange(true)
          // Новый выбор заменяет старый только после успешной загрузки.
          try {
            const form = new FormData()
            form.set('photo', file)
            form.set('photoRevision', String(photoRevision))
            const result = await uploadFurnitureReference(roomId, form)
            if (!result.ok) {
              setError(result.error)
              return
            }
            setPreview(result.data.previewUrl)
            setToken(result.data.token)
            onChange(result.data.token)
          } catch {
            setError(
              'Не удалось загрузить фото предмета. Генерация не запущена. Повторите загрузку.',
            )
          } finally {
            inFlight.current = false
            setPending(false)
            onPendingChange(false)
          }
        }}
      />
      <button
        type="button"
        disabled={!ready || pending}
        className="py-2 text-accent underline disabled:opacity-60"
        onClick={() => input.current?.click()}
      >
        {pending
          ? 'Загружаем предмет…'
          : preview
            ? 'Заменить фото предмета'
            : 'Загрузить отдельное фото предмета'}
      </button>
      <p className="text-sm text-ink-2">{PHOTO_LIMIT_TEXT}.</p>
      {preview ? (
        <>
          {/* biome-ignore lint/performance/noImgElement: приватный загруженный образец */}
          <img
            src={preview}
            alt="Прикреплённый предмет для переноса"
            className="my-3 max-h-64 max-w-full object-contain"
          />
          <p role="status" className="text-sm">
            Образец сохранён в комнате. При замене фото комнаты его потребуется прикрепить заново.
          </p>
          <button
            type="button"
            disabled={!ready || pending}
            className="py-2 text-sm underline"
            onClick={async () => {
              if (!token || inFlight.current) return
              inFlight.current = true
              setPending(true)
              onPendingChange(true)
              setError(null)
              try {
                const result = await detachFurnitureReference(roomId, token)
                if (!result.ok) {
                  setError(result.error)
                  return
                }
                setPreview(null)
                setToken(null)
                onChange(null)
              } catch {
                setError('Не удалось отключить образец. Повторите попытку.')
              } finally {
                inFlight.current = false
                setPending(false)
                onPendingChange(false)
              }
            }}
          >
            Не использовать это фото
          </button>
        </>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}
