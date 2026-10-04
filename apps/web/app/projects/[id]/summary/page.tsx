import { estimateProject } from '@uyut/catalog'
import { conceptObjects, concepts, rooms as dbRooms } from '@uyut/db'
import { and, desc, eq, inArray } from 'drizzle-orm'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ChatDrawer } from '@/components/chat/chat-drawer'
import { PlanVolumeLaunch } from '@/components/plan-volume-launch'
import { EstimateCard } from '@/components/summary/estimate-card'
import { ExportCard, type PaymentState } from '@/components/summary/export-card'
import { ExportComposition, exportRoomComposition } from '@/components/summary/export-composition'
import { FitWarnings } from '@/components/summary/fit-warnings'
import { PartnerExports } from '@/components/summary/partner-exports'
import { ShoppingRows } from '@/components/summary/shopping-rows'
import { applyPayment } from '@/lib/billing/apply'
import { getPlan, getPurchase } from '@/lib/billing/repository'
import { formatPrice } from '@/lib/concepts/format'
import { getDb } from '@/lib/db'
import { getEnv } from '@/lib/env'
import { listExports } from '@/lib/exports/repository'
import type { ExportRun } from '@/lib/exports/start'
import { isUuid, NotFoundError, ProjectClosedError } from '@/lib/projects/access'
import { apartmentVolume } from '@/lib/projects/apartment-volume'
import { formatArea, pluralRooms } from '@/lib/projects/format'
import { layoutWithMeasurements } from '@/lib/projects/layout-with-measurements'
import { getProject } from '@/lib/projects/repository'
import { getSession } from '@/lib/session'
import { pluralItems, pluralPositions } from '@/lib/shopping/format'
import { projectLayoutGaps, projectLayouts } from '@/lib/shopping/layout'
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

  const [list, exports, plan, readyConcepts] = await Promise.all([
    getShoppingList(session.user.id, project.id),
    listExports(session.user.id, project.id, 4),
    getPlan(session.user.id),
    project.rooms.length > 0
      ? getDb()
          .select({
            id: concepts.id,
            roomId: concepts.roomId,
            status: concepts.status,
            likedByOwner: concepts.likedByOwner,
            createdAt: concepts.createdAt,
            renderUrl: concepts.renderUrl,
            editedRenderUrl: concepts.editedRenderUrl,
          })
          .from(concepts)
          .innerJoin(dbRooms, eq(dbRooms.id, concepts.roomId))
          .where(and(eq(dbRooms.projectId, project.id), eq(concepts.status, 'ready')))
          .orderBy(desc(concepts.createdAt))
      : [],
  ])
  const selectedObjectIds = list.items
    .map((item) => item.conceptObjectId)
    .filter((objectId): objectId is string => objectId !== null)
  const selectedObjectConcepts = selectedObjectIds.length
    ? await getDb()
        .select({ id: conceptObjects.id, conceptId: conceptObjects.conceptId })
        .from(conceptObjects)
        .where(inArray(conceptObjects.id, selectedObjectIds))
    : []
  const layouts = projectLayouts(project.rooms, list, project.planReading?.geometry)
  const layoutGaps = projectLayoutGaps(project.rooms, list, layouts)
  const geometry = project.planReading?.geometry
  const compositionRooms = project.rooms.map((room) =>
    exportRoomComposition(
      room,
      readyConcepts,
      selectedObjectConcepts,
      list.items,
      layouts.find((entry) => entry.roomId === room.id)?.layout ??
        // Unlike the shopping preview, PDF includes a measured 2D room even without furniture.
        layoutWithMeasurements(room.name, room.measurements, geometry, [], room.kind),
    ),
  )
  const composition = (
    <ExportComposition projectId={project.id} rooms={compositionRooms} items={list.items} />
  )
  const overview = geometry ? apartmentVolume(geometry, layouts) : null
  const rates = getWorksRates()
  const env = getEnv()
  const rooms = project.rooms.map((room) => ({
    id: room.id,
    name: room.name,
    spaceKind: room.spaceKind,
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

      <div className="mt-6 max-w-3xl border-l-2 border-accent pl-4 text-[15px] leading-relaxed text-ink-2">
        {list.count === 0 ? (
          <>
            <p>
              {isOwner
                ? 'Здесь соберутся выбранные товары, расстановка и PDF. Чтобы добавить мебель, откройте вариант комнаты и нажмите на метку предмета.'
                : 'Здесь появятся товары, которые выберет владелец, расстановка и PDF. Пока можно посмотреть комнаты и отметить понравившиеся интерьеры.'}
            </p>
            <Link
              href={`/projects/${project.id}#project-rooms`}
              className="mt-1 inline-flex min-h-11 items-center text-accent underline decoration-line-strong underline-offset-4"
            >
              {isOwner ? 'Выбрать мебель в комнатах →' : 'Посмотреть комнаты →'}
            </Link>
          </>
        ) : (
          <p>
            Сверьте варианты товаров и мерки, проверьте предупреждения о размещении, затем соберите
            PDF. Смета работ — ориентир для обсуждения с мастерами; мебель покупается отдельно в
            магазинах.
          </p>
        )}
      </div>

      <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-14">
        <div className="min-w-0">
          <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-2">
            Список покупок
            {list.count > 0
              ? ` · ${pluralPositions(list.items.length)} · ${pluralItems(list.count)}`
              : ''}
          </p>
          <ShoppingRows
            items={list.items}
            projectId={project.id}
            geometryRoomIds={layouts
              .filter((room) => room.layout.reservationSource === 'geometry')
              .map((room) => room.roomId)}
            readOnly={!isOwner}
          />
          <FitWarnings rooms={layouts} projectId={project.id} canEdit={isOwner} />
        </div>
        <aside className="flex min-w-0 flex-col gap-8">
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
            >
              {composition}
            </ExportCard>
          ) : (
            <PartnerExports exports={exports}>{composition}</PartnerExports>
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
      {overview?.model ? (
        <section className="mt-10 border-t border-line pt-6" aria-labelledby="apartment-overview">
          <h2 id="apartment-overview" className="font-serif text-2xl text-ink">
            Расстановка в квартире
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-2">
            Общий обзор по подтверждённой схеме. Положения мебели совпадают с планами комнат; оценку
            проходов и недостающие мерки смотрите в проверках 2D.
          </p>
          {layoutGaps.length > 0 ? (
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-ink-2">
              {layoutGaps.map((room) => (
                <li key={room.roomId}>
                  {room.roomName}: {pluralItems(room.itemCount)} пока только в списке покупок — для
                  расстановки нужны мерки комнаты или связанный контур.{' '}
                  <Link
                    href={`/projects/${project.id}/rooms/${room.roomId}#room-measurements`}
                    className="inline-flex min-h-11 items-center text-accent underline decoration-line-strong underline-offset-4"
                  >
                    {isOwner ? 'Добавить мерки комнаты →' : 'Посмотреть мерки комнаты →'}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          {overview.notes.length > 0 ? (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-2">
              {[...new Set(overview.notes)].map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
          <PlanVolumeLaunch model={overview.model} projectId={project.id} />
        </section>
      ) : null}
      <ChatDrawer projectId={project.id} canRun={isOwner} />
    </section>
  )
}
