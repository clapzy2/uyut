'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { Button, Textarea, toast } from '@uyut/ui'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { updateRoomNotes } from '@/actions/rooms'
import { FormError } from '@/components/form-error'
import { type RoomNotesInput, roomNotesSchema } from '@/lib/validation/projects'

export function RoomNotesForm({ roomId, notes }: { roomId: string; notes: string | null }) {
  const router = useRouter()
  const form = useForm<RoomNotesInput>({
    resolver: zodResolver(roomNotesSchema),
    defaultValues: { notes: notes ?? '' },
  })
  const { errors, isSubmitting, isDirty } = form.formState

  async function onSubmit(values: RoomNotesInput) {
    const result = await updateRoomNotes(roomId, values)
    if (!result.ok) {
      form.setError('root', { message: result.error })
      return
    }
    toast({ title: 'Сохранили', tone: 'success' })
    form.reset(values)
    router.refresh()
  }

  return (
    <form
      method="post"
      onSubmit={form.handleSubmit(onSubmit)}
      noValidate
      className="flex flex-col gap-4"
    >
      <Textarea
        id="notes"
        label="Заметки"
        placeholder="Что важно учесть: батарея под окном, дверь открывается внутрь…"
        error={errors.notes?.message}
        {...form.register('notes')}
      />
      <FormError message={errors.root?.message} />
      <Button
        type="submit"
        variant="secondary"
        pending={isSubmitting}
        disabled={!isDirty}
        className="self-start"
      >
        {isSubmitting ? 'Сохраняем…' : 'Сохранить'}
      </Button>
    </form>
  )
}
