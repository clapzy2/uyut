import type { Metadata } from 'next'
import { AuthShell } from '@/components/auth-shell'
import { RegisterForm } from '@/components/register-form'

export const metadata: Metadata = { title: 'Регистрация' }

export default function RegisterPage() {
  return (
    <AuthShell title="С чего начнём?" lede="Один проект и три концепта бесплатно. Карта не нужна.">
      <RegisterForm />
    </AuthShell>
  )
}
