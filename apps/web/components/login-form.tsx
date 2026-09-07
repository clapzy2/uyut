'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { Button, Input } from '@uyut/ui'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { FormError } from '@/components/form-error'
import { PasswordField } from '@/components/password-field'
import { authClient } from '@/lib/auth-client'
import { authErrorMessage } from '@/lib/auth-errors'
import { type LoginInput, loginSchema } from '@/lib/validation/auth'

const linkClassName =
  'text-sm text-ink-2 underline decoration-accent decoration-1 underline-offset-4 transition-colors duration-200 ease-ui hover:text-ink'

export function LoginForm({ next }: { next: string }) {
  const router = useRouter()
  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  })
  const { errors, isSubmitting } = form.formState

  async function onSubmit(values: LoginInput) {
    const { error } = await authClient.signIn.email({
      email: values.email,
      password: values.password,
    })
    if (error) {
      form.setError('root', { message: authErrorMessage(error) })
      return
    }
    router.push(next)
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
        autoComplete="current-password"
        error={errors.password?.message}
        {...form.register('password')}
      />
      <FormError message={errors.root?.message} />
      <Button type="submit" pending={isSubmitting} className="w-full">
        {isSubmitting ? 'Входим…' : 'Войти'}
      </Button>
      <div className="flex justify-between gap-4">
        <Link href="/forgot-password" className={linkClassName}>
          Забыли пароль?
        </Link>
        <Link href="/register" className={linkClassName}>
          Создать аккаунт
        </Link>
      </div>
    </form>
  )
}
