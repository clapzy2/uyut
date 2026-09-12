'use client'

import type { Estimate, WorksRates } from '@uyut/catalog'
import type { RoomCondition } from '@uyut/db'
import { Checkbox, cn, toast } from '@uyut/ui'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { setRoomRefreshFinish } from '@/actions/shopping'
import { BudgetBar } from '@/components/summary/budget-bar'
import { formatPrice } from '@/lib/concepts/format'
import { formatArea } from '@/lib/projects/format'

export type EstimateRoomRow = {
  id: string
  name: string
  areaM2: number | null
  condition: RoomCondition
  refreshFinish: boolean
}

const areaFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })
const rubles = new Intl.NumberFormat('ru-RU')

function Line({
  label,
  hint,
  value,
  muted,
}: {
  label: string
  hint?: string | null
  value: string
  muted?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <span className="min-w-0">
        <span className={cn('block text-[15px]', muted ? 'text-ink-2' : 'text-ink')}>{label}</span>
        {hint ? <span className="block font-mono text-[12px] text-ink-2">{hint}</span> : null}
      </span>
      <span className={cn('shrink-0 font-mono text-[14px]', muted ? 'text-ink-2' : 'text-ink')}>
        {value}
      </span>
    </div>
  )
}

function RoomWorksRow({
  room,
  works,
  readOnly,
}: {
  room: EstimateRoomRow
  works: Estimate['works']['rooms'][number]
  readOnly: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const kindLabel =
    works.kind === 'full'
      ? 'черновые и чистовые'
      : works.kind === 'finish'
        ? 'только чистовые'
        : works.kind === 'none'
          ? 'без работ'
          : 'площадь не указана'

  function toggle(value: boolean) {
    setBusy(true)
    void setRoomRefreshFinish(room.id, value).then((result) => {
      setBusy(false)
      if (!result.ok) {
        toast({ title: result.error, tone: 'danger' })
        return
      }
      router.refresh()
    })
  }

  return (
    <li className="motion-list-row flex flex-col gap-1.5 py-2.5">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-[15px] text-ink">
          {room.name}
          <span className="ml-2 font-mono text-[12px] text-ink-2">
            {formatArea(room.areaM2) ?? '— м²'} · {kindLabel}
          </span>
        </span>
        <span className="shrink-0 font-mono text-[14px] text-ink">
          {formatPrice(works.totalKopecks)}
        </span>
      </div>
      {room.condition !== 'bare' && readOnly ? (
        <span className="text-[13px] text-ink-2">
          {room.refreshFinish ? 'с обновлением чистовой отделки' : 'без обновления отделки'}
        </span>
      ) : room.condition !== 'bare' ? (
        <Checkbox
          id={`refresh-${room.id}`}
          label={<span className="text-[13px] text-ink-2">Обновить чистовую отделку</span>}
          checked={room.refreshFinish}
          disabled={busy}
          onChange={(event) => toggle(event.currentTarget.checked)}
        />
      ) : null}
    </li>
  )
}

export function EstimateCard({
  estimate,
  rooms,
  rates,
  projectId,
  readOnly = false,
}: {
  estimate: Estimate
  rooms: EstimateRoomRow[]
  rates: WorksRates
  projectId: string
  readOnly?: boolean
}) {
  const remaining = estimate.remainingKopecks
  const freeLabel =
    remaining === null
      ? 'бюджет не указан'
      : remaining < 0
        ? `перерасход ${formatPrice(-remaining)}`
        : `запас ${formatPrice(remaining)}`
  const bareArea = estimate.works.rooms
    .filter((room) => room.kind === 'full')
    .reduce((sum, room) => sum + (room.areaM2 ?? 0), 0)
  const finishArea = estimate.works.rooms
    .filter((room) => room.kind === 'full' || room.kind === 'finish')
    .reduce((sum, room) => sum + (room.areaM2 ?? 0), 0)

  return (
    <div className="flex flex-col gap-6">
      <section
        className="motion-section border border-line bg-paper p-5 sm:p-6"
        aria-labelledby="estimate-title"
      >
        <p
          id="estimate-title"
          className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-2"
        >
          Смета
        </p>
        <div className="mt-3 divide-y divide-line">
          <Line
            label="Мебель и декор"
            hint="по списку покупок"
            value={formatPrice(estimate.furnitureKopecks)}
          />
          <Line
            label="Работы, черновые"
            hint={
              bareArea > 0
                ? `${areaFormat.format(bareArea)} м² × ${rubles.format(rates.roughRubPerM2)} ₽`
                : null
            }
            value={formatPrice(estimate.works.roughKopecks)}
            muted={estimate.works.roughKopecks === 0}
          />
          <Line
            label="Работы, чистовые"
            hint={
              finishArea > 0
                ? `${areaFormat.format(finishArea)} м² × ${rubles.format(rates.finishRubPerM2)} ₽`
                : null
            }
            value={formatPrice(estimate.works.finishKopecks)}
            muted={estimate.works.finishKopecks === 0}
          />
        </div>
        <div className="mt-2 flex items-baseline justify-between gap-4 border-t border-ink pt-3">
          <span className="text-[15px] text-ink">Итого</span>
          <span className="font-serif text-[30px] leading-none tracking-tight text-ink transition-colors duration-300">
            {formatPrice(estimate.totalKopecks)}
          </span>
        </div>
        <BudgetBar
          className="mt-5"
          shares={estimate.shares}
          freeLabel={freeLabel}
          overBudget={estimate.overBudget}
        />
        {estimate.budgetKopecks !== null ? (
          <p className="mt-2 font-mono text-[12px] text-ink-2">
            Бюджет проекта {formatPrice(estimate.budgetKopecks)}
          </p>
        ) : null}
      </section>

      <section className="motion-section" aria-labelledby="works-title">
        <p
          id="works-title"
          className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-2"
        >
          Работы по комнатам
        </p>
        {rooms.length === 0 ? (
          <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
            Комнат пока нет, работы считать нечего.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-line border-y border-line">
            {rooms.map((room) => {
              const works = estimate.works.rooms.find((entry) => entry.id === room.id)
              return works ? (
                <RoomWorksRow key={room.id} room={room} works={works} readOnly={readOnly} />
              ) : null
            })}
          </ul>
        )}
        {estimate.works.roomsWithoutArea.length > 0 ? (
          <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
            Без площади работы не посчитать: {estimate.works.roomsWithoutArea.join(', ')}. Укажите
            метры в настройках комнаты{' '}
            <Link
              href={`/projects/${projectId}`}
              className="text-accent underline decoration-accent/40 underline-offset-4"
            >
              на странице проекта
            </Link>
            .
          </p>
        ) : null}
        <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
          Ориентир по средним ставкам: {rubles.format(rates.roughRubPerM2)} ₽/м² черновые и{' '}
          {rubles.format(rates.finishRubPerM2)} ₽/м² чистовые. Это примерная стоимость работ,
          уточняйте у мастеров. Материалы для отделки сюда не входят.
        </p>
      </section>
    </div>
  )
}
