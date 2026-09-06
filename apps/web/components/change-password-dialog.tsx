'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { Button, Dialog, DialogContent, DialogTrigger, toast } from '@uyut/ui'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { FormError } from '@/components/form-error'
import { PasswordField } from '@/components/password-field'
import { authClient } from '@/lib/auth-client'
import { authErrorMessage } from '@/lib/auth-errors'
import { type ChangePasswordInput, changePasswordSchema } from '@/lib/validation/auth'

export function ChangePasswordDialog() {
  const [open, setOpen] = useState(false)
  const form = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '' },
  })
  const { errors, isSubmitting } = form.formState

  async function onSubmit(values: ChangePasswordInput) {
    const { error } = await authClient.changePassword({
      currentPassword: values.currentPassword,
      newPassword: values.newPassword,
      revokeOtherSessions: true,
    })
    if (error) {
      form.setError('root', { message: authErrorMessage(error) })
      return
    }
    toast({
      title: 'Пароль изменён',
      description: 'На других устройствах придётся войти заново.',
      tone: 'success',
    })
    form.reset()
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">Сменить пароль</Button>
      </DialogTrigger>
      <DialogContent
        title="Новый пароль"
        description="Сначала текущий, потом новый. Не короче 8 знаков."
      >
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5">
          <PasswordField
            id="current-password"
            label="Текущий пароль"
            autoComplete="current-password"
            error={errors.currentPassword?.message}
            {...form.register('currentPassword')}
          />
          <PasswordField
            id="new-password"
            label="Новый пароль"
            autoComplete="new-password"
            error={errors.newPassword?.message}
            {...form.register('newPassword')}
          />
          <FormError message={errors.root?.message} />
          <Button type="submit" pending={isSubmitting}>
            {isSubmitting ? 'Сохраняем…' : 'Сохранить'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
