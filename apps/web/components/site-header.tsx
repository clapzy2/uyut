import Link from 'next/link'
import { ThemeToggle } from '@/components/theme-toggle'
import type { Theme } from '@/lib/theme'

const linkClassName =
  'py-2 text-[15px] text-ink-2 underline-offset-[6px] decoration-1 decoration-accent transition-colors duration-200 ease-ui hover:text-ink hover:underline'

export function SiteHeader({ theme, user }: { theme: Theme; user: { name: string } | null }) {
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-5 sm:px-8">
        <Link
          href="/"
          className="inline-block py-2 font-serif text-[26px] leading-none tracking-tight text-ink"
        >
          Uyut
        </Link>
        <nav className="flex items-center gap-3 sm:gap-7" aria-label="Основное меню">
          {user ? (
            <>
              <Link href="/projects" className={linkClassName}>
                Проекты
              </Link>
              <Link href="/profile" className={linkClassName}>
                Профиль
              </Link>
            </>
          ) : (
            <>
              <Link href="/login" className={linkClassName}>
                Войти
              </Link>
              <Link href="/register" className={`${linkClassName} hidden sm:inline`}>
                Создать аккаунт
              </Link>
            </>
          )}
          <ThemeToggle initial={theme} />
        </nav>
      </div>
    </header>
  )
}
