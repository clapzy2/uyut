'use client'

import { Icon, toast } from '@uyut/ui'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { tooLargeMessage } from '@/lib/files/rules'

type ActionResult = { ok: true; data: undefined } | { ok: false; error: string }

type Props = {
  inputId: string
  field: string
  accept: string
  maxBytes: number
  label: string
  pendingLabel: string
  successTitle: string
  action: (formData: FormData) => Promise<ActionResult>
}

// Один загрузчик на планы и фото: проверка размера до отправки, остальное решает сервер
export function FileUploader({
  inputId,
  field,
  accept,
  maxBytes,
  label,
  pendingLabel,
  successTitle,
  action,
}: Props) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState(false)

  async function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      return
    }
    if (file.size > maxBytes) {
      toast({
        title: 'Файл слишком большой',
        description: tooLargeMessage(file.size, maxBytes),
        tone: 'danger',
      })
      return
    }
    setPending(true)
    const formData = new FormData()
    formData.set(field, file)
    const result = await action(formData)
    setPending(false)
    if (!result.ok) {
      toast({ title: 'Файл не загрузился', description: result.error, tone: 'danger' })
      return
    }
    toast({ title: successTitle, tone: 'success' })
    router.refresh()
  }

  return (
    <>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={accept}
        onChange={onChange}
        className="sr-only"
        aria-label={label}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={pending}
        className="inline-flex items-center gap-2 text-[15px] text-ink underline decoration-accent decoration-1 underline-offset-4 transition-colors duration-200 ease-ui hover:text-accent disabled:opacity-60"
      >
        <Icon name="upload" className="size-4" />
        {pending ? pendingLabel : label}
      </button>
    </>
  )
}
