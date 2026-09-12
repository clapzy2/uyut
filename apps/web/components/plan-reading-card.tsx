'use client'

import type { PlanReading, RoomKind } from '@uyut/db'
import { Button, Input, inputClassName, toast } from '@uyut/ui'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { confirmPlanRooms, forgetPlanReading, readPlan } from '@/actions/projects'
import { FormError } from '@/components/form-error'
import { mvpRoomKinds, roomKindLabels } from '@/lib/projects/format'
import { type PlanRow, planRows } from '@/lib/projects/plan-rows'

const numberFieldClassName = `${inputClassName} h-10 text-[14px]`

/**
 * Подсказка в поле желания. Разная по типам комнат: «побольше света» в санузле и в спальне
 * значит разное, а пустое поле человек чаще всего пролистывает.
 */
const WISH_PLACEHOLDERS: Record<RoomKind, string> = {
  living: 'диван на троих, место под телевизор',
  bedroom: 'шкаф во всю стену, кровать не у окна',
  kitchen: 'обеденный стол на четверых, побольше ящиков',
  bath: 'душ вместо ванны',
  kid: 'стол для уроков, низкие полки',
}

function wishPlaceholder(kind: RoomKind): string {
  return WISH_PLACEHOLDERS[kind]
}

/**
 * Прочитанный план перед глазами человека.
 *
 * Между чтением и комнатами намеренно стоит правка. Модель читает чертежи хорошо, но ошибка
 * в размере тихо испортит всё, что из него растёт: и расстановку, и ответ «влезет ли шкаф»,
 * и смету. Заметить её можно только здесь, пока числа ещё видно рядом с планом.
 */
export function PlanReadingCard({
  projectId,
  reading,
  hasPlan,
  planIsPdf,
  roomCount,
}: {
  projectId: string
  reading: PlanReading | null
  hasPlan: boolean
  planIsPdf: boolean
  roomCount: number
}) {
  const router = useRouter()
  const [rows, setRows] = useState<PlanRow[] | null>(reading ? planRows(reading) : null)
  const [ceiling, setCeiling] = useState(reading?.ceilingCm ? String(reading.ceilingCm) : '')
  const [error, setError] = useState<string | undefined>(undefined)
  const [reading_, startReading] = useTransition()
  const [saving, setSaving] = useState(false)

  const confirmed = Boolean(reading?.confirmedAt)

  function patch(index: number, next: Partial<PlanRow>) {
    setRows((list) => (list ?? []).map((row, at) => (at === index ? { ...row, ...next } : row)))
  }

  function read() {
    setError(undefined)
    startReading(async () => {
      const result = await readPlan(projectId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setRows(planRows(result.data))
      setCeiling(result.data.ceilingCm ? String(result.data.ceilingCm) : '')
      toast({ title: 'План прочитан', tone: 'success' })
    })
  }

  async function forget() {
    setRows(null)
    await forgetPlanReading(projectId)
    router.refresh()
  }

  async function confirm() {
    if (!rows) {
      return
    }
    setError(undefined)
    setSaving(true)
    const result = await confirmPlanRooms(projectId, {
      ceilingCm: ceiling,
      rooms: rows.map((row) => ({
        include: row.include,
        name: row.name,
        kind: row.kind,
        widthCm: row.width,
        depthCm: row.depth,
        areaM2: row.area,
        wish: row.wish,
      })),
    })
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setRows(null)
    toast({
      title:
        result.data.created === 1 ? 'Комната создана' : `Комнат создано: ${result.data.created}`,
      tone: 'success',
    })
    router.refresh()
  }

  if (!hasPlan) {
    return null
  }

  if (!rows) {
    return (
      <div className="mt-6 border-t border-line pt-6">
        <p className="text-[15px] leading-relaxed text-ink-2">
          {confirmed
            ? 'Размеры с этого плана уже перенесены в комнаты. Прочитать заново можно в любой момент: комнаты добавятся к тем, что есть.'
            : 'Мы умеем читать размеры прямо с плана: комнаты, стены и высоту потолка. Вы всё увидите и поправите до того, как что-то появится в проекте.'}
        </p>
        {planIsPdf ? (
          <p className="mt-3 text-[14px] leading-relaxed text-ink-2">
            Этот план лежит в PDF, а читаем мы с картинки. Пришлите скриншот или фотографию плана.
          </p>
        ) : (
          <div className="mt-4">
            <Button type="button" variant="secondary" onClick={read} pending={reading_}>
              {reading_ ? 'Читаем план…' : 'Прочитать размеры с плана'}
            </Button>
          </div>
        )}
        <FormError message={error} />
      </div>
    )
  }

  const chosen = rows.filter((row) => row.include).length

  return (
    <div className="mt-6 animate-[rise-in_350ms_var(--ease-appear)] border-t border-line pt-6">
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-2">
        Мы прочитали так
      </p>
      <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
        Сверьте с планом и поправьте, что не сошлось. Напишите, чего хотите в каждой комнате: это
        уйдёт в задание, когда будем рисовать. Отмеченные строки станут комнатами проекта
        {roomCount > 0
          ? ` вдобавок к тем ${roomCount === 1 ? 'одной' : roomCount}, что уже есть`
          : ''}
        .
      </p>

      <div className="mt-5 max-w-[10rem]">
        <Input
          id="plan-ceiling"
          label="Высота потолка, см"
          inputMode="numeric"
          value={ceiling}
          onChange={(event) => setCeiling(event.currentTarget.value)}
        />
      </div>

      <ul className="mt-5 flex flex-col gap-3">
        {rows.map((row, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: строки различает только позиция на плане
          <li key={index} className="border border-line bg-paper p-4">
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="checkbox"
                id={`plan-room-${index}`}
                checked={row.include}
                disabled={row.unsupported}
                onChange={(event) => patch(index, { include: event.currentTarget.checked })}
                className="size-[18px] flex-none cursor-pointer appearance-none rounded-xs border border-control bg-paper transition-colors duration-200 ease-ui checked:border-accent checked:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
              />
              <input
                aria-label={`Название комнаты ${index + 1}`}
                value={row.name}
                onChange={(event) => patch(index, { name: event.currentTarget.value })}
                className={`${numberFieldClassName} min-w-[10rem] flex-1`}
              />
              <select
                aria-label={`Тип комнаты ${index + 1}`}
                value={row.kind}
                onChange={(event) => patch(index, { kind: event.currentTarget.value as RoomKind })}
                className={`${numberFieldClassName} w-[9rem]`}
              >
                {mvpRoomKinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {roomKindLabels[kind]}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-3 flex flex-wrap gap-3 pl-[30px]">
              <label className="text-[13px] text-ink-2">
                Ширина, см
                <input
                  inputMode="numeric"
                  value={row.width}
                  onChange={(event) => patch(index, { width: event.currentTarget.value })}
                  className={`${numberFieldClassName} mt-1 w-24`}
                />
              </label>
              <label className="text-[13px] text-ink-2">
                Глубина, см
                <input
                  inputMode="numeric"
                  value={row.depth}
                  onChange={(event) => patch(index, { depth: event.currentTarget.value })}
                  className={`${numberFieldClassName} mt-1 w-24`}
                />
              </label>
              <label className="text-[13px] text-ink-2">
                Площадь, м²
                <input
                  inputMode="decimal"
                  value={row.area}
                  onChange={(event) => patch(index, { area: event.currentTarget.value })}
                  className={`${numberFieldClassName} mt-1 w-24`}
                />
              </label>
            </div>

            {row.include ? (
              <label className="mt-3 block pl-[30px] text-[13px] text-ink-2">
                Чего хотите в этой комнате
                <input
                  value={row.wish}
                  placeholder={wishPlaceholder(row.kind)}
                  onChange={(event) => patch(index, { wish: event.currentTarget.value })}
                  className={`${numberFieldClassName} mt-1 w-full`}
                />
              </label>
            ) : null}

            {row.unsupported ? (
              <p className="mt-3 pl-[30px] text-[13px] leading-relaxed text-ink-2">
                Такие комнаты сервис пока не делает. Размеры сохранились в плане, комната появится,
                когда мы до неё дойдём.
              </p>
            ) : null}
            {row.suspicious ? (
              <p className="mt-3 pl-[30px] text-[13px] leading-relaxed text-danger">
                Площадь не сходится с размерами. Одно из трёх чисел мы прочитали неверно.
              </p>
            ) : null}
          </li>
        ))}
      </ul>

      <FormError message={error} />

      <div className="mt-5 flex flex-wrap gap-3">
        <Button type="button" onClick={confirm} pending={saving} disabled={chosen === 0}>
          {saving ? 'Создаём…' : chosen === 1 ? 'Создать комнату' : `Создать комнаты: ${chosen}`}
        </Button>
        <Button type="button" variant="ghost" onClick={forget}>
          Впишу сам
        </Button>
      </div>
    </div>
  )
}
