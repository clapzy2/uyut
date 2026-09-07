'use client'

import { Button, Dialog, DialogClose, DialogContent, DialogTrigger, toast } from '@uyut/ui'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { deleteRoom } from '@/actions/rooms'

export function DeleteRoomDialog({ roomId, name }: { roomId: string; name: string }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function confirm() {
    setPending(true)
    const result = await deleteRoom(roomId)
    setPending(false)
    if (!result.ok) {
      toast({ title: 'Не удалось удалить', description: result.error, tone: 'danger' })
      return
    }
    toast({ title: 'Комната удалена' })
    router.push(`/projects/${result.data.projectId}`)
    router.refresh()
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-block py-1.5 text-sm text-ink-2 underline decoration-line-strong decoration-1 underline-offset-4 transition-colors duration-200 ease-ui hover:text-danger hover:decoration-danger"
        >
          Удалить комнату
        </button>
      </DialogTrigger>
      <DialogContent
        title={`Удалить «${name}»?`}
        description="Фото и заметки этой комнаты тоже исчезнут."
      >
        <div className="flex flex-wrap gap-3">
          <Button onClick={confirm} pending={pending}>
            {pending ? 'Удаляем…' : 'Удалить'}
          </Button>
          <DialogClose asChild>
            <Button variant="secondary">Оставить</Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  )
}
