'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import type { RoomKind } from '@uyut/db'
import { Button, Dialog, DialogContent, DialogTrigger, Input, toast } from '@uyut/ui'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { updateRoom } from '@/actions/rooms'
import { FormError } from '@/components/form-error'
import { KindPicker } from '@/components/kind-picker'
import { formatAreaInput } from '@/components/project-settings-dialog'
import { applyAreaMask } from '@/lib/projects/area'
import { type RoomInput, type RoomOutput, roomSchema } from '@/lib/validation/projects'

export function RoomSettingsDialog({
  room,
}: {
  room: { id: string; name: string; kind: RoomKind; areaM2: number | null }
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const form = useForm<RoomInput, unknown, RoomOutput>({
    resolver: zodResolver(roomSchema),
    defaultValues: {
      // Ванная в переключателе не показывается, и подставить вместо неё гостиную — меньшее зло.
      // Детская там теперь есть, и подменять её нельзя: сохранение настроек молча меняло тип
      // комнаты, а вместе с ним задание модели и список предметов для детектора.
      kind: room.kind === 'bath' ? 'living' : room.kind,
      name: room.name,
      areaM2: formatAreaInput(room.areaM2),
    },
  })
  const { errors, isSubmitting } = form.formState
  const area = form.register('areaM2')

  async function onSubmit() {
    const result = await updateRoom(room.id, form.getValues())
    if (!result.ok) {
      form.setError('root', { message: result.error })
      return
    }
    toast({ title: 'Сохранили', tone: 'success' })
    setOpen(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost">Настроить</Button>
      </DialogTrigger>
      <DialogContent title="Настройки комнаты">
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
            error={errors.areaM2?.message}
            {...area}
            onChange={(event) => {
              applyAreaMask(event.currentTarget)
              void area.onChange(event)
            }}
          />
          <FormError message={errors.root?.message} />
          <Button type="submit" pending={isSubmitting} className="self-start">
            {isSubmitting ? 'Сохраняем…' : 'Сохранить'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
