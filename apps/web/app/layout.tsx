import { Toaster } from '@uyut/ui'
import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import type { ReactNode } from 'react'
import { Analytics } from '@/components/analytics'
import { PageTransition } from '@/components/page-transition'
import { SiteFooter } from '@/components/site-footer'
import { SiteHeader } from '@/components/site-header'
import { VerifyEmailBanner } from '@/components/verify-email-banner'
import { getEnv } from '@/lib/env'
import { fontVariables } from '@/lib/fonts'
import { photo } from '@/lib/landing/photos'
import { getSession } from '@/lib/session'
import { parseTheme, THEME_COOKIE, themeAttribute } from '@/lib/theme'
import './globals.css'

const ogImage = photo('og').src

const description =
  'Концепты интерьера с мебелью из российских магазинов, сметой и заданием для мастеров'

// Функцией, а не константой: адрес приложения известен на запуске, а не при сборке
export async function generateMetadata(): Promise<Metadata> {
  return {
    metadataBase: new URL(getEnv().APP_URL),
    title: { default: 'Домица', template: '%s · Домица' },
    description,
    applicationName: 'Домица',
    openGraph: {
      type: 'website',
      locale: 'ru_RU',
      siteName: 'Домица',
      title: 'Домица — проект квартиры за вечер',
      description,
      // Картинку карточки добавим вместе с фотографиями лендинга
      ...(ogImage ? { images: [{ url: ogImage, width: 1200, height: 630 }] } : {}),
    },
    twitter: {
      card: ogImage ? 'summary_large_image' : 'summary',
      title: 'Домица — проект квартиры за вечер',
      description,
    },
    // Подтверждение владения сайтом для партнёрской сети: она читает этот тег на главной.
    // Значение публичное по своей природе, оно и должно быть видно в исходном коде страницы.
    verification: {
      other: { 'mitgo-verification': '550f8336-a359-475e-866d-cc5c89e774c4' },
    },
  }
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies()
  const theme = parseTheme(cookieStore.get(THEME_COOKIE)?.value)
  const session = await getSession()
  const user = session?.user ?? null

  return (
    <html lang="ru" data-theme={themeAttribute(theme)} className={fontVariables}>
      <body className="flex min-h-dvh flex-col font-sans">
        <SiteHeader theme={theme} user={user ? { name: user.name } : null} />
        {user && !user.emailVerified ? <VerifyEmailBanner email={user.email} /> : null}
        <PageTransition>{children}</PageTransition>
        <SiteFooter />
        <Toaster />
        <Analytics />
      </body>
    </html>
  )
}
