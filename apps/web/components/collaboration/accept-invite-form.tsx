'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { Button, toast } from '@uyut/ui'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { acceptInvite } from '@/actions/collaboration'
import { FormError } from '@/components/form-error'
import { PasswordField } from '@/components/password-field'
import { type AcceptInviteFormInput, acceptInviteFormSchema } from '@/lib/validation/collaboration'

export function AcceptInviteForm({
  token,
  needsPassword,
}: {
  token: string
  needsPassword: boolean
}) {
  const router = useRouter()
  const form = useForm<AcceptInviteFormInput>({
    resolver: zodResolver(acceptInviteFormSchema),
    defaultValues: { password: '', confirm: '' },
  })
  const { errors, isSubmitting } = form.formState

  async function onSubmit(values: AcceptInviteFormInput) {
    const result = await acceptInvite({ token, password: needsPassword ? values.password : '' })
    if (!result.ok) {
      form.setError('root', { message: result.error })
      return
    }
    toast({ title: 'Вы в проекте', tone: 'success' })
    router.push(`/projects/${result.data.projectId}`)
    router.refresh()
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5">
      {needsPassword ? (
        <>
          <p className="text-[15px] leading-relaxed text-ink-2">
            Вы вошли по ссылке из письма. Придумайте пароль, чтобы возвращаться в проект без новых
            писем. Можно и позже: на странице входа есть «Забыли пароль?».
          </p>
          <PasswordField
            id="password"
            label="Пароль"
            autoComplete="new-password"
            hint="Не короче 8 знаков. Оставьте пустым, чтобы задать позже."
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
        </>
      ) : null}
      <FormError message={errors.root?.message} />
      <Button type="submit" pending={isSubmitting} className="w-full">
        {isSubmitting ? 'Открываем…' : 'Открыть проект'}
      </Button>
    </form>
  )
}
