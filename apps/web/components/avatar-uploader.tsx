'use client'

import { Icon, toast } from '@uyut/ui'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { uploadAvatar } from '@/actions/profile'
import { AVATAR_ACCEPT, AVATAR_MAX_BYTES } from '@/lib/avatar-rules'

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

export function AvatarUploader({ currentUrl, name }: { currentUrl: string | null; name: string }) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState(false)

  async function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      return
    }
    if (file.size > AVATAR_MAX_BYTES) {
      toast({
        title: 'Файл слишком большой',
        description: 'Подойдёт фото до 5 МБ.',
        tone: 'danger',
      })
      return
    }
    setPending(true)
    const formData = new FormData()
    formData.set('avatar', file)
    const result = await uploadAvatar(formData)
    setPending(false)
    if (!result.ok) {
      toast({ title: 'Фото не загрузилось', description: result.error, tone: 'danger' })
      return
    }
    toast({ title: 'Фото обновлено', tone: 'success' })
    router.refresh()
  }

  return (
    <div className="flex items-center gap-6">
      <div className="grid size-28 place-items-center overflow-hidden rounded-full border border-line bg-muted font-serif text-3xl text-ink-2">
        {currentUrl ? (
          // biome-ignore lint/performance/noImgElement: подписанная ссылка живёт 15 минут, оптимизатор next/image здесь не нужен
          <img src={currentUrl} alt="" className="size-full object-cover" />
        ) : (
          <span aria-hidden="true">{initials(name) || 'У'}</span>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <input
          ref={inputRef}
          type="file"
          accept={AVATAR_ACCEPT}
          onChange={onChange}
          className="sr-only"
          id="avatar"
          aria-label="Загрузить фото"
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={pending}
          className="inline-flex items-center gap-2 text-[15px] text-ink underline decoration-accent decoration-1 underline-offset-4 transition-colors duration-200 ease-ui hover:text-accent disabled:opacity-60"
        >
          <Icon name="upload" className="size-4" />
          {pending ? 'Загружаем…' : currentUrl ? 'Заменить фото' : 'Загрузить фото'}
        </button>
        <p className="text-sm text-ink-2">JPG, PNG или WebP до 5 МБ.</p>
      </div>
    </div>
  )
}
