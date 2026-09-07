'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { Button, Input } from '@uyut/ui'
import Link from 'next/link'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { FormError } from '@/components/form-error'
import { authClient } from '@/lib/auth-client'
import { authErrorMessage } from '@/lib/auth-errors'
import { type ForgotPasswordInput, forgotPasswordSchema } from '@/lib/validation/auth'

export function ForgotPasswordForm() {
  const [sentTo, setSentTo] = useState<string | null>(null)
  const form = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  })
  const { errors, isSubmitting } = form.formState

  async function onSubmit(values: ForgotPasswordInput) {
    const { error } = await authClient.requestPasswordReset({
      email: values.email,
      redirectTo: '/reset-password',
    })
    if (error) {
      form.setError('root', { message: authErrorMessage(error) })
      return
    }
    setSentTo(values.email)
  }

  if (sentTo) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-lg text-ink">Если адрес {sentTo} у нас есть, письмо уже ушло.</p>
        <p className="text-[15px] text-ink-2">
          Ссылка в письме работает полчаса. Если письма нет, загляните в папку со спамом.
        </p>
        <Link
          href="/login"
          className="text-sm text-ink-2 underline decoration-accent decoration-1 underline-offset-4 hover:text-ink"
        >
          Вернуться ко входу
        </Link>
      </div>
    )
  }

  return (
    <form
      method="post"
      onSubmit={form.handleSubmit(onSubmit)}
      noValidate
      className="flex flex-col gap-5"
    >
      <Input
        id="email"
        label="Почта"
        type="email"
        autoComplete="email"
        inputMode="email"
        error={errors.email?.message}
        {...form.register('email')}
      />
      <FormError message={errors.root?.message} />
      <Button type="submit" pending={isSubmitting} className="w-full">
        {isSubmitting ? 'Отправляем…' : 'Отправить ссылку'}
      </Button>
      <Link
        href="/login"
        className="text-sm text-ink-2 underline decoration-accent decoration-1 underline-offset-4 hover:text-ink"
      >
        Вспомнили пароль? Войти
      </Link>
    </form>
  )
}
