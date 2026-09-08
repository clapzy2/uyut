import type { Metadata } from 'next'
import { AuthShell } from '@/components/auth-shell'
import { ForgotPasswordForm } from '@/components/forgot-password-form'

export const metadata: Metadata = { title: 'Восстановление пароля' }

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      eyebrow="Восстановление пароля"
      title="Восстановим доступ."
      lede="Пришлём ссылку, по которой можно задать новый пароль. Она работает полчаса."
    >
      <ForgotPasswordForm />
    </AuthShell>
  )
}
