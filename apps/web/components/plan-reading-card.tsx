'use client'

import type { PlanReading, RoomKind } from '@uyut/db'
import { Button, chipClassName, Input, inputClassName, toast } from '@uyut/ui'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { confirmPlanRooms, forgetPlanReading, readPlan } from '@/actions/projects'
import { FormError } from '@/components/form-error'
import {
  mvpRoomKinds,
  roomConditionHints,
  roomConditionLabels,
  roomKindLabels,
} from '@/lib/projects/format'
import {
  areaCheck,
  type ExistingRoom,
  type PlanRow,
  planRows,
  totalAreaCheck,
} from '@/lib/projects/plan-rows'

const numberFieldClassName = `${inputClassName} h-10 text-[14px]`

const fixButtonClassName =
  'inline-flex h-8 items-center rounded-full border border-control px-3 text-[13px] text-ink-2 transition-[color,border-color,transform] duration-200 ease-ui hover:border-ink hover:text-ink active:scale-[0.98]'

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
 * Площадь, посчитанная по сторонам, когда она расходится с подписанной на плане.
 *
 * Это не ошибка сама по себе: комната бывает не прямоугольной, а подписанная площадь считается
 * без ниш. Но именно здесь видно промах чтения, который иначе не заметить: на проверке модель
 * прочла ширину гостиной как 393 вместо 383, и разошлось это ровно в площади.
 */
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
  existing,
}: {
  projectId: string
  reading: PlanReading | null
  hasPlan: boolean
  planIsPdf: boolean
  roomCount: number
  existing: ExistingRoom[]
}) {
  const router = useRouter()
  // Подтверждённое чтение таблицу больше не открывает: числа уже в комнатах, и второй экран
  // правки поверх них только путает. Перечитать план можно кнопкой.
  const [rows, setRows] = useState<PlanRow[] | null>(
    reading && !reading.confirmedAt ? planRows(reading, existing) : null,
  )
  const [ceiling, setCeiling] = useState(
    reading?.ceilingCm && !reading.confirmedAt ? String(reading.ceilingCm) : '',
  )
  const [error, setError] = useState<string | undefined>(undefined)
  // Состояние квартиры решает, войдёт ли в смету ремонт. Спрашиваем один раз на все комнаты:
  // по плану их пять, и пять одинаковых ответов подряд человек давать не станет
  const [condition, setCondition] = useState<'bare' | 'finished'>('bare')
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
      setRows(planRows(result.data, existing))
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
      condition,
      rooms: rows.map((row) => ({
        include: row.include,
        roomId: row.roomId ?? '',
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
    const { created, updated } = result.data
    toast({
      title: [
        created > 0 ? `новых комнат: ${created}` : null,
        updated > 0 ? `размеры вписаны в ${updated}` : null,
      ]
        .filter(Boolean)
        .join(', '),
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
            План в PDF: посмотрим первые три страницы, план обычно на первой.
          </p>
        ) : null}
        <div className="mt-4">
          <Button type="button" variant="secondary" onClick={read} pending={reading_}>
            {reading_ ? 'Читаем план…' : 'Прочитать размеры с плана'}
          </Button>
        </div>
        <FormError message={error} />
      </div>
    )
  }

  const chosen = rows.filter((row) => row.include).length
  // Ни у одной комнаты не прочитались обе стороны: план без размерных линий
  const noSides = rows.every((row) => row.width === '' || row.depth === '')
  // Сумма площадей против общей площади с плана: единственное, что ловит потерянную и выдуманную комнату
  const total = totalAreaCheck(rows, reading?.totalAreaM2)

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

      {noSides ? (
        <p className="mt-3 text-[14px] leading-relaxed text-ink-2">
          Размерных линий на этом плане нет, поэтому стены мы не прочитали: взяли только названия и
          площади. Так печатают рекламные планировки застройщика. Стороны комнат можно вписать
          руками здесь или позже, в самой комнате.
        </p>
      ) : null}

      {total && !total.agrees ? (
        <p className="mt-3 border-l-2 border-danger/50 pl-3 text-[14px] leading-relaxed text-ink-2">
          Комнаты в сумме дают {total.sum} м², а общая площадь на плане {total.total} м². Значит,
          одну комнату мы потеряли, лишнюю придумали или ошиблись в площади. Сверьте список с
          чертежом, прежде чем сохранять.
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap items-end gap-6">
        <div className="max-w-[10rem]">
          <Input
            id="plan-ceiling"
            label="Высота потолка, см"
            inputMode="numeric"
            value={ceiling}
            onChange={(event) => setCeiling(event.currentTarget.value)}
          />
        </div>
        <fieldset className="m-0 border-0 p-0">
          <legend className="mb-2 block text-xs font-medium uppercase tracking-[0.1em] text-ink-2">
            Что делаем с квартирой
          </legend>
          <div className="flex flex-wrap gap-2">
            {(['bare', 'finished'] as const).map((value) => (
              <label key={value} className="cursor-pointer">
                <input
                  type="radio"
                  name="plan-condition"
                  value={value}
                  checked={condition === value}
                  onChange={() => setCondition(value)}
                  className="peer sr-only"
                />
                <span className={chipClassName}>{roomConditionLabels[value]}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
        {roomConditionHints[condition]} Поставим это новым комнатам. У тех, что уже заведены,
        состояние не трогаем: вы могли выбрать его сами.
      </p>

      <ul className="mt-5 flex flex-col gap-3">
        {rows.map((row, index) => {
          const check = areaCheck(row)
          return (
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
                  onChange={(event) =>
                    patch(index, { kind: event.currentTarget.value as RoomKind })
                  }
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

              {row.ambiguous ? (
                <p className="mt-2 pl-[30px] text-[13px] leading-relaxed text-ink-2">
                  В проекте несколько похожих комнат, и какая из них эта, знаете только вы. Заведём
                  новую. Если это одна из уже заведённых, назовите строку точно так же, как названа
                  она, и прочитайте план ещё раз.
                </p>
              ) : null}
              {row.roomId ? (
                <p className="mt-2 pl-[30px] text-[13px] leading-relaxed text-ink-2">
                  Числа впишем в комнату «{row.roomName}», которая уже есть в проекте. Новой такой
                  же не появится.
                </p>
              ) : null}
              {row.unsupported ? (
                <p className="mt-3 pl-[30px] text-[13px] leading-relaxed text-ink-2">
                  {row.unsupportedReason === 'utility'
                    ? 'Прихожие, коридоры и кладовые мы не обставляем: мебель туда покупают редко, а размеры с плана сохранились.'
                    : 'Ванные сервис пока не делает: сантехники в каталоге нет, и подбирать там будет нечего. Размеры сохранились в плане.'}
                </p>
              ) : null}
              {row.rechecked ? (
                <p className="mt-2 pl-[30px] text-[13px] leading-relaxed text-ink-2">
                  {row.rechecked === 'both' ? 'Обе стороны' : 'Одну сторону'} мы перечитали по
                  отрезкам размерной цепочки: с первого раза площадь не сходилась, теперь сходится.
                </p>
              ) : null}
              {row.chainMismatch ? (
                <p className="mt-2 pl-[30px] text-[13px] leading-relaxed text-danger">
                  {row.chainMismatch === 'both' ? 'Обе стороны' : 'Одна сторона'} в размерной
                  цепочке при повторном чтении получилась другой. Площади на плане нет, поэтому мы
                  не выбирали число за вас — сверьте эту строку с чертежом или рулеткой.
                </p>
              ) : null}
              {row.estimated ? (
                <p className="mt-2 pl-[30px] text-[13px] leading-relaxed text-ink-2">
                  {row.estimated === 'both'
                    ? 'Стороны посчитаны из подписанной площади: размерных линий у этой комнаты на плане не нашлось. Это прикидка, промерьте рулеткой, когда будете на месте.'
                    : `${row.estimated === 'width' ? 'Ширина посчитана' : 'Глубина посчитана'} из подписанной площади и второй стороны. Площадь сходится точно, но если неверна вторая сторона, неверна и эта.`}
                </p>
              ) : null}
              {check ? (
                <div className="mt-2 pl-[30px]">
                  <p className="text-[13px] leading-relaxed text-ink-2">
                    {check.text} Одно из трёх чисел прочитано неверно. Площади на плане верить
                    можно: её печатают, а не складывают из отрезков.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => patch(index, { width: String(check.widthCm) })}
                      className={fixButtonClassName}
                    >
                      Ширина {check.widthCm} см
                    </button>
                    <button
                      type="button"
                      onClick={() => patch(index, { depth: String(check.depthCm) })}
                      className={fixButtonClassName}
                    >
                      Глубина {check.depthCm} см
                    </button>
                  </div>
                </div>
              ) : null}
              {row.suspicious && !row.chainMismatch ? (
                <p className="mt-3 pl-[30px] text-[13px] leading-relaxed text-danger">
                  Площадь не сходится с размерами. Одно из трёх чисел мы прочитали неверно.
                </p>
              ) : null}
            </li>
          )
        })}
      </ul>

      <FormError message={error} />

      <div className="mt-5 flex flex-wrap gap-3">
        <Button type="button" onClick={confirm} pending={saving} disabled={chosen === 0}>
          {saving ? 'Сохраняем…' : `Сохранить: ${chosen}`}
        </Button>
        <Button type="button" variant="ghost" onClick={forget}>
          Впишу сам
        </Button>
      </div>
    </div>
  )
}
