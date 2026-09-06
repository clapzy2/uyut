import { Toaster } from '@uyut/ui'
import type { Metadata } from 'next'
import { JetBrains_Mono, Literata, Onest } from 'next/font/google'
import { cookies } from 'next/headers'
import type { ReactNode } from 'react'
import { SiteFooter } from '@/components/site-footer'
import { SiteHeader } from '@/components/site-header'
import { VerifyEmailBanner } from '@/components/verify-email-banner'
import { getSession } from '@/lib/session'
import { parseTheme, THEME_COOKIE, themeAttribute } from '@/lib/theme'
import './globals.css'

const literata = Literata({
  subsets: ['latin', 'cyrillic'],
  axes: ['opsz'],
  variable: '--font-literata',
  display: 'swap',
})

const onest = Onest({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-onest',
  display: 'swap',
})

const jetbrains = JetBrains_Mono({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-jetbrains',
  display: 'swap',
})

export const metadata: Metadata = {
  title: { default: 'Uyut', template: '%s · Uyut' },
  description:
    'Концепты интерьера с мебелью из российских магазинов, сметой и заданием для мастеров',
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies()
  const theme = parseTheme(cookieStore.get(THEME_COOKIE)?.value)
  const session = await getSession()
  const user = session?.user ?? null

  return (
    <html
      lang="ru"
      data-theme={themeAttribute(theme)}
      className={`${literata.variable} ${onest.variable} ${jetbrains.variable}`}
    >
      <body className="flex min-h-dvh flex-col font-sans">
        <SiteHeader theme={theme} user={user ? { name: user.name } : null} />
        {user && !user.emailVerified ? <VerifyEmailBanner email={user.email} /> : null}
        <main className="flex-1">{children}</main>
        <SiteFooter />
        <Toaster />
      </body>
    </html>
  )
}
