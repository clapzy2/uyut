'use client'

import type { PlanReading } from '@uyut/db'
import { Button, inputClassName } from '@uyut/ui'
import { useId, useState } from 'react'
import {
  getPlanFloorHeightReviewOptions,
  savePlanFloorHeightReview,
} from '@/actions/plan-floor-height-review'

type Options = Extract<
  Awaited<ReturnType<typeof getPlanFloorHeightReviewOptions>>,
  { ok: true }
>['data']

/** Explicit source associations, not a finished ceiling or a shared floor level. */
export function PlanFloorHeightReviewEditor({
  projectId,
  revision,
  disabled,
  onSaved,
  onConflict,
}: {
  projectId: string
  revision: string
  disabled?: boolean
  onSaved: (result: { reading: PlanReading; revision: string }) => void
  onConflict: () => void
}) {
  const controlId = useId()
  const [options, setOptions] = useState<Options>()
  const [selected, setSelected] = useState<Record<string, string>>({})
  const [acknowledged, setAcknowledged] = useState(false)
  const [pending, setPending] = useState<'load' | 'save'>()
  const [error, setError] = useState<string>()

  async function load() {
    if (pending || disabled) return
    setPending('load')
    setError(undefined)
    setAcknowledged(false)
    try {
      const result = await getPlanFloorHeightReviewOptions(projectId, revision)
      if (!result.ok) {
        setOptions(undefined)
        setError(result.error)
        if (result.code === 'plan-conflict') onConflict()
        return
      }
      setOptions(result.data)
      setSelected(
        Object.fromEntries(result.data.review.bindings.map((row) => [row.floorId, row.labelId])),
      )
    } catch {
      setOptions(undefined)
      setError('Не удалось проверить подписи высот. Проверьте соединение и повторите загрузку.')
    } finally {
      setPending(undefined)
    }
  }

  async function save() {
    if (!options || pending || disabled || !acknowledged) return
    setPending('save')
    setError(undefined)
    const bindings = options.floors.flatMap((floor) => {
      const labelId = selected[floor.id]
      return labelId ? [{ floorId: floor.id, labelId }] : []
    })
    try {
      const result = await savePlanFloorHeightReview(
        projectId,
        JSON.stringify({ ...options.review, bindings }),
        options.revision,
      )
      if (!result.ok) {
        setError(result.error)
        if (result.code === 'plan-conflict') onConflict()
        return
      }
      onSaved(result.data)
    } catch {
      setError('Не удалось сохранить привязку высот. Проверьте соединение и повторите сверку.')
    } finally {
      setPending(undefined)
    }
  }

  return (
    <details className="mt-5 min-w-0 max-w-full border-t border-line pt-4">
      <summary className="min-h-11 cursor-pointer py-2 text-[14px] font-medium">
        Высоты выбранных помещений — сверка исходных подписей
      </summary>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
        Выберите высоту помещения по исходному листу. Полная подпись должна находиться внутри
        выбранной области пола; числа и источник сервер проверит заново. Не назначайте сюда высоту
        балки, подъёма или перекрытия. Соседняя комната не получает ту же высоту автоматически.
      </p>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
        Это ручная привязка исходной подписи, не подтверждение чистового потолка или натурного
        обмера. Отсчёт от местного чистового пола не задаёт общий ноль квартиры. Принятая 2D/3D не
        меняется.
      </p>
      <Button
        type="button"
        variant="secondary"
        className="mt-3"
        pending={pending === 'load'}
        disabled={disabled || !!pending}
        onClick={load}
      >
        {options ? 'Перепроверить исходные подписи высот' : 'Получить исходные подписи высот'}
      </Button>
      {options ? (
        <div className="mt-4 space-y-4">
          {options.savedBindingStatus === 'refused' ? (
            <p role="status" className="text-[13px] leading-relaxed text-ink-2">
              Прежняя привязка не прошла свежую сверку и не используется. Выберите подписи заново.
            </p>
          ) : null}
          {options.floors.map((floor, index) => {
            const available = options.options.filter((option) => option.floorId === floor.id)
            const id = `${controlId}-floor-${index}`
            return (
              <div key={floor.id}>
                <label htmlFor={id} className="block text-[13px]">
                  {floor.sourceRoomKey} — {floor.name}: подпись высоты помещения
                </label>
                <select
                  id={id}
                  className={`${inputClassName} mt-2 min-h-11 w-full text-[13px]`}
                  value={selected[floor.id] ?? ''}
                  disabled={disabled || !!pending || !available.length}
                  onChange={(event) => {
                    setSelected({ ...selected, [floor.id]: event.target.value })
                    setAcknowledged(false)
                  }}
                >
                  <option value="">Не привязывать — высота не подтверждена</option>
                  {available.map((option) => (
                    <option
                      key={option.labelId}
                      value={option.labelId}
                      disabled={options.floors.some(
                        (other) => other.id !== floor.id && selected[other.id] === option.labelId,
                      )}
                    >
                      {option.originalText} · {option.valueMm} мм · {option.labelId}
                    </option>
                  ))}
                </select>
                {!available.length ? (
                  <p className="mt-2 text-[13px] text-ink-2">
                    Полной проверенной подписи внутри этой области нет. Высоту соседей не копируем.
                  </p>
                ) : null}
              </div>
            )
          })}
          <label className="flex min-h-11 items-start gap-2 text-[13px] leading-relaxed">
            <input
              type="checkbox"
              checked={acknowledged}
              disabled={disabled || !!pending}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            Я сверил выбранные подписи с исходником: это высоты указанных помещений, не балок,
            подъёмов или перекрытий. Привязка остаётся черновиком без общего нуля и переноса в 3D.
          </label>
          <Button
            type="button"
            variant="secondary"
            pending={pending === 'save'}
            disabled={disabled || !!pending || !acknowledged}
            onClick={save}
          >
            Сохранить привязку высот как черновик
          </Button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-[13px] text-ink-2">
          {error}
        </p>
      ) : null}
    </details>
  )
}
