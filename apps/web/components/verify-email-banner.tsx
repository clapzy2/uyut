'use client'

import { toast } from '@uyut/ui'
import { useState } from 'react'
import { authClient } from '@/lib/auth-client'
import { authErrorMessage } from '@/lib/auth-errors'

export function VerifyEmailBanner({ email }: { email: string }) {
  const [pending, setPending] = useState(false)

  async function resend() {
    setPending(true)
    const { error } = await authClient.sendVerificationEmail({
      email,
      callbackURL: '/profile?verified=1',
    })
    setPending(false)
    if (error) {
      toast({ title: 'Письмо не ушло', description: authErrorMessage(error), tone: 'danger' })
      return
    }
    toast({
      title: 'Письмо отправлено ещё раз',
      description: `Проверьте ${email}, включая папку со спамом.`,
    })
  }

  return (
    <div className="border-b border-line bg-muted">
      <div className="mx-auto flex max-w-6xl flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-5 py-3 text-sm sm:px-8">
        <p className="text-ink">
          Почта не подтверждена. Письмо ушло на <span className="font-medium">{email}</span>.
        </p>
        <button
          type="button"
          onClick={resend}
          disabled={pending}
          className="text-ink-2 underline decoration-accent decoration-1 underline-offset-4 transition-colors duration-200 ease-ui hover:text-ink disabled:opacity-60"
        >
          {pending ? 'Отправляем…' : 'Отправить ещё раз'}
        </button>
      </div>
    </div>
  )
}
