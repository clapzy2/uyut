import Link from 'next/link'
import { BrandMark } from '@/components/brand-mark'
import { ThemeToggle } from '@/components/theme-toggle'
import type { Theme } from '@/lib/theme'

const linkClassName =
  'inline-flex min-h-11 items-center py-2 text-[13px] text-ink-2 underline-offset-[6px] decoration-1 decoration-accent transition-colors duration-200 ease-ui hover:text-ink hover:underline sm:text-[15px]'

export function SiteHeader({ theme, user }: { theme: Theme; user: { name: string } | null }) {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-page/90 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-3 min-[360px]:gap-3 min-[360px]:px-5 sm:gap-6 sm:px-8">
        <Link
          href="/"
          className="group inline-flex min-h-11 shrink-0 items-center gap-1.5 py-2 font-serif text-[20px] leading-none tracking-tight text-ink min-[360px]:gap-2 min-[360px]:text-[23px] sm:gap-2.5 sm:text-[26px]"
        >
          <BrandMark className="size-6 shrink-0 transition-transform duration-300 ease-appear group-hover:-translate-y-0.5 sm:size-7" />
          Домица
        </Link>
        <nav
          className="flex min-w-0 items-center gap-1.5 min-[360px]:gap-2.5 sm:gap-7"
          aria-label="Основное меню"
        >
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
