import { JetBrains_Mono, Literata, Onest } from 'next/font/google'

// Один список на корневой макет и на экран полного отказа: там своя разметка html, но шрифты те же
export const literata = Literata({
  subsets: ['latin', 'cyrillic'],
  axes: ['opsz'],
  variable: '--font-literata',
  display: 'swap',
})

export const onest = Onest({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-onest',
  display: 'swap',
})

export const jetbrains = JetBrains_Mono({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-jetbrains',
  display: 'swap',
})

export const fontVariables = `${literata.variable} ${onest.variable} ${jetbrains.variable}`
