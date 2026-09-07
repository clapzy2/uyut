'use client'

import { Icon } from '@uyut/ui'
import { useState } from 'react'
import { THEME_COOKIE, type Theme, themeAttribute } from '@/lib/theme'

const options: Array<{ value: Theme; label: string; icon: 'monitor' | 'sun' | 'moon' }> = [
  { value: 'system', label: 'Как в системе', icon: 'monitor' },
  { value: 'light', label: 'Светлая', icon: 'sun' },
  { value: 'dark', label: 'Тёмная', icon: 'moon' },
]

const ONE_YEAR = 60 * 60 * 24 * 365

export function ThemeToggle({ initial }: { initial: Theme }) {
  const [theme, setTheme] = useState<Theme>(initial)

  function apply(next: Theme) {
    setTheme(next)
    const attribute = themeAttribute(next)
    if (attribute) {
      document.documentElement.dataset.theme = attribute
    } else {
      delete document.documentElement.dataset.theme
    }
    // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API есть не во всех браузерах
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=${ONE_YEAR}; samesite=lax`
  }

  return (
    <fieldset className="m-0 flex items-center gap-0.5 border border-line p-0.5 rounded-full">
      <legend className="sr-only">Тема оформления</legend>
      {options.map((option) => {
        const active = option.value === theme
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            title={option.label}
            onClick={() => apply(option.value)}
            className={`grid size-9 place-items-center rounded-full transition-colors duration-200 ease-ui ${
              active ? 'bg-ink text-page' : 'text-ink-2 hover:text-ink'
            }`}
          >
            <Icon name={option.icon} className="size-4" />
            <span className="sr-only">{option.label}</span>
          </button>
        )
      })}
    </fieldset>
  )
}
