'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { Button, Checkbox, Input } from '@uyut/ui'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { FormError } from '@/components/form-error'
import { PasswordField } from '@/components/password-field'
import { authClient } from '@/lib/auth-client'
import { authErrorMessage } from '@/lib/auth-errors'
import { type RegisterInput, registerSchema } from '@/lib/validation/auth'

export function RegisterForm() {
  const router = useRouter()
  const form = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { email: '', password: '' },
  })
  const { errors, isSubmitting } = form.formState

  async function onSubmit(values: RegisterInput) {
    const { error } = await authClient.signUp.email({
      email: values.email,
      password: values.password,
      name: values.email.split('@')[0] ?? '',
      callbackURL: '/profile?verified=1',
    })
    if (error) {
      form.setError('root', { message: authErrorMessage(error) })
      return
    }
    router.push('/verify-email')
    router.refresh()
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
      <PasswordField
        id="password"
        label="Пароль"
        autoComplete="new-password"
        hint="Не короче 8 знаков. Лучше фраза, которую помните только вы."
        error={errors.password?.message}
        {...form.register('password')}
      />
      <Checkbox
        id="consent"
        label="Даю согласие на обработку персональных данных"
        error={errors.consent?.message}
        {...form.register('consent')}
      />
      <FormError message={errors.root?.message} />
      <Button type="submit" pending={isSubmitting} className="w-full">
        {isSubmitting ? 'Создаём…' : 'Создать аккаунт'}
      </Button>
      <p className="text-sm text-ink-2">
        Уже есть аккаунт?{' '}
        <Link
          href="/login"
          className="text-ink underline decoration-accent decoration-1 underline-offset-4"
        >
          Войти
        </Link>
      </p>
    </form>
  )
}
