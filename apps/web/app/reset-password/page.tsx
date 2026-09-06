import type { Metadata } from 'next'
import Link from 'next/link'
import { AuthShell } from '@/components/auth-shell'
import { ResetPasswordForm } from '@/components/reset-password-form'

export const metadata: Metadata = { title: 'Новый пароль' }

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>
}) {
  const { token, error } = await searchParams

  if (!token || error) {
    return (
      <AuthShell title="Ссылка не сработала." lede="Она устарела или уже была использована.">
        <div className="flex flex-col gap-4">
          <p className="text-[15px] text-ink-2">
            Ссылка для смены пароля живёт полчаса и открывается один раз. Запросите новую, это
            займёт минуту.
          </p>
          <Link
            href="/forgot-password"
            className="text-ink underline decoration-accent decoration-1 underline-offset-4"
          >
            Запросить новую ссылку
          </Link>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Новый пароль." lede="Старый перестанет работать сразу после сохранения.">
      <ResetPasswordForm token={token} />
    </AuthShell>
  )
}
