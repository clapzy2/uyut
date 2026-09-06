'use client'

import { Button, Dialog, DialogClose, DialogContent, DialogTrigger, toast } from '@uyut/ui'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { deleteProject } from '@/actions/projects'

export function DeleteProjectDialog({ projectId, title }: { projectId: string; title: string }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function confirm() {
    setPending(true)
    const result = await deleteProject(projectId)
    setPending(false)
    if (!result.ok) {
      toast({ title: 'Не удалось удалить', description: result.error, tone: 'danger' })
      return
    }
    toast({ title: 'Проект удалён' })
    router.push('/projects')
    router.refresh()
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="text-sm text-ink-2 underline decoration-line-strong decoration-1 underline-offset-4 transition-colors duration-200 ease-ui hover:text-danger hover:decoration-danger"
        >
          Удалить проект
        </button>
      </DialogTrigger>
      <DialogContent
        title={`Удалить «${title}»?`}
        description="Проект и комнаты исчезнут из списка, файлы удалим из хранилища."
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
