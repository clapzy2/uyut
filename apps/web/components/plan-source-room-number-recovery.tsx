'use client'

import type { PlanReading } from '@uyut/db'
import { Button } from '@uyut/ui'
import { useId, useState } from 'react'
import {
  getPlanSourceRoomNumberOptions,
  savePlanSourceRoomNumbers,
} from '@/actions/plan-source-room-numbers'

type Options = Extract<
  Awaited<ReturnType<typeof getPlanSourceRoomNumberOptions>>,
  { ok: true }
>['data']

/** Explicit restoration of a missing printed identifier, never a geometric import. */
export function PlanSourceRoomNumberRecovery({
  projectId,
  revision,
  disabled,
  onSaved,
  onConflict,
  onPendingChange,
}: {
  projectId: string
  revision: string
  disabled?: boolean
  onSaved: (result: { reading: PlanReading; revision: string }) => void
  onConflict: () => void
  onPendingChange: (pending: boolean) => void
}) {
  const id = useId()
  const [options, setOptions] = useState<Options>()
  const [selected, setSelected] = useState<string[]>([])
  const [acknowledged, setAcknowledged] = useState(false)
  const [pending, setPending] = useState<'load' | 'save'>()
  const [error, setError] = useState<string>()

  async function load() {
    if (disabled || pending) return
    setPending('load')
    onPendingChange(true)
    setError(undefined)
    setOptions(undefined)
    setSelected([])
    setAcknowledged(false)
    try {
      const result = await getPlanSourceRoomNumberOptions(projectId, revision)
      if (!result.ok) {
        setError(result.error)
        if (result.code === 'plan-conflict') onConflict()
        return
      }
      setOptions(result.data)
    } catch {
      setError('Не удалось проверить номера. Данные не изменены; повторите сверку.')
    } finally {
      setPending(undefined)
      onPendingChange(false)
    }
  }

  async function save() {
    if (!options || disabled || pending || !acknowledged || !selected.length) return
    setPending('save')
    onPendingChange(true)
    setError(undefined)
    try {
      const selections = options.options
        .filter((option) => selected.includes(option.floorId))
        .map(({ floorId, roomIndex }) => ({ floorId, roomIndex }))
      const result = await savePlanSourceRoomNumbers(
        projectId,
        JSON.stringify({ acknowledgement: true, selections }),
        options.revision,
      )
      if (!result.ok) {
        setError(result.error)
        if (result.code === 'plan-conflict') onConflict()
        return
      }
      setOptions(undefined)
      setSelected([])
      setAcknowledged(false)
      onSaved(result.data)
    } catch {
      setOptions(undefined)
      setSelected([])
      setAcknowledged(false)
      setError(
        'Ответ сервера не получен. Обновите страницу перед повтором: номер мог уже сохраниться.',
      )
    } finally {
      setPending(undefined)
      onPendingChange(false)
    }
  }

  return (
    <details className="mt-5 min-w-0 max-w-full border-t border-line pt-4">
      <summary className="min-h-11 cursor-pointer text-[14px] font-medium">
        Восстановить номера из сохранённой сверки исходника
      </summary>
      <div className="mt-3 space-y-3 text-[13px] leading-relaxed">
        <p className="text-ink-2">
          Старое чтение могло пропустить подномер вроде 3.1. Сверим сохранённые области с текущим
          PDF и предложим номер только для единственной одноимённой строки без номера. Размеры,
          высоты, контуры и существующие номера не заменяются. Это не перенос геометрии в 2D/3D.
        </p>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={load}
          disabled={disabled || Boolean(pending)}
        >
          {pending === 'load' ? 'Сверяем исходник…' : 'Проверить отсутствующие номера'}
        </Button>
        {disabled && !pending ? (
          <p className="text-ink-2">
            Сначала завершите текущую правку или закройте разметку листа.
          </p>
        ) : null}
        {options ? (
          options.options.length ? (
            <>
              <fieldset className="space-y-2" disabled={disabled || Boolean(pending)}>
                <legend className="mb-2 font-medium">
                  Какие строки сверены с номером на исходнике
                </legend>
                {options.options.map((option) => (
                  <label key={option.floorId} className="flex min-h-11 items-start gap-2 py-2">
                    <input
                      type="checkbox"
                      checked={selected.includes(option.floorId)}
                      onChange={(event) => {
                        const checked = event.target.checked
                        setAcknowledged(false)
                        setSelected((values) =>
                          checked
                            ? [...values, option.floorId]
                            : values.filter((value) => value !== option.floorId),
                        )
                      }}
                      className="mt-1"
                    />
                    <span>
                      Строка {option.roomIndex + 1} «{option.name}» → номер {option.sourceRoomKey}
                    </span>
                  </label>
                ))}
              </fieldset>
              <label htmlFor={id} className="flex min-h-11 items-start gap-2 py-2">
                <input
                  id={id}
                  type="checkbox"
                  checked={acknowledged}
                  disabled={disabled || Boolean(pending) || !selected.length}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                  className="mt-1"
                />
                <span>
                  Сверил выбранные номера с исходным листом и соответствующими строками. Физические
                  границы и мерки этим не подтверждаются.
                </span>
              </label>
              <Button
                type="button"
                size="sm"
                onClick={save}
                disabled={disabled || Boolean(pending) || !selected.length || !acknowledged}
              >
                {pending === 'save' ? 'Сохраняем номера…' : 'Восстановить выбранные номера'}
              </Button>
            </>
          ) : (
            <p className="text-ink-2">
              Однозначных отсутствующих номеров для восстановления нет. Известные номера не
              меняются; спорные названия нужно сверить отдельно.
            </p>
          )
        ) : null}
        {error ? (
          <p role="alert" className="text-ink-2">
            {error}
          </p>
        ) : null}
      </div>
    </details>
  )
}
