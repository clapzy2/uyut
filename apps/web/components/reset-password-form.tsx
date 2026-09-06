'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { Button, toast } from '@uyut/ui'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { FormError } from '@/components/form-error'
import { PasswordField } from '@/components/password-field'
import { authClient } from '@/lib/auth-client'
import { authErrorMessage } from '@/lib/auth-errors'
import { type ResetPasswordInput, resetPasswordSchema } from '@/lib/validation/auth'

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter()
  const form = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: '', confirm: '' },
  })
  const { errors, isSubmitting } = form.formState

  async function onSubmit(values: ResetPasswordInput) {
    const { error } = await authClient.resetPassword({ newPassword: values.password, token })
    if (error) {
      form.setError('root', { message: authErrorMessage(error) })
      return
    }
    toast({
      title: 'Пароль обновлён',
      description: 'Теперь можно войти с новым паролем.',
      tone: 'success',
    })
    router.push('/login')
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5">
      <PasswordField
        id="password"
        label="Новый пароль"
        autoComplete="new-password"
        hint="Не короче 8 знаков."
        error={errors.password?.message}
        {...form.register('password')}
      />
      <PasswordField
        id="confirm"
        label="Ещё раз"
        autoComplete="new-password"
        error={errors.confirm?.message}
        {...form.register('confirm')}
      />
      <FormError message={errors.root?.message} />
      <Button type="submit" pending={isSubmitting} className="w-full">
        {isSubmitting ? 'Сохраняем…' : 'Сохранить и войти'}
      </Button>
    </form>
  )
}
