import type { ReactNode } from 'react'

// Редакционная композиция экранов входа: слева крупный заголовок, справа форма
export function AuthShell({
  title,
  lede,
  children,
}: {
  title: string
  lede?: string
  children: ReactNode
}) {
  return (
    <section className="mx-auto grid max-w-6xl gap-10 px-5 py-12 sm:px-8 sm:py-16 lg:grid-cols-[1.1fr_1fr] lg:gap-16 lg:py-24">
      <div>
        <h1 className="font-serif text-[40px] font-normal leading-[1.05] tracking-tight text-ink sm:text-5xl lg:text-[56px]">
          {title}
        </h1>
        {lede ? <p className="mt-5 max-w-md text-lg leading-relaxed text-ink-2">{lede}</p> : null}
      </div>
      <div className="w-full max-w-md lg:justify-self-end">{children}</div>
    </section>
  )
}
