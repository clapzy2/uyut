import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'

export const metadata: Metadata = { title: 'Проекты' }

export default async function ProjectsPage() {
  const session = await getSession()
  if (!session) {
    redirect('/login?next=/projects')
  }

  return (
    <section className="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-16 lg:py-24">
      <div className="max-w-xl">
        <h1 className="font-serif text-[40px] font-normal leading-[1.05] tracking-tight text-ink sm:text-5xl lg:text-[56px]">
          Здесь будут ваши проекты.
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-ink-2">
          Проект это одна квартира: план, комнаты, концепты и список покупок. Первый проект можно
          будет завести совсем скоро, мы как раз этим заняты.
        </p>
      </div>
    </section>
  )
}
