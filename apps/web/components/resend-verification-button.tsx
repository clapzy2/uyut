'use client'

import { Button, toast } from '@uyut/ui'
import { useState } from 'react'
import { authClient } from '@/lib/auth-client'
import { authErrorMessage } from '@/lib/auth-errors'

export function ResendVerificationButton({ email }: { email: string }) {
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
      description: 'Проверьте почту, включая папку со спамом.',
    })
  }

  return (
    <Button variant="secondary" onClick={resend} pending={pending}>
      {pending ? 'Отправляем…' : 'Отправить ещё раз'}
    </Button>
  )
}
