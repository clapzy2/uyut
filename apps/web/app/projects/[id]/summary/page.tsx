import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ChatDrawer } from '@/components/chat/chat-drawer'
import { EstimateCard } from '@/components/summary/estimate-card'
import { ShoppingRows } from '@/components/summary/shopping-rows'
import { formatPrice } from '@/lib/concepts/format'
import { estimateProject } from '@/lib/estimate'
import { NotFoundError } from '@/lib/projects/access'
import { formatArea, pluralRooms } from '@/lib/projects/format'
import { getProject } from '@/lib/projects/repository'
import { getSession } from '@/lib/session'
import { pluralItems, pluralPositions } from '@/lib/shopping/format'
import { getWorksRates } from '@/lib/shopping/rates'
import { getShoppingList } from '@/lib/shopping/repository'

type Params = Promise<{ id: string }>

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

export default async function SummaryPage({ params }: { params: Params }) {
  const session = await getSession()
  const { id } = await params
  if (!session) {
    redirect(`/login?next=/projects/${id}/summary`)
  }

  let project: Awaited<ReturnType<typeof getProject>>
  try {
    project = await getProject(session.user.id, id)
  } catch (error) {
    if (error instanceof NotFoundError) {
      notFound()
    }
    throw error
  }

  const [list, rates] = await Promise.all([
    getShoppingList(session.user.id, project.id),
    Promise.resolve(getWorksRates()),
  ])
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
          className="underline decoration-line-strong decoration-1 underline-offset-4 hover:text-ink"
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
          <ShoppingRows items={list.items} projectId={project.id} />
        </div>
        <aside>
          <EstimateCard estimate={estimate} rooms={rooms} rates={rates} projectId={project.id} />
        </aside>
      </div>
      <ChatDrawer projectId={project.id} />
    </section>
  )
}
