'use client'

import type { PlanReading, RoomKind } from '@uyut/db'
import {
  Button,
  buttonClassName,
  chipClassName,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
  Input,
  inputClassName,
  toast,
} from '@uyut/ui'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { confirmPlanRooms, forgetPlanReading, readPlan } from '@/actions/projects'
import { FormError } from '@/components/form-error'
import { RoomLayoutField } from '@/components/room-layout-field'
import {
  mvpRoomKinds,
  roomConditionHints,
  roomConditionLabels,
  roomKindLabels,
} from '@/lib/projects/format'
import {
  appendSourcePlanRow,
  areaCheck,
  type ExistingRoom,
  type PlanRow,
  planRows,
  totalAreaCheck,
} from '@/lib/projects/plan-rows'

const numberFieldClassName = `${inputClassName} h-10 text-[14px]`
const PlanPageContourEditor = dynamic(
  () => import('./plan-page-contour-editor').then((module) => module.PlanPageContourEditor),
  { loading: () => <p role="status">Открываем исходный лист…</p> },
)

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
  sourceRevision,
  reading,
  hasPlan,
  planIsPdf,
  roomCount,
  existing,
}: {
  projectId: string
  sourceRevision: string
  reading: PlanReading | null
  hasPlan: boolean
  planIsPdf: boolean
  roomCount: number
  existing: ExistingRoom[]
}) {
  const router = useRouter()
  // Saved rows reopen explicitly; editing the room list never requires another AI request.
  const [rows, setRows] = useState<PlanRow[] | null>(
    reading && !reading.confirmedAt ? planRows(reading, existing) : null,
  )
  const [ceiling, setCeiling] = useState(
    reading?.ceilingCm && !reading.confirmedAt ? String(reading.ceilingCm) : '',
  )
  const [error, setError] = useState<string | undefined>(undefined)
  const [activeReading, setActiveReading] = useState(reading)
  const [baseRevision, setBaseRevision] = useState(sourceRevision)
  const [conflict, setConflict] = useState(false)
  const [page, setPage] = useState(String(reading?.sourcePage ?? 1))
  // Состояние квартиры решает, войдёт ли в смету ремонт. Спрашиваем один раз на все комнаты:
  // по плану их пять, и пять одинаковых ответов подряд человек давать не станет
  const [condition, setCondition] = useState<'bare' | 'finished'>('bare')
  const [reading_, startReading] = useTransition()
  const [saving, setSaving] = useState(false)
  const [reviewEditing, setReviewEditing] = useState(false)
  const [forgetOpen, setForgetOpen] = useState(false)
  const [newSourceNumber, setNewSourceNumber] = useState('')
  const [newSourceKind, setNewSourceKind] = useState<RoomKind | 'utility' | ''>('')

  const confirmed = Boolean(reading?.confirmedAt)

  function patch(index: number, next: Partial<PlanRow>) {
    setRows((list) => (list ?? []).map((row, at) => (at === index ? { ...row, ...next } : row)))
  }

  function editSavedReading() {
    if (!reading) return
    setActiveReading(reading)
    setRows(planRows(reading, existing))
    setCeiling(reading.ceilingCm === undefined ? '' : String(reading.ceilingCm))
    setPage(String(reading.sourcePage ?? 1))
    setBaseRevision(sourceRevision)
    setError(undefined)
  }

  function addSourceRoom() {
    if (!rows || !newSourceKind) return
    const source = activeReading?.pageReview?.sourceRooms?.find(
      (room) => room.sourceNumber === Number(newSourceNumber),
    )
    if (!source) return
    const next = appendSourcePlanRow(rows, source, newSourceKind)
    if (!next) {
      setError('Проверьте номер и название помещения; за один раз сохраняем до 20 строк.')
      return
    }
    setRows(next)
    setNewSourceNumber('')
    setNewSourceKind('')
    setError(undefined)
  }

  function showFailure(result: { error: string; code?: 'plan-conflict' }) {
    setError(result.error)
    if (result.code === 'plan-conflict') {
      setConflict(true)
      router.refresh()
    }
  }

  function loadSaved() {
    setActiveReading(reading)
    setRows(reading && !reading.confirmedAt ? planRows(reading, existing) : null)
    setCeiling(reading?.ceilingCm ? String(reading.ceilingCm) : '')
    setPage(String(reading?.sourcePage ?? 1))
    setBaseRevision(sourceRevision)
    setConflict(false)
    setError(undefined)
    setReviewEditing(false)
  }

  function read(useReviewedContours = false) {
    setError(undefined)
    startReading(async () => {
      try {
        const result = await readPlan(
          projectId,
          planIsPdf ? Number(page) : 1,
          baseRevision,
          useReviewedContours,
        )
        if (!result.ok) {
          showFailure(result)
          return
        }
        setRows(planRows(result.data.reading, existing))
        setActiveReading(result.data.reading)
        setBaseRevision(result.data.revision)
        setCeiling(result.data.reading.ceilingCm ? String(result.data.reading.ceilingCm) : '')
        toast({ title: 'План прочитан — сверьте результат', tone: 'success' })
        router.refresh()
      } catch {
        setError(
          'Не удалось получить ответ сервера. Данные остались в форме. Перед повторным чтением обновите страницу: чтение могло уже завершиться.',
        )
      }
    })
  }

  async function forget() {
    setError(undefined)
    setSaving(true)
    try {
      const result = await forgetPlanReading(projectId, baseRevision)
      if (!result.ok) {
        showFailure(result)
        return
      }
      setRows(null)
      setActiveReading(null)
      setBaseRevision(result.data.revision)
      setForgetOpen(false)
      router.refresh()
    } catch {
      setError('Не удалось получить ответ сервера. Данные остались в форме; попробуйте ещё раз.')
    } finally {
      setSaving(false)
    }
  }

  async function confirm() {
    if (!rows) {
      return
    }
    setError(undefined)
    setSaving(true)
    try {
      const result = await confirmPlanRooms(
        projectId,
        {
          ceilingCm: ceiling,
          condition,
          rooms: rows.map((row) => ({
            include: row.include,
            roomId: row.roomId ?? '',
            name: row.name,
            kind: row.kind,
            sourceNumber: row.sourceNumber,
            utility: row.unsupportedReason === 'utility',
            ceilingCm: row.ceiling ?? '',
            widthCm: row.width,
            depthCm: row.depth,
            areaM2: row.area,
            wish: row.wish,
            layoutNotes: row.layoutNotes,
          })),
        },
        baseRevision,
      )
      if (!result.ok) {
        showFailure(result)
        return
      }
      setRows(null)
      setBaseRevision(result.data.revision)
      const { created, updated } = result.data
      toast({
        title:
          [
            created > 0 ? `новых комнат: ${created}` : null,
            updated > 0 ? `размеры вписаны в ${updated}` : null,
          ]
            .filter(Boolean)
            .join(', ') || 'Данные плана сохранены',
        tone: 'success',
      })
      router.refresh()
    } catch {
      setError(
        'Не удалось получить ответ сервера. Правки остались в форме; попробуйте сохранить ещё раз.',
      )
    } finally {
      setSaving(false)
    }
  }

  if (!hasPlan) {
    return null
  }

  const reloadControl = conflict ? (
    <Button type="button" variant="secondary" onClick={loadSaved} disabled={reading_ || saving}>
      Загрузить актуальные данные плана
    </Button>
  ) : null

  const pageSelector = planIsPdf ? (
    <div className="mt-4">
      <label className="block text-[14px] text-ink-2">
        Страница PDF с планом
        <input
          type="number"
          min={1}
          step={1}
          max={activeReading?.pageCount}
          value={page}
          disabled={reading_ || saving || reviewEditing}
          onChange={(event) => setPage(event.currentTarget.value)}
          className={`${numberFieldClassName} mt-2 block w-24`}
        />
      </label>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
        Читаем только выбранную страницу
        {activeReading?.pageCount ? ` из ${activeReading.pageCount}` : ''}. Выберите обмерный лист,
        а не титульный или план перепланировки.
      </p>
    </div>
  ) : null

  const review = activeReading?.pageReview
  const reviewedPage = review?.contours.source.pdfPage === Number(page)
  const canReviewPage =
    planIsPdf &&
    activeReading?.sourcePage === Number(page) &&
    (activeReading.planState === 'existing' || activeReading.planState === 'proposed') &&
    activeReading.rooms.some((room) => room.sourceNumber !== undefined)
  const pageReviewControl =
    canReviewPage && activeReading ? (
      <details className="mt-5 border-t border-line pt-4" open={reviewEditing || undefined}>
        <summary className="min-h-11 cursor-pointer py-2 text-[14px] font-medium text-ink">
          Контуры и проёмы на исходном листе
        </summary>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
          Отметьте контуры, проёмы и неподвижные объекты по номерам комнат на чертеже. При чтении со
          сверкой проверим, относятся ли размерные цепочки и подписи высоты к этим помещениям.
          Разметка не меняет ваши мерки и не запускает генерацию.
        </p>
        {reviewEditing ? (
          <PlanPageContourEditor
            projectId={projectId}
            sourceRevision={baseRevision}
            reading={activeReading}
            pageNumber={Number(page)}
            disabled={reading_ || saving || conflict}
            onClose={() => setReviewEditing(false)}
            onSaved={(data) => {
              setActiveReading(data.reading)
              setBaseRevision(data.revision)
              setReviewEditing(false)
              toast({ title: 'Контуры сохранены для этого листа', tone: 'success' })
              router.refresh()
            }}
            onConflict={() => {
              setConflict(true)
              router.refresh()
            }}
          />
        ) : (
          <div className="mt-3 flex flex-wrap gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setReviewEditing(true)}
              disabled={reading_ || saving || conflict}
            >
              {reviewedPage ? 'Изменить разметку листа' : 'Разметить комнаты и объекты'}
            </Button>
            {reviewedPage ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => read(true)}
                pending={reading_}
                disabled={saving || conflict}
              >
                Прочитать со сверкой контуров
              </Button>
            ) : null}
          </div>
        )}
        {reviewedPage ? (
          <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
            Сохранено контуров: {review.contours.rooms.length}, страница {page}. Повторное чтение
            использует AI и заменит данные в форме; контуры проверим по тому же файлу.
          </p>
        ) : null}
        {reviewedPage && review.featureChecks?.openings.length ? (
          <p className="text-xs leading-relaxed text-ink-2">
            По подписанным линиям сверено проёмов:{' '}
            {review.featureChecks.openings.filter((check) => check.status === 'candidate').length}{' '}
            из {review.featureChecks.openings.length}. Ширины и пояснения — в разметке листа. Эта
            сверка не переносит координаты PDF в сантиметры 2D-схемы автоматически.
          </p>
        ) : null}
      </details>
    ) : null

  if (!rows) {
    let summary =
      'Попробуем прочитать названия комнат и подписанные мерки. Затем вы сверите результат с исходным листом и выберете, какие комнаты перенести.'
    if (confirmed && roomCount > 0) {
      summary =
        'Данные с плана уже перенесены в комнаты. Следующий шаг — открыть комнату и уточнить её мерки перед проверкой мебели. Перенос не подтверждает обмер и не создаёт точную 2D-схему.'
    } else if (confirmed) {
      summary =
        'Чтение плана сохранено, но комнат проекта сейчас нет. Добавьте комнаты для интерьера или прочитайте план заново, чтобы выбрать их из списка. Сохранённая 2D-схема показана ниже отдельно.'
    }

    return (
      <div className="mt-6 border-t border-line pt-6">
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-2">
          {confirmed && roomCount > 0
            ? 'Комнаты перенесены · мерки требуют сверки'
            : 'План → сверка → комнаты'}
        </p>
        <h3 className="mt-2 font-serif text-2xl text-ink">
          {confirmed && roomCount > 0 ? 'Продолжите в мерках комнаты' : 'Прочитайте нужный лист'}
        </h3>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink-2">{summary}</p>
        {reading ? (
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-ink-2">
            {planIsPdf ? `Прочитан лист ${reading.sourcePage ?? page}. ` : ''}
            {reading.planState === 'existing'
              ? 'Существующее состояние — проверьте заголовок исходного листа.'
              : reading.planState === 'proposed'
                ? 'Проектное состояние — вариант после изменений, не исходный обмер.'
                : 'Состояние листа не определено. Сверьте, показан ли исходный обмер или проектные изменения.'}
          </p>
        ) : null}
        {!reading ? pageSelector : null}
        <div className="mt-4 flex flex-wrap gap-3">
          {confirmed && existing[0] ? (
            <Link
              href={`/projects/${projectId}/rooms/${existing[0].id}#room-measurements`}
              className={buttonClassName({ className: 'max-w-full' })}
              aria-label={`Открыть мерки комнаты ${existing[0].name}`}
            >
              Открыть мерки комнаты
            </Link>
          ) : null}
          {reading ? (
            <Button
              type="button"
              variant={confirmed && existing.length > 0 ? 'secondary' : 'primary'}
              onClick={editSavedReading}
              disabled={reading_ || saving || conflict || reviewEditing}
            >
              Изменить данные с чертежа
            </Button>
          ) : null}
          {!reading ? (
            <Button
              type="button"
              onClick={() => read()}
              pending={reading_}
              disabled={saving || conflict || reviewEditing}
            >
              {reading_ ? 'Читаем план…' : 'Прочитать выбранный лист'}
            </Button>
          ) : null}
        </div>
        {reading ? (
          <details className="mt-4">
            <summary className="min-h-11 cursor-pointer py-2 text-[14px] text-ink-2">
              Прочитать другой лист или повторить чтение
            </summary>
            <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-ink-2">
              Повторное чтение использует AI и заменит данные в форме. Для обычной правки откройте
              сохранённые данные с чертежа выше.
            </p>
            {pageSelector}
            <Button
              type="button"
              variant="secondary"
              onClick={() => read()}
              pending={reading_}
              disabled={saving || conflict || reviewEditing}
              className="mt-3"
            >
              {reading_ ? 'Читаем план…' : 'Прочитать выбранный лист'}
            </Button>
          </details>
        ) : null}
        {pageReviewControl}
        {reading_ ? (
          <div
            role="status"
            aria-live="polite"
            className="plan-scan relative mt-4 overflow-hidden border border-line bg-paper px-4 py-5"
          >
            <p className="relative z-10 bg-paper/90 text-[14px] leading-relaxed text-ink-2">
              Читаем выбранный лист. После чтения появятся комнаты и мерки для вашей сверки.
            </p>
          </div>
        ) : null}
        <FormError message={error} />
        {reloadControl}
      </div>
    )
  }

  const chosen = rows.filter((row) => row.include).length
  // Ни у одной комнаты не прочитались обе стороны: план без размерных линий
  const noSides = rows.every((row) => row.width === '' || row.depth === '')
  // Сумма площадей против общей площади с плана: единственное, что ловит потерянную и выдуманную комнату
  const total = totalAreaCheck(rows, activeReading?.totalAreaM2)
  const missingSourceRows = (activeReading?.pageReview?.sourceRooms ?? []).filter(
    (room) => !rows.some((row) => row.sourceNumber === room.sourceNumber),
  )

  return (
    <fieldset
      disabled={saving || reading_}
      aria-labelledby="plan-reading-review-title"
      className="mt-6 min-w-0 animate-[rise-in_350ms_var(--ease-appear)] border-x-0 border-b-0 border-t border-line p-0 pt-6"
    >
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-2">
        План → сверка → комнаты
      </p>
      <h3 id="plan-reading-review-title" className="mt-2 font-serif text-2xl text-ink">
        Сверьте данные перед переносом
      </h3>

      <p className="mt-3 text-[14px] leading-relaxed text-ink-2">
        {planIsPdf ? `Страница ${activeReading?.sourcePage ?? page}. ` : ''}
        {activeReading?.planState === 'existing'
          ? 'Лист распознан как существующее состояние. Сверьте это с заголовком чертежа.'
          : activeReading?.planState === 'proposed'
            ? 'Проектное состояние — вариант после изменений, не исходный обмер. Для текущей планировки выберите обмерный лист; для согласованного будущего интерьера используйте проектный.'
            : 'Сверьте заголовок листа: он может описывать существующую планировку или вариант после изменений. Эти состояния рассматриваем отдельно.'}
      </p>
      <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
        Проверьте названия, назначение и подписанные размеры рядом с исходным листом. Отмеченные
        комнаты перенесём в проект; совпавшие комнаты обновим, остальные добавим. Это перенос данных
        с чертежа: замеры на месте подтверждаются отдельно в мерках комнаты. После переноса новых
        данных 2D-схему нужно сверить заново.
      </p>

      {noSides ? (
        <p className="mt-3 text-[14px] leading-relaxed text-ink-2">
          Дополните ширину и глубину по размерным линиям — это основа проверки размещения мебели.
          Пока эти поля пустые: площадь не определяет длину стен. Размеры можно указать здесь или
          позже, в мерках комнаты.
        </p>
      ) : null}

      {total && !total.agrees ? (
        <p className="mt-3 border-l-2 border-danger/50 pl-3 text-[14px] leading-relaxed text-ink-2">
          Комнаты в сумме дают {total.sum} м², а общая площадь на плане {total.total} м². Перед
          сохранением сверьте состав помещений и подписанные площади. Разница может быть связана со
          списком комнат, чтением подписей или способом подсчёта площади.
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap items-end gap-6">
        <div className="max-w-[10rem]">
          <Input
            id="plan-ceiling"
            label="Общая высота, см"
            inputMode="decimal"
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
        Общую высоту указывайте только если она одинакова. Высота отдельной комнаты ниже имеет
        приоритет. Диапазон высот не усредняем; пустое поле означает неизвестный размер.
      </p>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
        {roomConditionHints[condition]} Поставим это новым комнатам. У тех, что уже заведены,
        состояние не трогаем: вы могли выбрать его сами.
      </p>

      {missingSourceRows.length > 0 ? (
        <div className="mt-5 space-y-3 border-l-2 border-accent pl-4">
          <p className="text-sm font-medium text-ink">Добавить помещение из экспликации</p>
          <p className="max-w-2xl text-[13px] leading-relaxed text-ink-2">
            Перенесём только номер и название с исходного листа. Выберите назначение; размеры
            останутся пустыми. Контур размечается отдельно по обмеру.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-0 space-y-1 text-xs">
              <span className="block">Помещение на листе</span>
              <select
                aria-label="Помещение из экспликации"
                className={`${numberFieldClassName} max-w-full`}
                value={newSourceNumber}
                onChange={(event) => setNewSourceNumber(event.currentTarget.value)}
              >
                <option value="">Выберите номер…</option>
                {missingSourceRows.map((room) => (
                  <option key={room.sourceNumber} value={room.sourceNumber}>
                    №{String(room.sourceNumber).padStart(2, '0')} · {room.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-0 space-y-1 text-xs">
              <span className="block">Назначение</span>
              <select
                aria-label="Назначение добавляемого помещения"
                className={numberFieldClassName}
                value={newSourceKind}
                onChange={(event) =>
                  setNewSourceKind(event.currentTarget.value as typeof newSourceKind)
                }
              >
                <option value="">Выберите после сверки…</option>
                {mvpRoomKinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {roomKindLabels[kind]}
                  </option>
                ))}
                <option value="bath">Санузел · только на плане</option>
                <option value="utility">
                  Коридор, лоджия или другое вспомогательное помещение
                </option>
              </select>
            </label>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={addSourceRoom}
              disabled={
                !newSourceNumber || !newSourceKind || rows.length >= 20 || conflict || reviewEditing
              }
            >
              Добавить строку
            </Button>
          </div>
        </div>
      ) : null}
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
                  aria-label={`Перенести комнату ${row.name || index + 1}`}
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
                  disabled={row.unsupported}
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
                  {row.kind === 'bath' ? <option value="bath">Санузел</option> : null}
                </select>
              </div>

              <div className="mt-3 flex flex-wrap gap-3 pl-[30px]">
                {row.sourceNumber !== undefined ? (
                  <p className="w-full text-[13px] text-ink-2">
                    Помещение №{row.sourceNumber} на исходном листе
                  </p>
                ) : null}
                <label className="text-[13px] text-ink-2">
                  Ширина, см
                  <input
                    inputMode="decimal"
                    value={row.width}
                    onChange={(event) => patch(index, { width: event.currentTarget.value })}
                    className={`${numberFieldClassName} mt-1 w-24`}
                  />
                </label>
                <label className="text-[13px] text-ink-2">
                  Глубина, см
                  <input
                    inputMode="decimal"
                    value={row.depth}
                    onChange={(event) => patch(index, { depth: event.currentTarget.value })}
                    className={`${numberFieldClassName} mt-1 w-24`}
                  />
                </label>
                <label className="text-[13px] text-ink-2">
                  Потолок, см
                  <input
                    inputMode="decimal"
                    value={row.ceiling ?? ''}
                    onChange={(event) => patch(index, { ceiling: event.currentTarget.value })}
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
                <div className="mt-4 min-w-0 pl-[30px]">
                  <RoomLayoutField
                    id={`plan-layout-${index}`}
                    value={row.layoutNotes}
                    onChange={(layoutNotes) => patch(index, { layoutNotes })}
                  />
                </div>
              ) : null}

              {row.width === '' || row.depth === '' ? (
                <p className="mt-2 pl-[30px] text-[13px] leading-relaxed text-ink-2">
                  Укажите недостающие стороны или подтвердите контур комнаты, чтобы проверить
                  размещение мебели. Пока неизвестные размеры оставлены пустыми.
                </p>
              ) : null}

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
                  Обновим данные комнаты «{row.roomName}», которая уже есть в проекте. Проверьте
                  новые числа перед переносом.
                </p>
              ) : null}
              {row.unsupported ? (
                <p className="mt-3 pl-[30px] text-[13px] leading-relaxed text-ink-2">
                  {row.unsupportedReason === 'utility'
                    ? 'Размеры прихожих, коридоров и кладовых сохраняем в плане. Концепты и подбор мебели в этой версии доступны для гостиных, спален, кухонь и детских.'
                    : 'Размеры санузла сохраняем в плане. Концепты и подбор мебели в этой версии доступны для гостиных, спален, кухонь и детских.'}
                </p>
              ) : null}
              {row.rechecked ? (
                <p className="mt-2 pl-[30px] text-[13px] leading-relaxed text-ink-2">
                  {row.rechecked === 'both' ? 'Обе стороны' : 'Одну сторону'} мы перечитали по
                  отрезкам размерной цепочки: с первого раза площадь не сходилась, теперь сходится.
                </p>
              ) : null}
              {row.measurementWarnings?.map((warning) => (
                <p key={warning} className="mt-2 pl-[30px] text-[13px] leading-relaxed text-ink-2">
                  {warning}
                </p>
              ))}
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
                    ? 'Стороны рассчитаны из площади, а не прочитаны с размерных линий. Для проверки мебели замените это приближение размерами с чертежа или замером на месте.'
                    : `${row.estimated === 'width' ? 'Ширина рассчитана' : 'Глубина рассчитана'} из площади и второй стороны. Для проверки мебели замените это приближение размером с чертежа или замером на месте.`}
                </p>
              ) : null}
              {check ? (
                <div className="mt-2 pl-[30px]">
                  <p className="text-[13px] leading-relaxed text-ink-2">
                    {check.text} Сверьте размерные подписи и форму комнаты: ниша или скос тоже
                    влияют на площадь. Длину стены берём с чертежа или из замера, не из площади.
                  </p>
                </div>
              ) : null}
              {row.suspicious && !row.chainMismatch ? (
                <p className="mt-3 pl-[30px] text-[13px] leading-relaxed text-danger">
                  Площадь отличается от произведения сторон. Проверьте подписи и форму комнаты.
                </p>
              ) : null}
            </li>
          )
        })}
      </ul>

      {pageReviewControl}
      <details className="mt-4">
        <summary className="min-h-11 cursor-pointer py-2 text-[14px] text-ink-2">
          {planIsPdf ? 'Выбрать другой лист или повторить чтение' : 'Повторить чтение плана'}
        </summary>
        <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-ink-2">
          Повторное чтение использует AI и заменит данные в форме, включая несохранённые правки.
          Изменить названия и мерки можно прямо в списке выше.
        </p>
        {pageSelector}
        <Button
          type="button"
          variant="secondary"
          onClick={() => read()}
          pending={reading_}
          disabled={saving || conflict || reviewEditing}
          className="mt-3"
        >
          Прочитать выбранный лист заново
        </Button>
      </details>

      <FormError message={error} />
      {reloadControl}

      <div className="mt-5 flex flex-wrap gap-3">
        <Button
          type="button"
          onClick={confirm}
          pending={saving}
          disabled={reading_ || conflict || reviewEditing}
        >
          {saving
            ? 'Переносим…'
            : chosen
              ? `Перенести комнаты: ${chosen}`
              : 'Сохранить список помещений'}
        </Button>
      </div>
      <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-ink-2">
        После переноса откройте комнату: там можно дополнить неизвестные мерки и подготовить
        интерьер. Контуры для размерной 2D-схемы переносятся отдельно.
      </p>
      <details className="mt-3">
        <summary className="min-h-11 cursor-pointer py-2 text-[14px] text-ink-2">
          Продолжить вручную
        </summary>
        <p id="plan-forget-hint" className="mt-2 max-w-2xl text-[13px] leading-relaxed text-ink-2">
          Для правки названий и мерок используйте поля выше. Очистка удалит сохранённое чтение,
          разметку листа и 2D-схему, если они есть. Загруженный файл и комнаты проекта останутся.
        </p>
        <Dialog
          open={forgetOpen}
          onOpenChange={(open) => {
            setForgetOpen(open)
            if (open) setError(undefined)
          }}
        >
          <DialogTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              disabled={saving || reading_ || conflict || reviewEditing}
              aria-describedby="plan-forget-hint"
              className="mt-2"
            >
              Очистить сохранённое чтение
            </Button>
          </DialogTrigger>
          <DialogContent
            title="Очистить чтение плана?"
            description="Удалятся результат чтения, разметка листа и 2D-схема, если они есть. Загруженный файл и комнаты проекта останутся. Отменить очистку нельзя."
          >
            <FormError message={error} />
            <div className="flex flex-wrap gap-3">
              <DialogClose asChild>
                <Button variant="secondary" disabled={saving}>
                  Оставить данные
                </Button>
              </DialogClose>
              <Button
                onClick={forget}
                pending={saving}
                disabled={reading_ || conflict || reviewEditing}
              >
                {saving ? 'Очищаем…' : 'Да, очистить чтение'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </details>
    </fieldset>
  )
}
