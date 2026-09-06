'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { Button, Dialog, DialogContent, DialogTrigger, Input, toast } from '@uyut/ui'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { updateProject } from '@/actions/projects'
import { FormError } from '@/components/form-error'
import {
  type ProjectSettingsInput,
  type ProjectSettingsOutput,
  projectSettingsSchema,
} from '@/lib/validation/projects'

export function formatAreaInput(value: number | null): string {
  return value === null ? '' : String(value).replace('.', ',')
}

export function ProjectSettingsDialog({
  projectId,
  initial,
}: {
  projectId: string
  initial: { title: string; houseSeries: string | null; totalAreaM2: number | null }
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const form = useForm<ProjectSettingsInput, unknown, ProjectSettingsOutput>({
    resolver: zodResolver(projectSettingsSchema),
    defaultValues: {
      title: initial.title,
      houseSeries: initial.houseSeries ?? '',
      totalAreaM2: formatAreaInput(initial.totalAreaM2),
    },
  })
  const { errors, isSubmitting } = form.formState

  async function onSubmit() {
    const result = await updateProject(projectId, form.getValues())
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
      <DialogContent title="Настройки проекта">
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5">
          <Input
            id="title"
            label="Название"
            error={errors.title?.message}
            {...form.register('title')}
          />
          <Input
            id="house-series"
            label="Серия дома"
            placeholder="П-44"
            hint="Если не знаете, оставьте пустым"
            error={errors.houseSeries?.message}
            {...form.register('houseSeries')}
          />
          <Input
            id="total-area"
            label="Общая площадь, м²"
            inputMode="decimal"
            placeholder="54,5"
            error={errors.totalAreaM2?.message}
            {...form.register('totalAreaM2')}
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
