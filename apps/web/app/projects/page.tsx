import { buttonClassName } from '@uyut/ui'
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ProRenewal, ProUpsell } from '@/components/billing/pro-upsell'
import { applyPayment } from '@/lib/billing/apply'
import { activeProSubscription, getPurchase } from '@/lib/billing/repository'
import { getEnv } from '@/lib/env'
import { isUuid, NotFoundError } from '@/lib/projects/access'
import { formatDate, projectMeta } from '@/lib/projects/format'
import { listProjects } from '@/lib/projects/repository'
import { getSession } from '@/lib/session'
import { presignedObjectUrl } from '@/lib/storage'

export const metadata: Metadata = { title: 'Проекты' }

type Search = Promise<{ payment?: string; renew?: string }>

const RENEW_WINDOW_MS = 3 * 24 * 60 * 60 * 1000

/** Возврат с оплаты Pro: перепроверяем платёж, чтобы подписка включилась даже без webhook */
async function settleProPayment(userId: string, purchaseId: string | undefined): Promise<void> {
  if (!purchaseId || !isUuid(purchaseId)) {
    return
  }
  try {
    const purchase = await getPurchase(userId, purchaseId)
    if (purchase.status === 'pending' && purchase.yukassaPaymentId) {
      await applyPayment(purchase.yukassaPaymentId)
    }
  } catch (error) {
    if (!(error instanceof NotFoundError)) {
      throw error
    }
  }
}

async function planThumbnail(key: string | null): Promise<{ url: string } | { pdf: true } | null> {
  if (!key) {
    return null
  }
  if (key.endsWith('.pdf')) {
    return { pdf: true }
  }
  return { url: await presignedObjectUrl(key) }
}

export default async function ProjectsPage({ searchParams }: { searchParams: Search }) {
  const session = await getSession()
  if (!session) {
    redirect('/login?next=/projects')
  }
  const { payment, renew } = await searchParams
  await settleProPayment(session.user.id, payment)
  const [items, pro] = await Promise.all([
    listProjects(session.user.id),
    activeProSubscription(session.user.id),
  ])
  const canAddProject = pro !== null || items.length === 0
  const endsSoon =
    pro?.currentPeriodEnd !== undefined &&
    pro?.currentPeriodEnd !== null &&
    pro.currentPeriodEnd.getTime() - Date.now() < RENEW_WINDOW_MS
  const offerRenewal = pro !== null && (renew === 'pro' || endsSoon)

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
        <div>
          <h1 className="font-serif text-[40px] font-normal leading-[1.05] tracking-tight text-ink sm:text-5xl lg:text-[56px]">
            Проекты
          </h1>
          {pro?.currentPeriodEnd ? (
            <p className="mt-2 font-mono text-[13px] text-ink-2">
              Pro до {formatDate(pro.currentPeriodEnd)}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {offerRenewal ? (
            <ProRenewal priceKopecks={getEnv().PRO_PRICE_KOPECKS} returnPath="/projects" />
          ) : null}
          {canAddProject ? (
            <Link href="/onboarding/step-1" className={buttonClassName({ variant: 'secondary' })}>
              Новый проект
            </Link>
          ) : (
            <ProUpsell priceKopecks={getEnv().PRO_PRICE_KOPECKS} returnPath="/projects" />
          )}
        </div>
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
