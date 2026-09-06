import { buttonClassName } from '@uyut/ui'
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { projectMeta } from '@/lib/projects/format'
import { listProjects } from '@/lib/projects/repository'
import { getSession } from '@/lib/session'
import { presignedObjectUrl } from '@/lib/storage'

export const metadata: Metadata = { title: 'Проекты' }

async function planThumbnail(key: string | null): Promise<{ url: string } | { pdf: true } | null> {
  if (!key) {
    return null
  }
  if (key.endsWith('.pdf')) {
    return { pdf: true }
  }
  return { url: await presignedObjectUrl(key) }
}

export default async function ProjectsPage() {
  const session = await getSession()
  if (!session) {
    redirect('/login?next=/projects')
  }
  const items = await listProjects(session.user.id)

  if (items.length === 0) {
    return (
      <section className="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-16 lg:py-24">
        <div className="max-w-xl">
          <h1 className="font-serif text-[40px] font-normal leading-[1.05] tracking-tight text-ink sm:text-5xl lg:text-[56px]">
            Заведём первый проект.
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-ink-2">
            Проект это одна квартира: план, комнаты, потом концепты и список покупок. Начнём с
            названия, остальное добавим по ходу.
          </p>
          <div className="mt-8">
            <Link href="/onboarding/step-1" className={buttonClassName()}>
              Создать проект
            </Link>
          </div>
        </div>
      </section>
    )
  }

  const thumbnails = await Promise.all(items.map((item) => planThumbnail(item.planUrl)))

  return (
    <section className="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-16 lg:py-20">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-serif text-[40px] font-normal leading-[1.05] tracking-tight text-ink sm:text-5xl lg:text-[56px]">
          Проекты
        </h1>
        <Link href="/onboarding/step-1" className={buttonClassName({ variant: 'secondary' })}>
          Новый проект
        </Link>
      </div>
      <ul className="mt-10 border-t border-line">
        {items.map((item, index) => {
          const thumbnail = thumbnails[index]
          return (
            <li key={item.id} className="border-b border-line">
              <Link
                href={`/projects/${item.id}`}
                className="group grid grid-cols-[64px_1fr] items-center gap-4 py-5 sm:grid-cols-[96px_1fr] sm:gap-6 sm:py-6"
              >
                <div className="grid aspect-[4/3] place-items-center overflow-hidden border border-line bg-muted text-[11px] uppercase tracking-[0.1em] text-ink-2">
                  {thumbnail && 'url' in thumbnail ? (
                    // biome-ignore lint/performance/noImgElement: подписанная ссылка живёт 15 минут, оптимизатор next/image здесь не нужен
                    <img src={thumbnail.url} alt="" className="size-full object-cover" />
                  ) : thumbnail ? (
                    <span>PDF</span>
                  ) : (
                    <span className="border border-dashed border-line-strong px-2 py-1 font-normal normal-case tracking-normal">
                      без плана
                    </span>
                  )}
                </div>
                <div className="min-w-0">
                  <h2 className="font-serif text-2xl leading-tight text-ink decoration-accent decoration-1 underline-offset-[6px] group-hover:underline sm:text-[28px]">
                    {item.title}
                  </h2>
                  <p className="mt-1.5 font-mono text-[13px] text-ink-2">
                    {projectMeta({
                      houseSeries: item.houseSeries,
                      totalAreaM2: item.totalAreaM2,
                      roomCount: item.roomCount,
                      updatedAt: item.updatedAt,
                    })}
                  </p>
                </div>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
