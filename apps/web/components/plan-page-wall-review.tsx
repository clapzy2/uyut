'use client'

import type { PlanReading } from '@uyut/db'
import { Button } from '@uyut/ui'
import { useState } from 'react'
import {
  getPlanWallReviewCandidates,
  revokePlanWallReview,
  savePlanWallReview,
} from '@/actions/plan-wall-review'
import type { HumanWallReviewOption } from '@/lib/projects/plan-human-wall-review'
import { FormError } from './form-error'

export function PlanPageWallReview({
  projectId,
  sourceRevision,
  disabled,
  onHighlight,
  onSaved,
  onConflict,
}: {
  projectId: string
  sourceRevision: string
  disabled: boolean
  onHighlight: (candidate: HumanWallReviewOption | undefined) => void
  onSaved: (data: { reading: PlanReading; revision: string }) => void
  onConflict: () => void
}) {
  const [candidates, setCandidates] = useState<HumanWallReviewOption[]>()
  const [selectedId, setSelectedId] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const [reviews, setReviews] = useState<{ id: string; reviewedAt: string; current: boolean }[]>([])
  const selected = candidates?.find((candidate) => candidate.id === selectedId)
  async function load() {
    setPending(true)
    setError(undefined)
    setAcknowledged(false)
    setSelectedId('')
    setCandidates(undefined)
    onHighlight(undefined)
    try {
      const result = await getPlanWallReviewCandidates(projectId, sourceRevision)
      if (!result.ok) {
        if (result.code === 'plan-conflict') onConflict()
        setError(result.error)
      } else {
        setCandidates(result.data.candidates)
        setReviews(result.data.reviews ?? [])
        setSelectedId('')
      }
    } catch {
      setError('Не удалось получить пары граней. Повторите загрузку.')
    } finally {
      setPending(false)
    }
  }
  async function save() {
    if (!selected || !acknowledged) return
    setPending(true)
    setError(undefined)
    try {
      const result = await savePlanWallReview(
        projectId,
        { candidateId: selected.id, acknowledged: true },
        sourceRevision,
      )
      if (!result.ok) {
        if (result.code === 'plan-conflict') onConflict()
        setError(result.error)
      } else {
        onHighlight(undefined)
        onSaved(result.data)
      }
    } catch {
      setError(
        'Ответ сервера не получен. Закройте разметку и проверьте сохранённую схему перед повторной сверкой.',
      )
    } finally {
      setPending(false)
    }
  }
  async function revoke(reviewId: string) {
    setPending(true)
    setError(undefined)
    try {
      const result = await revokePlanWallReview(projectId, { reviewId }, sourceRevision)
      if (!result.ok) {
        if (result.code === 'plan-conflict') onConflict()
        setError(result.error)
      } else {
        onHighlight(undefined)
        onSaved(result.data)
      }
    } catch {
      setError('Не удалось снять сверку. Откройте актуальную схему и проверьте её состояние.')
    } finally {
      setPending(false)
    }
  }
  const faceLabel = (face: HumanWallReviewOption['pair']['faces'][number]) =>
    `${face.contourKey === 'exterior' ? 'Наружный контур' : `Комната ${face.contourKey}`}, ребро ${face.wallEdgeIndex + 1}`
  return (
    <section aria-label="Ручная сверка пары граней" className="space-y-3 border border-line p-4">
      <p className="text-sm font-medium text-ink">Сопоставить две грани стены</p>
      <p className="text-xs leading-relaxed text-ink-2">
        Выберите пару исходных линий и сверьте обе с PDF. Связь сохранится с отметкой «сверено
        человеком». Высота, толщина и уровень пола задаются отдельно. Сначала сохраните изменения
        обводки, если они есть.
      </p>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={disabled || pending}
        pending={pending && !selected}
        onClick={load}
      >
        Показать пары для сверки
      </Button>
      {candidates?.length === 0 ? (
        <p className="text-xs text-ink-2">
          Для текущей обводки не найдено новых пар исходных граней. Сверьте контуры и обновите
          2D-черновик.
        </p>
      ) : null}
      {reviews.length ? (
        <div className="space-y-2 border-t border-line pt-3">
          <p className="text-sm text-ink">Сохранённые ручные сверки</p>
          {reviews.map((review, index) => (
            <div
              key={review.id}
              className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-2"
            >
              <span>
                Пара {index + 1}: {review.current ? 'сверено человеком' : 'нужна повторная сверка'}
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={disabled || pending}
                onClick={() => revoke(review.id)}
              >
                Снять сверку
              </Button>
            </div>
          ))}
        </div>
      ) : null}
      {candidates?.length ? (
        <div className="max-h-48 space-y-2 overflow-auto">
          {candidates.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              disabled={disabled || pending}
              aria-pressed={selectedId === candidate.id}
              onClick={() => {
                setSelectedId(candidate.id)
                setAcknowledged(false)
                onHighlight(candidate)
              }}
              className="block min-h-11 w-full border border-line px-3 py-2 text-left text-sm text-accent aria-pressed:bg-muted"
            >
              {candidate.pair.faces.map(faceLabel).join(' + ')}
              <span className="mt-1 block text-xs text-ink-2">
                Участок на листе: ({candidate.pair.faces[0].start.x.toFixed(1)},{' '}
                {candidate.pair.faces[0].start.y.toFixed(1)}) - (
                {candidate.pair.faces[0].end.x.toFixed(1)},{' '}
                {candidate.pair.faces[0].end.y.toFixed(1)})
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {selected ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled || pending}
              onClick={() => onHighlight(selected)}
            >
              Показать выбранные грани
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled || pending}
              onClick={() => onHighlight(undefined)}
            >
              Скрыть подсветку
            </Button>
          </div>
          <p className="text-xs leading-relaxed text-ink-2">
            Обе выбранные грани показаны на исходном листе синим.{' '}
            {selected.visibilityIssues.length
              ? 'Автоматическая проверка видимости оставила эту пару неподтверждённой; проверьте линии и наложения на изображении.'
              : 'Сверьте, что линии относятся к двум сторонам одной стены.'}
          </p>
          <label className="flex min-h-11 items-start gap-3 text-sm leading-relaxed">
            <input
              type="checkbox"
              className="mt-1 size-4 shrink-0 accent-accent"
              checked={acknowledged}
              disabled={disabled || pending}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            <span>
              Сверил обе грани на этом PDF: это две стороны одной стены; между ними нет пола
              помещения или проёма.
            </span>
          </label>
          <Button
            type="button"
            size="sm"
            pending={pending}
            disabled={disabled || pending || !acknowledged}
            onClick={save}
          >
            Сохранить как сверенное человеком
          </Button>
        </div>
      ) : null}
      <FormError message={error} />
    </section>
  )
}
