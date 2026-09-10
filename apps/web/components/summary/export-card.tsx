'use client'

import type { ProjectContact, SubscriptionPlan } from '@uyut/db'
import { Button, buttonClassName, Checkbox, cn, inputClassName, Label, toast } from '@uyut/ui'
import { motion } from 'motion/react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { startProjectPurchase, startProSubscription } from '@/actions/billing'
import { type ExportRun, exportProjectPdf, loadExport } from '@/actions/exports'
import { CheckoutButton } from '@/components/billing/checkout-button'
import { TypingDots } from '@/components/typing-dots'
import { formatPrice } from '@/lib/concepts/format'
import type { ExportView } from '@/lib/exports/repository'
import { formatDate } from '@/lib/projects/format'
import { formatPhoneInput } from '@/lib/projects/phone'
import { useRunWatch } from '@/lib/queue/use-run-watch'

export type PaymentState = 'paid' | 'pending' | 'canceled' | null

const stageLabels: Array<{ key: string; label: string }> = [
  { key: 'collect', label: 'Собираем данные проекта' },
  { key: 'brief', label: 'Пишем задание для мастеров' },
  { key: 'layout', label: 'Верстаем страницы' },
  { key: 'print', label: 'Печатаем PDF' },
  { key: 'upload', label: 'Сохраняем файл' },
  { key: 'done', label: 'Готово' },
]

function stageIndex(stage: string | undefined): number {
  const found = stageLabels.findIndex((item) => item.key === stage)
  return found === -1 ? 0 : found
}

// Сборка обычно укладывается в полминуты, минута — это уже повод сказать человеку хоть что-то
const SLOW_AFTER_MS = 60_000
// Задача живёт не дольше пяти минут (jobs/trigger.config.ts), после шести ждать нечего
const GIVE_UP_AFTER_MS = 6 * 60_000

function RunProgress({
  runId,
  accessToken,
  onFinished,
}: {
  runId: string
  accessToken: string
  onFinished: (failed: boolean) => void
}) {
  const { progress, slow, lost } = useRunWatch({
    runId,
    accessToken,
    slowAfterMs: SLOW_AFTER_MS,
    giveUpAfterMs: GIVE_UP_AFTER_MS,
    onFinished,
  })
  const current = stageIndex(progress.stage)

  if (lost) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-[13px] leading-relaxed text-ink-2">
          Связь с очередью потерялась. Файл всё равно соберётся, обновите страницу через минуту.
        </p>
        <button
          type="button"
          onClick={() => onFinished(false)}
          className="self-start py-1 text-[13px] text-accent underline decoration-accent/40 underline-offset-4 transition-colors duration-200 ease-ui hover:decoration-accent"
        >
          Показать, что получилось
        </button>
      </div>
    )
  }
  // Доля пройденного: без полосы шаги стоят молча, и сборка выглядит замершей
  const filled = progress.stage === 'done' ? 1 : Math.min(1, current / stageLabels.length)

  return (
    <ol className="flex flex-col gap-1.5" aria-label="Сборка PDF">
      <li aria-hidden="true" className="mb-1 h-[3px] overflow-hidden rounded-full bg-muted">
        <motion.span
          className="block h-full bg-accent"
          initial={{ width: 0 }}
          animate={{ width: `${Math.round(filled * 100)}%` }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        />
      </li>
      {stageLabels.map((item, index) => {
        const done = index < current || progress.stage === 'done'
        const active = index === current && progress.stage !== 'done'
        return (
          <li key={item.key} className="flex items-center gap-3 text-[14px]">
            <span
              aria-hidden="true"
              className={
                done
                  ? 'grid h-4 w-4 place-items-center rounded-full border border-success bg-success text-[10px] text-paper'
                  : active
                    ? 'relative h-4 w-4 rounded-full border border-accent bg-accent-tint'
                    : 'h-4 w-4 rounded-full border border-line-strong'
              }
            >
              {done ? '✓' : null}
              {active ? (
                <motion.span
                  className="absolute inset-0 rounded-full border border-accent"
                  animate={{ scale: [1, 1.9], opacity: [0.7, 0] }}
                  transition={{ duration: 1.6, repeat: Number.POSITIVE_INFINITY, ease: 'easeOut' }}
                />
              ) : null}
            </span>
            <span className={done || active ? 'text-ink' : 'text-ink-2'}>{item.label}</span>
            {active ? <TypingDots label="Идёт работа" /> : null}
          </li>
        )
      })}
      {slow ? (
        <li className="mt-1 text-[13px] leading-relaxed text-ink-2">
          Идёт дольше обычного. Можно закрыть страницу: ссылка на готовый файл придёт письмом.
        </li>
      ) : null}
    </ol>
  )
}

function exportMeta(item: ExportView): string {
  return [
    item.pages ? `${item.pages} стр.` : null,
    item.durationMs ? `${Math.max(1, Math.round(item.durationMs / 1000))} с` : null,
    item.kind === 'free' ? 'с водяным знаком' : 'без водяного знака',
  ]
    .filter(Boolean)
    .join(' · ')
}

function PaymentBanner({ state }: { state: PaymentState }) {
  if (!state) {
    return null
  }
  const text =
    state === 'paid'
      ? 'Оплата прошла. Документ без водяного знака собирается, письмо со ссылкой придёт на почту.'
      : state === 'canceled'
        ? 'Платёж отменён, деньги не списаны. Можно попробовать ещё раз.'
        : 'Платёж ещё обрабатывается. Если деньги списались, статус обновится в течение минуты — обновите страницу.'
  return (
    <p
      role="status"
      className={cn(
        'mb-4 border-l-2 px-3 py-2 text-[14px] leading-relaxed',
        state === 'paid' ? 'border-success text-ink' : 'border-accent text-ink-2',
      )}
    >
      {text}
    </p>
  )
}

export function ExportCard({
  projectId,
  exports,
  contact,
  isPaid,
  plan,
  hasRooms,
  projectPriceKopecks,
  proPriceKopecks,
  paymentState = null,
  initialRun = null,
}: {
  projectId: string
  exports: ExportView[]
  contact: ProjectContact | null
  isPaid: boolean
  plan: SubscriptionPlan
  hasRooms: boolean
  projectPriceKopecks: number
  proPriceKopecks: number
  paymentState?: PaymentState
  initialRun?: ExportRun | null
}) {
  const router = useRouter()
  const [includeClientName, setIncludeClientName] = useState(false)
  const [includeAddress, setIncludeAddress] = useState(false)
  const [includePhone, setIncludePhone] = useState(false)
  const [clientName, setClientName] = useState(contact?.clientName ?? '')
  const [address, setAddress] = useState(contact?.address ?? '')
  const [phone, setPhone] = useState(formatPhoneInput(contact?.phone ?? ''))
  const [busy, setBusy] = useState(false)
  const [run, setRun] = useState<ExportRun | null>(initialRun)
  const [paid, setPaid] = useState(isPaid)
  const [latest, setLatest] = useState<ExportView | null>(exports[0] ?? null)
  const previous = exports.filter((item) => item.id !== latest?.id).slice(0, 3)
  // Чистый документ: проект оплачен или у владельца Pro
  const clean = paid || plan === 'pro'

  function start() {
    setBusy(true)
    void exportProjectPdf({
      projectId,
      options: { includeClientName, includeAddress, includePhone },
      contact: { clientName, address, phone },
    }).then((result) => {
      setBusy(false)
      if (!result.ok) {
        toast({ title: result.error, tone: 'danger' })
        return
      }
      setRun(result.data)
    })
  }

  function finished(failed: boolean) {
    const current = run
    if (!current) {
      return
    }
    setRun(null)
    void loadExport(current.exportId).then((result) => {
      if (result.ok) {
        setLatest(result.data)
      }
      if (failed || (result.ok && result.data.status === 'failed')) {
        toast({ title: 'PDF не собрался. Попробуйте ещё раз.', tone: 'danger' })
      } else {
        toast({ title: 'PDF готов', tone: 'success' })
      }
      router.refresh()
    })
  }

  return (
    <section className="border border-line bg-paper p-5 sm:p-6" aria-labelledby="export-title">
      <p
        id="export-title"
        className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-2"
      >
        Забрать проект
      </p>
      <h2 className="mt-2 font-serif text-[24px] leading-tight text-ink">PDF как журнал</h2>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
        Обложка, разворот каждой комнаты, список покупок, смета и техническое задание для бригады.{' '}
        {clean
          ? paid
            ? 'Проект оплачен, документ выходит без водяного знака.'
            : 'У вас Pro, документ выходит без водяного знака.'
          : `Без оплаты документ выходит с водяным знаком «Домица» на каждой странице. Разовая покупка проекта — ${formatPrice(projectPriceKopecks)}.`}
      </p>

      <div className="mt-5">
        <PaymentBanner state={paymentState} />
      </div>

      <div className="flex flex-col gap-3">
        <Checkbox
          id="export-client-name"
          label={<span className="text-[14px]">Имя заказчика на обложке</span>}
          checked={includeClientName}
          onChange={(event) => setIncludeClientName(event.currentTarget.checked)}
        />
        {includeClientName ? (
          <div>
            <Label htmlFor="export-client-name-value" className="mb-1.5">
              Имя
            </Label>
            <input
              id="export-client-name-value"
              className={inputClassName}
              value={clientName}
              maxLength={80}
              onChange={(event) => setClientName(event.currentTarget.value)}
              placeholder="Анна и Павел"
            />
          </div>
        ) : null}
        <Checkbox
          id="export-address"
          label={<span className="text-[14px]">Адрес объекта</span>}
          checked={includeAddress}
          onChange={(event) => setIncludeAddress(event.currentTarget.checked)}
        />
        {includeAddress ? (
          <div>
            <Label htmlFor="export-address-value" className="mb-1.5">
              Адрес
            </Label>
            <input
              id="export-address-value"
              className={inputClassName}
              value={address}
              maxLength={200}
              onChange={(event) => setAddress(event.currentTarget.value)}
              placeholder="Москва, пр-т Мира, 10, кв. 25"
            />
          </div>
        ) : null}
        <Checkbox
          id="export-phone"
          label={<span className="text-[14px]">Телефон для мастера</span>}
          checked={includePhone}
          onChange={(event) => setIncludePhone(event.currentTarget.checked)}
        />
        {includePhone ? (
          <div>
            <Label htmlFor="export-phone-value" className="mb-1.5">
              Телефон
            </Label>
            <input
              id="export-phone-value"
              className={inputClassName}
              value={phone}
              maxLength={30}
              inputMode="tel"
              autoComplete="tel"
              onChange={(event) => setPhone(formatPhoneInput(event.currentTarget.value))}
              placeholder="+7 (900) 000-00-00"
            />
          </div>
        ) : null}
      </div>

      <div className="mt-5 flex flex-col gap-4">
        {run ? (
          <RunProgress runId={run.runId} accessToken={run.accessToken} onFinished={finished} />
        ) : clean ? (
          <Button onClick={start} pending={busy} disabled={!hasRooms}>
            {busy ? 'Запускаем…' : 'Собрать PDF'}
          </Button>
        ) : (
          <div className="flex flex-col gap-2">
            <CheckoutButton
              action={() => startProjectPurchase(projectId)}
              disabled={!hasRooms}
              onPaid={(result) => {
                setPaid(true)
                if (result.exportRun) {
                  setRun(result.exportRun)
                }
              }}
            >
              Забрать за {formatPrice(projectPriceKopecks)}
            </CheckoutButton>
            <Button variant="secondary" onClick={start} pending={busy} disabled={!hasRooms}>
              {busy ? 'Запускаем…' : 'Собрать PDF с водяным знаком'}
            </Button>
          </div>
        )}
        {!hasRooms ? (
          <p className="text-[13px] text-ink-2">
            Добавьте хотя бы одну комнату, чтобы собрать документ.
          </p>
        ) : null}

        {latest && !run ? (
          latest.status === 'ready' && latest.pdfUrl ? (
            <div className="flex flex-col gap-2 border-t border-line pt-4">
              <a
                href={latest.pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClassName({ variant: 'secondary' })}
              >
                Скачать PDF
              </a>
              <p className="font-mono text-[12px] text-ink-2">
                {formatDate(latest.createdAt)} · {exportMeta(latest)}
              </p>
            </div>
          ) : latest.status === 'failed' ? (
            <p className="border-t border-line pt-4 text-[13px] leading-relaxed text-danger">
              {/* Раньше сюда выводилась сырая ошибка задачи — владелец увидел стек вызовов
                  с путями к файлам внутри контейнера. Человеку это ничего не говорит,
                  а подробности и так лежат в журнале сервера. */}
              Последняя сборка не удалась. Мы записали, что случилось, и уже смотрим. Попробуйте ещё
              раз — обычно со второго выходит.
            </p>
          ) : latest.status === 'running' || latest.status === 'pending' ? (
            <p className="border-t border-line pt-4 text-[13px] leading-relaxed text-ink-2">
              Предыдущая сборка ещё идёт, обновите страницу через минуту.
            </p>
          ) : null
        ) : null}

        {previous.length > 0 ? (
          <ul className="flex flex-col gap-1.5 border-t border-line pt-4 text-[13px] text-ink-2">
            {previous.map((item) => (
              <li key={item.id} className="flex flex-wrap items-baseline justify-between gap-2">
                <span>
                  {formatDate(item.createdAt)} · {exportMeta(item)}
                </span>
                {item.pdfUrl ? (
                  <a
                    href={item.pdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block py-1.5 text-ink underline decoration-accent decoration-1 underline-offset-4"
                  >
                    Скачать
                  </a>
                ) : (
                  <span>{item.status === 'failed' ? 'не удалась' : 'в работе'}</span>
                )}
              </li>
            ))}
          </ul>
        ) : null}

        {plan === 'free' ? (
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-line pt-4 text-[13px] text-ink-2">
            <span>
              Pro за {formatPrice(proPriceKopecks)} в месяц: без ограничений на проекты и без
              водяного знака везде.
            </span>
            <CheckoutButton
              variant="ghost"
              size="sm"
              className="px-0 underline decoration-accent decoration-1 underline-offset-4"
              action={() => startProSubscription(`/projects/${projectId}/summary`)}
              pendingLabel="Переходим…"
            >
              Оформить Pro
            </CheckoutButton>
          </div>
        ) : null}
      </div>
    </section>
  )
}
