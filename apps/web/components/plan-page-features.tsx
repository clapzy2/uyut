// biome-ignore-all lint/suspicious/noArrayIndexKey: locked room boundary retains ordered edge indices
'use client'

import type { PlanPageOpeningCheck } from '@uyut/db'
import { Button, inputClassName } from '@uyut/ui'
import { useState } from 'react'
import type {
  PageContourDraft,
  PageContourTarget,
  PageObstacleDraft,
  PageOpeningDraft,
} from './plan-page-contour-editor-model'
import { canAddPageFeature } from './plan-page-contour-editor-model'

export const pageFeatureLabels = {
  door: 'Дверной проём',
  window: 'Окно',
  balcony: 'Балконный проём',
  shaft: 'Шахта или короб',
  column: 'Колонна',
  fixed: 'Неподвижный объект',
}
export type NewPageFeatureKind = keyof typeof pageFeatureLabels

export function PlanPageFeatures({
  draft,
  target,
  locked,
  onSelect,
  onAdd,
  onRemove,
  onChangeEdge,
  sourceCheck,
}: {
  draft?: PageContourDraft
  target: PageContourTarget
  locked: boolean
  onSelect: (target: PageContourTarget) => void
  onAdd: (kind: NewPageFeatureKind) => void
  onRemove: () => void
  onChangeEdge: (index: number) => void
  sourceCheck?: PlanPageOpeningCheck
}) {
  const [newKind, setNewKind] = useState<NewPageFeatureKind>('door')
  const [confirmRemoval, setConfirmRemoval] = useState(false)
  const selected = target.kind === 'room' ? 'room' : `${target.kind}:${target.id}`
  const opening =
    target.kind === 'opening' ? draft?.openings?.find((item) => item.id === target.id) : undefined
  const features: Array<{
    type: 'opening' | 'obstacle'
    feature: PageOpeningDraft | PageObstacleDraft
  }> = [
    ...(draft?.openings ?? []).map((feature) => ({ type: 'opening' as const, feature })),
    ...(draft?.obstacles ?? []).map((feature) => ({ type: 'obstacle' as const, feature })),
  ]

  return (
    <div className="space-y-3 border-l-2 border-accent pl-3">
      <label className="block space-y-1 text-sm">
        <span className="block">Что размечаем в этой комнате</span>
        <select
          className={inputClassName}
          value={selected}
          disabled={locked}
          onChange={(event) => {
            setConfirmRemoval(false)
            const value = event.target.value
            const feature = features.find((item) => `${item.type}:${item.feature.id}` === value)
            onSelect(feature ? { kind: feature.type, id: feature.feature.id } : { kind: 'room' })
          }}
        >
          <option value="room">Внутренняя граница комнаты</option>
          {features.map(({ type, feature }, index) => (
            <option key={feature.id} value={`${type}:${feature.id}`}>
              {pageFeatureLabels[feature.kind]} · {index + 1}
            </option>
          ))}
        </select>
      </label>
      {opening ? (
        <label className="block space-y-1 text-sm">
          <span className="block">Сторона контура, на которой находится проём</span>
          <select
            className={inputClassName}
            value={opening.wallEdgeIndex}
            disabled={locked}
            onChange={(event) => onChangeEdge(Number(event.target.value))}
          >
            {draft?.polygon.map((_, index) => (
              <option key={`edge-${index + 1}`} value={index}>
                Сторона {index + 1}: вершина {index + 1} →{' '}
                {index + 2 > draft.polygon.length ? 1 : index + 2}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <p className="text-xs leading-relaxed text-ink-2">
        {target.kind === 'opening'
          ? 'Отметьте два конца проёма на внутренней границе выбранной стороны. Вид проёма сверяйте с листом; высоту и открывание добавляют по отдельным данным.'
          : target.kind === 'obstacle'
            ? 'Обведите объект внутри комнаты. Шахты в толще стены не переносите на свободный пол. Размеры в сантиметрах проверяются отдельно.'
            : 'Номера сторон идут по порядку вершин контура. Сначала замкните комнату, затем добавьте её проёмы и неподвижные объекты.'}
      </p>
      {target.kind === 'opening' ? (
        <p className="text-sm leading-relaxed text-ink-2">
          {sourceCheck?.status === 'candidate'
            ? `Ширина по подписанной линии PDF: ${sourceCheck.widthMm} мм. Положение, чистовой обмер и открывание проверяются отдельно.`
            : sourceCheck
              ? 'Ширина пока для уточнения: однозначная подписанная линия не найдена. Разметка сохранена без подстановки размера.'
              : 'После сохранения сверим подписанную ширину по линиям этого PDF. Дополнительный AI-запрос не нужен.'}
        </p>
      ) : null}
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 space-y-1 text-xs text-ink-2">
          <span className="block">Новый объект на листе</span>
          <select
            className={inputClassName}
            value={newKind}
            disabled={locked || !draft?.closed}
            onChange={(event) => setNewKind(event.target.value as NewPageFeatureKind)}
          >
            {Object.entries(pageFeatureLabels).map(([kind, label]) => (
              <option key={kind} value={kind}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <Button
          size="sm"
          variant="secondary"
          disabled={locked || !canAddPageFeature(draft, newKind)}
          onClick={() => {
            setConfirmRemoval(false)
            onAdd(newKind)
          }}
        >
          Добавить объект
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={locked || !draft}
          onClick={() => setConfirmRemoval(true)}
        >
          {target.kind === 'room' ? 'Удалить комнату и её разметку' : 'Удалить выбранный объект'}
        </Button>
        {confirmRemoval ? (
          <>
            <span className="text-xs text-ink-2">Изменение применится после сохранения листа.</span>
            <Button
              size="sm"
              variant="secondary"
              disabled={locked}
              onClick={() => {
                setConfirmRemoval(false)
                onRemove()
              }}
            >
              Подтвердить удаление
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={locked}
              onClick={() => setConfirmRemoval(false)}
            >
              Отмена
            </Button>
          </>
        ) : null}
      </div>
    </div>
  )
}
