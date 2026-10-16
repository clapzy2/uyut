'use client'

import type { PlanReading } from '@uyut/db'
import { Button, inputClassName } from '@uyut/ui'
import { useState } from 'react'
import {
  proposePlanPaintedFloorReview,
  savePlanPaintedFloorReview,
} from '@/actions/plan-painted-floor-review'
import type { ReviewedNativePaintedFloors } from '@/lib/projects/plan-native-painted-floor-review'

/** Explicit advanced source selection, never an automatic floor/measurement confirmation. */
export function PlanPaintedFloorReviewEditor({
  projectId,
  revision,
  savedJson,
  disabled,
  onSaved,
  onConflict,
  onProposalChange,
}: {
  projectId: string
  revision: string
  savedJson?: string
  disabled?: boolean
  onSaved: (result: { reading: PlanReading; revision: string }) => void
  onConflict: () => void
  onProposalChange?: (proposal: ReviewedNativePaintedFloors | null) => void
}) {
  const [json, setJson] = useState(savedJson ?? '')
  const [acknowledged, setAcknowledged] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const [proposalNote, setProposalNote] = useState<string>()
  const [proposalRooms, setProposalRooms] = useState<string[]>([])
  async function propose() {
    if (pending || disabled || json.trim()) return
    setPending(true)
    setError(undefined)
    try {
      const result = await proposePlanPaintedFloorReview(projectId, revision)
      if (!result.ok) {
        setError(result.error)
        if (result.code === 'plan-conflict') onConflict()
        return
      }
      setJson(result.data.json)
      onProposalChange?.(JSON.parse(result.data.json) as ReviewedNativePaintedFloors)
      setAcknowledged(false)
      setProposalNote(
        `Предложено областей: ${result.data.suggested}. Пропущено фрагментов без однозначной связи с подписью или экспликацией: ${result.data.skipped}. Ничего не сохранено.`,
      )
      setProposalRooms(result.data.rooms)
    } catch {
      setError('Не удалось подготовить черновик по исходному PDF. Повторите попытку.')
    } finally {
      setPending(false)
    }
  }
  async function save() {
    if (pending || disabled || !acknowledged) return
    setPending(true)
    setError(undefined)
    try {
      const result = await savePlanPaintedFloorReview(projectId, json, revision)
      if (!result.ok) {
        setError(result.error)
        if (result.code === 'plan-conflict') onConflict()
        return
      }
      onSaved(result.data)
    } catch {
      setError(
        'Не удалось сохранить выбор пола. Проверьте соединение и повторите проверку исходника.',
      )
    } finally {
      setPending(false)
    }
  }
  return (
    <details className="mt-5 min-w-0 max-w-full border-t border-line pt-4">
      <summary className="min-h-11 cursor-pointer py-2 text-[14px] font-medium">
        Привязка областей пола к исходнику — расширенная разметка
      </summary>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
        Это явный выбор фрагментов PDF и владельцев, не распознавание пола по цвету. Сервер заново
        проверит источник, точки, вырезы и подписи. Если название есть только в экспликации, связь
        допустима лишь по единственному круглому номеру внутри области. Номера вроде «3.1»
        сохраняются буквально. Стены, косяки, высоты, общий ноль и обмеры этим не подтверждаются;
        существующая 2D/3D не меняется.
      </p>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
        Для каждой выбранной области нужны candidateId, pieceIndex, исходные polygon/holes, owner с
        sourceRoomKey и двумя идентификаторами подписей, а также boundaryRoles для каждой внешней
        грани. Неизвестную роль оставляйте unresolved; торец профиля не назначайте косяком. Снимок
        должен содержать исходный PDF и rasterSource выбранного листа. Лимит — 64 КиБ.
      </p>
      <Button
        type="button"
        variant="secondary"
        className="mt-3"
        pending={pending}
        disabled={disabled || pending || Boolean(json.trim())}
        onClick={propose}
      >
        Подготовить черновик по подписям PDF
      </Button>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
        Кнопка доступна при пустом поле. Она не сохраняет и не подтверждает контуры: сравните
        предложенные области и подписи с исходным листом, а пропущенные фрагменты проверьте вручную.
      </p>
      {proposalNote ? <p className="mt-2 text-[13px] text-ink-2">{proposalNote}</p> : null}
      {proposalNote ? (
        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
          Откройте «Проверка исходного листа без AI» выше и нажмите «Проверить исходный лист»:
          предложенные фрагменты будут показаны отдельным пунктирным слоем поверх PDF только при
          точном совпадении источника. Это не подтверждение контура для 2D/3D.
        </p>
      ) : null}
      {proposalRooms.length ? (
        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
          Предложенные помещения: {proposalRooms.join('; ')}.
        </p>
      ) : null}
      <label className="mt-3 block text-[13px]">
        JSON выбора областей пола
        <textarea
          className={`${inputClassName} mt-2 min-h-40 w-full font-mono text-[12px]`}
          value={json}
          onChange={(event) => {
            setJson(event.target.value)
            onProposalChange?.(null)
            setAcknowledged(false)
            setProposalNote(undefined)
            setProposalRooms([])
          }}
          disabled={disabled || pending}
          spellCheck={false}
        />
      </label>
      <label className="mt-3 flex min-h-11 items-start gap-2 text-[13px] leading-relaxed">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
          disabled={disabled || pending}
        />
        Я сверил выбранные фрагменты и подписи с исходным листом. Это черновик привязки, не
        подтверждение физических границ или обмеров.
      </label>
      <Button
        type="button"
        variant="secondary"
        className="mt-2"
        pending={pending}
        disabled={disabled || pending || !acknowledged || !json.trim()}
        onClick={save}
      >
        Сохранить выбор областей пола как черновик
      </Button>
      {error ? (
        <p role="alert" className="mt-3 text-[13px] text-ink-2">
          {error}
        </p>
      ) : null}
    </details>
  )
}
