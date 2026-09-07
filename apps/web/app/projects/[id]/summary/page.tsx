import { estimateProject } from '@uyut/catalog'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ChatDrawer } from '@/components/chat/chat-drawer'
import { EstimateCard } from '@/components/summary/estimate-card'
import { ExportCard, type PaymentState } from '@/components/summary/export-card'
import { PartnerExports } from '@/components/summary/partner-exports'
import { ShoppingRows } from '@/components/summary/shopping-rows'
import { applyPayment } from '@/lib/billing/apply'
import { getPlan, getPurchase } from '@/lib/billing/repository'
import { formatPrice } from '@/lib/concepts/format'
import { getEnv } from '@/lib/env'
import { listExports } from '@/lib/exports/repository'
import type { ExportRun } from '@/lib/exports/start'
import { isUuid, NotFoundError, ProjectClosedError } from '@/lib/projects/access'
import { formatArea, pluralRooms } from '@/lib/projects/format'
import { getProject } from '@/lib/projects/repository'
import { getSession } from '@/lib/session'
import { pluralItems, pluralPositions } from '@/lib/shopping/format'
import { getWorksRates } from '@/lib/shopping/rates'
import { getShoppingList } from '@/lib/shopping/repository'

type Params = Promise<{ id: string }>
type Search = Promise<{ payment?: string }>

/** Возврат с оплаты: перепроверяем платёж у провайдера и показываем результат */
async function settlePayment(
  userId: string,
  purchaseId: string | undefined,
): Promise<{ state: PaymentState; run: ExportRun | null }> {
  if (!purchaseId || !isUuid(purchaseId)) {
    return { state: null, run: null }
  }
  try {
    const purchase = await getPurchase(userId, purchaseId)
    if (purchase.status === 'paid') {
      return { state: 'paid', run: null }
    }
    if (!purchase.yukassaPaymentId) {
      return { state: 'pending', run: null }
    }
    const applied = await applyPayment(purchase.yukassaPaymentId)
    if (applied.status === 'succeeded') {
      return { state: 'paid', run: applied.exportRun ?? null }
    }
    return { state: applied.status === 'canceled' ? 'canceled' : 'pending', run: null }
  } catch (error) {
    if (error instanceof NotFoundError) {
      return { state: null, run: null }
    }
    throw error
  }
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const session = await getSession()
  const { id } = await params
  if (!session) {
    return { title: 'Итоги проекта' }
  }
  try {
    const project = await getProject(session.user.id, id)
    return { title: `Итоги · ${project.title}` }
  } catch {
    return { title: 'Итоги проекта' }
  }
}

export default async function SummaryPage({
  params,
  searchParams,
}: {
  params: Params
  searchParams: Search
}) {
  const session = await getSession()
  const { id } = await params
  if (!session) {
    redirect(`/login?next=/projects/${id}/summary`)
  }
  const { payment } = await searchParams
  // Сначала платёж, потом проект: после успешной оплаты у проекта уже стоит isPaid
  const settled = await settlePayment(session.user.id, payment)

  let project: Awaited<ReturnType<typeof getProject>>
  try {
    project = await getProject(session.user.id, id)
  } catch (error) {
    if (error instanceof ProjectClosedError) {
      redirect(`/projects/${id}`)
    }
    if (error instanceof NotFoundError) {
      notFound()
    }
    throw error
  }
  const isOwner = project.role === 'owner'

  const [list, exports, plan] = await Promise.all([
    getShoppingList(session.user.id, project.id),
    listExports(session.user.id, project.id, 4),
    getPlan(session.user.id),
  ])
  const rates = getWorksRates()
  const env = getEnv()
  const rooms = project.rooms.map((room) => ({
    id: room.id,
    name: room.name,
    areaM2: room.areaM2,
    condition: room.condition,
    refreshFinish: room.refreshFinish,
  }))
  const estimate = estimateProject({
    rooms,
    items: list.items.map((item) => ({
      priceKopecks: item.priceKopecks,
      quantity: item.quantity,
      variantPriceKopecks: item.variant?.priceKopecks ?? null,
    })),
    budgetKopecks: project.budgetKopecks,
    rates,
  })
  const area = project.totalAreaM2 ?? (estimate.works.areaM2 > 0 ? estimate.works.areaM2 : null)
  const meta = [
    pluralRooms(project.rooms.length),
    formatArea(area),
    project.budgetKopecks ? `бюджет ${formatPrice(project.budgetKopecks)}` : 'бюджет не указан',
  ].filter((part): part is string => Boolean(part))

  return (
    <section className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-14 lg:py-16">
      <nav className="text-sm text-ink-2">
        <Link
          href={`/projects/${project.id}`}
          className="inline-block py-1.5 underline decoration-line-strong decoration-1 underline-offset-4 hover:text-ink"
        >
          {project.title}
        </Link>
      </nav>
      <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-serif text-[40px] font-normal leading-[1.05] tracking-tight text-ink sm:text-5xl lg:text-[56px]">
          Итоги проекта
        </h1>
        <p className="font-mono text-[13px] text-ink-2">{meta.join(' · ')}</p>
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-14">
        <div>
          <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-2">
            Список покупок
            {list.count > 0
              ? ` · ${pluralPositions(list.items.length)} · ${pluralItems(list.count)}`
              : ''}
          </p>
          <ShoppingRows items={list.items} projectId={project.id} readOnly={!isOwner} />
        </div>
        <aside className="flex flex-col gap-8">
          {isOwner ? (
            <ExportCard
              projectId={project.id}
              exports={exports}
              contact={project.contact ?? null}
              isPaid={project.isPaid}
              plan={plan}
              hasRooms={project.rooms.length > 0}
              projectPriceKopecks={env.PROJECT_PRICE_KOPECKS}
              proPriceKopecks={env.PRO_PRICE_KOPECKS}
              paymentState={settled.state}
              initialRun={settled.run}
            />
          ) : (
            <PartnerExports exports={exports} />
          )}
          <EstimateCard
            estimate={estimate}
            rooms={rooms}
            rates={rates}
            projectId={project.id}
            readOnly={!isOwner}
          />
        </aside>
      </div>
      <ChatDrawer projectId={project.id} canRun={isOwner} />
    </section>
  )
}
