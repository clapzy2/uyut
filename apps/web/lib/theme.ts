import { z } from 'zod'

export const THEME_COOKIE = 'theme'
export const themeSchema = z.enum(['system', 'light', 'dark'])
export type Theme = z.infer<typeof themeSchema>

export function parseTheme(value: string | undefined): Theme {
  const result = themeSchema.safeParse(value)
  return result.success ? result.data : 'system'
}

// «Как в системе» означает отсутствие атрибута: тему решает медиазапрос
export function themeAttribute(theme: Theme): 'light' | 'dark' | undefined {
  return theme === 'system' ? undefined : theme
}
