'use client'

import { Button } from '@uyut/ui'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { authClient } from '@/lib/auth-client'

export function SignOutButton() {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function signOut() {
    setPending(true)
    await authClient.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <Button variant="ghost" onClick={signOut} pending={pending}>
      Выйти
    </Button>
  )
}
