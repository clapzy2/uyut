import type { Metadata } from 'next'
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
    redirect('/profile')
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
      </div>
    </AuthShell>
  )
}
