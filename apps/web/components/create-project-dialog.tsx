'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { Button, Dialog, DialogContent, DialogTrigger, Input } from '@uyut/ui'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { createProject } from '@/actions/projects'
import { FormError } from '@/components/form-error'
import { type CreateProjectInput, createProjectSchema } from '@/lib/validation/projects'

export function CreateProjectDialog({
  variant,
  label,
}: {
  variant: 'primary' | 'secondary'
  label: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const form = useForm<CreateProjectInput>({
    resolver: zodResolver(createProjectSchema),
    defaultValues: { title: '' },
  })
  const { errors, isSubmitting } = form.formState

  async function onSubmit(values: CreateProjectInput) {
    const result = await createProject(values)
    if (!result.ok) {
      form.setError('root', { message: result.error })
      return
    }
    setOpen(false)
    router.push(`/projects/${result.data.id}`)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant}>{label}</Button>
      </DialogTrigger>
      <DialogContent
        title="Новый проект"
        description="Одна квартира, один проект. Начнём с названия, остальное добавим по ходу."
      >
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5">
          <Input
            id="project-title"
            label="Название"
            placeholder="Квартира на Ленина"
            autoComplete="off"
            error={errors.title?.message}
            {...form.register('title')}
          />
          <FormError message={errors.root?.message} />
          <Button type="submit" pending={isSubmitting} className="self-start">
            {isSubmitting ? 'Создаём…' : 'Создать'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
