import type { Metadata } from 'next'
import { AuthShell } from '@/components/auth-shell'
import { LoginForm } from '@/components/login-form'
import { safeNextPath } from '@/lib/next-path'

export const metadata: Metadata = { title: 'Вход' }

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  return (
    <AuthShell
      eyebrow="Вход"
      title="С возвращением."
      lede="Ваши проекты и концепты там, где вы их оставили."
    >
      <LoginForm next={safeNextPath(next)} />
    </AuthShell>
  )
}
