'use client'

import { Icon } from '@uyut/ui'
import { useState } from 'react'
import { THEME_COOKIE, type Theme, themeAttribute } from '@/lib/theme'

type ThemeOption = { value: Theme; label: string; icon: 'monitor' | 'sun' | 'moon' }

const defaultOption: ThemeOption = { value: 'system', label: 'Как в системе', icon: 'monitor' }

const options: ThemeOption[] = [
  defaultOption,
  { value: 'light', label: 'Светлая', icon: 'sun' },
  { value: 'dark', label: 'Тёмная', icon: 'moon' },
]

const ONE_YEAR = 60 * 60 * 24 * 365

export function ThemeToggle({ initial }: { initial: Theme }) {
  const [theme, setTheme] = useState<Theme>(initial)
  const active = options.find((option) => option.value === theme) ?? defaultOption

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

  function cycle() {
    const index = options.findIndex((option) => option.value === theme)
    apply(options[(index + 1) % options.length]?.value ?? 'system')
  }

  return (
    <>
      <button
        type="button"
        title={`Тема: ${active.label}`}
        aria-label={`Тема: ${active.label}. Переключить`}
        onClick={cycle}
        className="group grid size-9 shrink-0 place-items-center rounded-full border border-line text-ink-2 transition-[color,border-color,transform] duration-200 ease-ui hover:border-line-strong hover:text-ink active:scale-90 sm:hidden"
      >
        <Icon
          name={active.icon}
          className="size-4 transition-transform duration-300 ease-appear group-active:rotate-12"
        />
      </button>
      <fieldset className="m-0 hidden items-center gap-0.5 rounded-full border border-line p-0.5 sm:flex">
        <legend className="sr-only">Тема оформления</legend>
        {options.map((option) => {
          const selected = option.value === theme
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              title={option.label}
              onClick={() => apply(option.value)}
              className={`grid size-8 place-items-center rounded-full transition-[color,background-color,transform] duration-200 ease-ui active:scale-90 ${
                selected ? 'bg-ink text-page' : 'text-ink-2 hover:text-ink'
              }`}
            >
              <Icon name={option.icon} className="size-4" />
              <span className="sr-only">{option.label}</span>
            </button>
          )
        })}
      </fieldset>
    </>
  )
}
