'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { Button, Input, toast } from '@uyut/ui'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { updateProfile } from '@/actions/profile'
import { FormError } from '@/components/form-error'
import { type ProfileInput, profileSchema } from '@/lib/validation/auth'

export function ProfileForm({
  name,
  email,
  emailVerified,
}: {
  name: string
  email: string
  emailVerified: boolean
}) {
  const router = useRouter()
  const form = useForm<ProfileInput>({
    resolver: zodResolver(profileSchema),
    defaultValues: { name },
  })
  const { errors, isSubmitting, isDirty } = form.formState

  async function onSubmit(values: ProfileInput) {
    const result = await updateProfile(values)
    if (!result.ok) {
      form.setError('root', { message: result.error })
      return
    }
    toast({ title: 'Сохранили', tone: 'success' })
    form.reset(values)
    router.refresh()
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5">
      <Input
        id="name"
        label="Имя"
        autoComplete="name"
        error={errors.name?.message}
        {...form.register('name')}
      />
      <Input
        id="email"
        label="Почта"
        type="email"
        value={email}
        readOnly
        hint={emailVerified ? 'Подтверждена' : 'Ещё не подтверждена: письмо у вас в почте'}
      />
      <FormError message={errors.root?.message} />
      <Button type="submit" pending={isSubmitting} disabled={!isDirty} className="self-start">
        {isSubmitting ? 'Сохраняем…' : 'Сохранить'}
      </Button>
    </form>
  )
}
