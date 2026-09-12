'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

/**
 * Мягкое появление страницы при переходе.
 *
 * Ключ — путь, а не весь адрес: обновление страницы на месте, смена параметров и router.refresh()
 * дерево не пересобирают, и подмигивания на ровном месте не будет. Анимация одна и та же для всех
 * страниц, потому что она здесь не украшение: без неё переход выглядит как рывок, и непонятно,
 * сменилась страница или просто дёрнулась.
 *
 * Кому анимации мешают, тот выключил их в системе, и браузер сам сводит длительность к нулю:
 * правило prefers-reduced-motion стоит глобально.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  return (
    <main key={pathname} className="flex-1 animate-[rise-in_250ms_var(--ease-appear)]">
      {children}
    </main>
  )
}
