'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { Button, Dialog, DialogContent, DialogTrigger, Input, toast } from '@uyut/ui'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { createRoom } from '@/actions/rooms'
import { FormError } from '@/components/form-error'
import { KindPicker } from '@/components/kind-picker'
import { roomKindLabels } from '@/lib/projects/format'
import { type RoomInput, type RoomOutput, roomSchema } from '@/lib/validation/projects'

const kindLabelSet = new Set(Object.values(roomKindLabels))

export function AddRoomDialog({ projectId }: { projectId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const form = useForm<RoomInput, unknown, RoomOutput>({
    resolver: zodResolver(roomSchema),
    defaultValues: { kind: 'living', name: roomKindLabels.living, areaM2: '' },
  })
  const { errors, isSubmitting } = form.formState
  const kind = form.watch('kind')

  // Название подставляется по типу, пока пользователь не написал своё
  useEffect(() => {
    const current = form.getValues('name')
    if (!current || kindLabelSet.has(current)) {
      form.setValue('name', roomKindLabels[kind])
    }
  }, [kind, form])

  async function onSubmit(values: RoomOutput) {
    // На сервер уходят сырые строки из полей: преобразование делает серверная схема
    const result = await createRoom(projectId, form.getValues())
    if (!result.ok) {
      form.setError('root', { message: result.error })
      return
    }
    toast({ title: `${values.name}: комната добавлена`, tone: 'success' })
    form.reset()
    setOpen(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-block py-1.5 text-[15px] text-ink underline decoration-accent decoration-1 underline-offset-4 transition-colors duration-200 ease-ui hover:text-accent"
        >
          Добавить комнату
        </button>
      </DialogTrigger>
      <DialogContent title="Новая комната">
        <form
          method="post"
          onSubmit={form.handleSubmit(onSubmit)}
          noValidate
          className="flex flex-col gap-5"
        >
          <KindPicker registration={form.register('kind')} error={errors.kind?.message} />
          <Input
            id="room-name"
            label="Название"
            error={errors.name?.message}
            {...form.register('name')}
          />
          <Input
            id="room-area"
            label="Площадь, м²"
            inputMode="decimal"
            placeholder="18,5"
            hint="Необязательно, но поможет с мебелью по размеру"
            error={errors.areaM2?.message}
            {...form.register('areaM2')}
          />
          <FormError message={errors.root?.message} />
          <Button type="submit" pending={isSubmitting} className="self-start">
            {isSubmitting ? 'Добавляем…' : 'Добавить'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
