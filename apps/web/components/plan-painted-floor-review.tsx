'use client'

import type { PlanReading } from '@uyut/db'
import { Button, inputClassName } from '@uyut/ui'
import { useState } from 'react'
import {
  proposePlanPaintedFloorReview,
  savePlanPaintedFloorReview,
} from '@/actions/plan-painted-floor-review'
import type { ReviewedNativePaintedFloors } from '@/lib/projects/plan-native-painted-floor-review'

const boundaryRoles = {
  unresolved: 'Не определена',
  'wall-face': 'Возможная грань стены',
  'opening-boundary': 'Возможная граница проёма',
  'level-separator': 'Возможный перепад уровня',
} as const

type BoundaryRole = keyof typeof boundaryRoles

function editableFloorReview(json: string): ReviewedNativePaintedFloors | null {
  if (json.length > 64 * 1024) return null
  try {
    const review: unknown = JSON.parse(json)
    if (
      !review ||
      typeof review !== 'object' ||
      !('review' in review) ||
      review.review !== 'manual-native-painted-floor-review' ||
      !('floors' in review) ||
      !('source' in review) ||
      !review.source ||
      typeof review.source !== 'object' ||
      !('sha256' in review.source) ||
      typeof review.source.sha256 !== 'string' ||
      !('pdfPage' in review.source) ||
      !Number.isInteger(review.source.pdfPage) ||
      !('state' in review.source) ||
      review.source.state !== 'existing' ||
      !('rasterSource' in review) ||
      !review.rasterSource ||
      typeof review.rasterSource !== 'object' ||
      !('sha256' in review.rasterSource) ||
      typeof review.rasterSource.sha256 !== 'string' ||
      !('page' in review.rasterSource) ||
      !Number.isInteger(review.rasterSource.page) ||
      !('width' in review.rasterSource) ||
      !Number.isFinite(review.rasterSource.width) ||
      !('height' in review.rasterSource) ||
      !Number.isFinite(review.rasterSource.height)
    )
      return null
    const floors = review.floors
    if (!Array.isArray(floors) || floors.length > 50) return null
    for (const floor of floors) {
      if (
        !floor ||
        typeof floor !== 'object' ||
        typeof floor.candidateId !== 'string' ||
        !Number.isInteger(floor.pieceIndex) ||
        !floor.owner ||
        typeof floor.owner !== 'object' ||
        typeof floor.owner.sourceRoomKey !== 'string' ||
        !Array.isArray(floor.polygon) ||
        floor.polygon.length < 3 ||
        !Array.isArray(floor.boundaryRoles) ||
        floor.polygon.length !== floor.boundaryRoles.length ||
        floor.boundaryRoles.length > 100 ||
        floor.boundaryRoles.some(
          (role: unknown, index: number) =>
            !role ||
            typeof role !== 'object' ||
            !('edgeIndex' in role) ||
            role.edgeIndex !== index ||
            !('kind' in role) ||
            typeof role.kind !== 'string' ||
            !(role.kind in boundaryRoles),
        )
      )
        return null
    }
    return review as ReviewedNativePaintedFloors
  } catch {
    return null
  }
}

export function changePaintedFloorBoundaryRole(
  json: string,
  floorIndex: number,
  edgeIndex: number,
  role: BoundaryRole,
): string | null {
  const review = editableFloorReview(json)
  if (!review || !(role in boundaryRoles)) return null
  const edge = review.floors[floorIndex]?.boundaryRoles[edgeIndex]
  if (!edge) return null
  edge.kind = role
  return JSON.stringify(review, null, 2)
}

/** Explicit advanced source selection, never an automatic floor/measurement confirmation. */
export function PlanPaintedFloorReviewEditor({
  projectId,
  revision,
  savedJson,
  disabled,
  onSaved,
  onConflict,
  onProposalChange,
  highlightedBoundary,
  onHighlightBoundary,
}: {
  projectId: string
  revision: string
  savedJson?: string
  disabled?: boolean
  onSaved: (result: { reading: PlanReading; revision: string }) => void
  onConflict: () => void
  onProposalChange?: (proposal: ReviewedNativePaintedFloors | null) => void
  highlightedBoundary?: { floorIndex: number; edgeIndex: number } | null
  onHighlightBoundary?: (edge: { floorIndex: number; edgeIndex: number } | null) => void
}) {
  const [json, setJson] = useState(savedJson ?? '')
  const [acknowledged, setAcknowledged] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const [proposalNote, setProposalNote] = useState<string>()
  const [proposalRooms, setProposalRooms] = useState<string[]>([])
  const editableReview = editableFloorReview(json)

  function changeBoundaryRole(floorIndex: number, edgeIndex: number, role: BoundaryRole) {
    const updated = changePaintedFloorBoundaryRole(json, floorIndex, edgeIndex, role)
    if (!updated) return
    setJson(updated)
    onProposalChange?.(editableFloorReview(updated))
    setAcknowledged(false)
  }
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
      onHighlightBoundary?.(null)
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
      onHighlightBoundary?.(null)
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
        <div className="mt-3 text-[13px] leading-relaxed text-ink-2">
          <p>Предложенные помещения:</p>
          <ul className="mt-1 list-disc pl-5">
            {proposalRooms.map((room) => (
              <li key={room}>{room}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {editableReview?.floors.length ? (
        <details className="mt-3 border-t border-line pt-2">
          <summary className="min-h-11 cursor-pointer py-2 text-[13px] font-medium">
            Роли граней выбранных областей
          </summary>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
            Выбирайте роль только после сравнения каждой грани с исходным листом. Это ваша отметка
            для дальнейшей проверки, не доказательство физической стены, косяка или перепада.
            Неясные грани оставляйте неопределёнными. Изменение снимает отметку сверки ниже.
          </p>
          {onHighlightBoundary ? (
            <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
              Откройте проверку исходного листа выше и нажмите «Показать» у грани: она выделится
              поверх PDF, если источник и версия совпадают.
            </p>
          ) : null}
          {editableReview.floors.map((floor, floorIndex) => (
            <fieldset
              key={`${floor.candidateId}:${floor.pieceIndex}`}
              className="mt-3 border-t border-line pt-2"
            >
              <legend className="text-[13px] font-medium">
                № {floor.owner.sourceRoomKey} · область {floor.candidateId}, фрагмент{' '}
                {floor.pieceIndex + 1}
              </legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {floor.boundaryRoles.map((boundary, edgeIndex) => (
                  <div
                    key={boundary.edgeIndex}
                    className="flex min-h-11 flex-wrap items-center justify-between gap-2 text-[13px]"
                  >
                    {onHighlightBoundary ? (
                      <button
                        type="button"
                        className="underline decoration-line underline-offset-4"
                        aria-pressed={
                          highlightedBoundary?.floorIndex === floorIndex &&
                          highlightedBoundary.edgeIndex === edgeIndex
                        }
                        onClick={() =>
                          onHighlightBoundary(
                            highlightedBoundary?.floorIndex === floorIndex &&
                              highlightedBoundary.edgeIndex === edgeIndex
                              ? null
                              : { floorIndex, edgeIndex },
                          )
                        }
                      >
                        Показать грань {edgeIndex + 1} на листе
                      </button>
                    ) : (
                      <span>Грань {edgeIndex + 1}</span>
                    )}
                    <label className="flex items-center gap-2">
                      Роль грани {edgeIndex + 1}
                      <select
                        className={`${inputClassName} min-w-0 max-w-[14rem] text-[13px]`}
                        value={boundary.kind}
                        disabled={disabled || pending}
                        onChange={(event) =>
                          changeBoundaryRole(
                            floorIndex,
                            edgeIndex,
                            event.target.value as BoundaryRole,
                          )
                        }
                      >
                        {Object.entries(boundaryRoles).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                ))}
              </div>
            </fieldset>
          ))}
        </details>
      ) : null}
      <details className="mt-3 border-t border-line pt-2">
        <summary className="min-h-11 cursor-pointer py-2 text-[13px] font-medium">
          Технические данные и ручная правка
        </summary>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
          Для каждой области нужны candidateId, pieceIndex, исходные polygon/holes, owner с
          sourceRoomKey и двумя идентификаторами подписей, а также boundaryRoles для каждой внешней
          грани. Неизвестную роль оставляйте unresolved; торец профиля не назначайте косяком. Снимок
          должен содержать исходный PDF и rasterSource выбранного листа. Лимит — 64 КиБ.
        </p>
        <label className="mt-3 block text-[13px]">
          JSON выбора областей пола
          <textarea
            className={`${inputClassName} mt-2 min-h-40 w-full font-mono text-[12px]`}
            value={json}
            onChange={(event) => {
              setJson(event.target.value)
              onProposalChange?.(null)
              onHighlightBoundary?.(null)
              setAcknowledged(false)
              setProposalNote(undefined)
              setProposalRooms([])
            }}
            disabled={disabled || pending}
            spellCheck={false}
          />
        </label>
      </details>
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
