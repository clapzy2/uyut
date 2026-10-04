import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AuthShell } from '@/components/auth-shell'
import { ResendVerificationButton } from '@/components/resend-verification-button'
import { getSession } from '@/lib/session'

export const metadata: Metadata = { title: 'Проверьте почту' }

export default async function VerifyEmailPage() {
  const session = await getSession()
  if (!session) {
    redirect('/login')
  }
  if (session.user.emailVerified) {
    redirect('/projects')
  }

  return (
    <AuthShell
      title="Проверьте почту."
      lede={`Письмо со ссылкой ушло на ${session.user.email}. Если его нет, загляните в папку со спамом.`}
    >
      <div className="flex flex-col items-start gap-4">
        <p className="text-[15px] text-ink-2">
          Ссылка работает сутки. Пока почта не подтверждена, можно осмотреться, но оплатить проект
          не получится.
        </p>
        <ResendVerificationButton email={session.user.email} />
        <Link
          href="/projects"
          className="inline-flex min-h-11 items-center text-[15px] text-accent underline decoration-line-strong underline-offset-4"
        >
          Перейти к квартире
        </Link>
      </div>
    </AuthShell>
  )
}
