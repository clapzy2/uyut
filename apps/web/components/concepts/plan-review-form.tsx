'use client'

import type { ConceptPlanReview, PlanReviewVerdict } from '@uyut/db'
import { toast } from '@uyut/ui'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { savePlanReview } from '@/actions/plan-review'

const choices: Array<{ value: PlanReviewVerdict; label: string }> = [
  { value: 'unrated', label: 'Не оценено' },
  { value: 'matches', label: 'Видно совпадение' },
  { value: 'conflicts', label: 'Видно противоречие' },
  { value: 'not_visible', label: 'Ракурс не позволяет проверить' },
]

export function PlanReviewForm({
  conceptId,
  sourceHash,
  openingLabels,
  review,
}: {
  conceptId: string
  sourceHash: string
  openingLabels: string[]
  review: ConceptPlanReview | null
}) {
  const router = useRouter()
  const [shape, setShape] = useState<PlanReviewVerdict>(review?.shape ?? 'unrated')
  const [openings, setOpenings] = useState<PlanReviewVerdict[]>(
    openingLabels.map((_, index) => review?.openings[index] ?? 'unrated'),
  )
  const [extraOpenings, setExtraOpenings] = useState<PlanReviewVerdict>(
    review?.extraOpenings ?? 'unrated',
  )
  const [saving, setSaving] = useState(false)

  async function save() {
    if (
      shape === 'unrated' &&
      openings.every((value) => value === 'unrated') &&
      extraOpenings === 'unrated'
    ) {
      toast({ title: 'Отметьте хотя бы один пункт.', tone: 'danger' })
      return
    }
    setSaving(true)
    try {
      const result = await savePlanReview(conceptId, sourceHash, {
        shape,
        openings,
        extraOpenings,
      })
      if (!result.ok) {
        toast({ title: result.error, tone: 'danger' })
        return
      }
      toast({ title: 'Сверка сохранена', tone: 'success' })
      router.refresh()
    } catch {
      toast({ title: 'Не получилось сохранить сверку. Попробуйте ещё раз.', tone: 'danger' })
    } finally {
      setSaving(false)
    }
  }

  const fields = [
    { label: 'Форма комнаты', value: shape, onChange: setShape, options: choices },
    ...openingLabels.map((label, index) => ({
      label,
      value: openings[index] ?? 'unrated',
      options: choices,
      onChange: (value: PlanReviewVerdict) =>
        setOpenings((current) =>
          current.map((item, itemIndex) => (itemIndex === index ? value : item)),
        ),
    })),
    {
      label: 'Проёмы, которых нет на плане',
      value: extraOpenings,
      onChange: setExtraOpenings,
      options: [
        { value: 'unrated' as const, label: 'Не оценено' },
        { value: 'matches' as const, label: 'Лишних проёмов не видно' },
        { value: 'conflicts' as const, label: 'Виден лишний проём' },
        { value: 'not_visible' as const, label: 'Ракурс не позволяет проверить' },
      ],
    },
  ]

  return (
    <div className="mt-6 border-t border-line pt-5">
      <h3 className="font-serif text-xl text-ink">Что видно на рендере?</h3>
      <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-2">
        Отмечайте только то, что можно различить на картинке. Скрытый за камерой проём — «ракурс не
        позволяет проверить», а не ошибка.
      </p>
      <div className="mt-4 grid gap-x-8 gap-y-3 md:grid-cols-2">
        {fields.map((field) => (
          <label key={field.label} className="flex flex-col gap-1.5 text-[13px] text-ink">
            <span>{field.label}</span>
            <select
              value={field.value}
              onChange={(event) => field.onChange(event.currentTarget.value as PlanReviewVerdict)}
              className="h-10 border border-control bg-paper px-3 text-[13px] text-ink outline-none transition-colors focus:border-accent"
            >
              {field.options.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="min-h-10 border border-accent bg-accent px-4 text-[13px] font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          {saving ? 'Сохраняем…' : 'Сохранить сверку'}
        </button>
        {review ? (
          <span className="text-[12px] text-ink-2">
            Последняя сверка: {new Date(review.reviewedAt).toLocaleDateString('ru-RU')}
          </span>
        ) : null}
      </div>
    </div>
  )
}
