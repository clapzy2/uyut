'use client'

import dynamic from 'next/dynamic'
import { useId, useState } from 'react'
import type { PlanVolume } from '@/lib/projects/plan-volume'

const PlanVolumeViewer = dynamic(() => import('./plan-volume-viewer'), {
  loading: () => <p className="mt-4 text-sm text-ink-2">Открываем объёмную схему…</p>,
})

const PlanSceneViewer = dynamic(() => import('./plan-scene-viewer'), {
  ssr: false,
  loading: () => <p className="mt-4 text-sm text-ink-2">Загружаем 3D-просмотр…</p>,
})

export function PlanVolumeLaunch({
  model,
  projectId,
  humanReviewedPairCount = 0,
}: {
  model: PlanVolume
  projectId?: string
  humanReviewedPairCount?: number
}) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'scheme' | 'scene'>('scheme')
  const viewerId = useId()

  return (
    <section aria-label="Объёмный просмотр" className="mt-6 border-t border-line pt-5">
      {humanReviewedPairCount > 0 ? (
        <p className="mb-3 text-sm leading-relaxed text-ink-2">
          Связи граней стен в этой модели сверены человеком: {humanReviewedPairCount}. Владелец
          сопоставил две стороны каждой такой стены на исходном PDF.
        </p>
      ) : null}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? viewerId : undefined}
        onClick={() => setOpen((value) => !value)}
        className="min-h-11 border border-line-strong px-4 py-2 text-sm text-ink transition-colors hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
      >
        {open
          ? 'Скрыть объёмную схему'
          : model.wallSource === 'room-layout'
            ? model.furniture?.length
              ? 'Посмотреть мебель в объёме'
              : 'Посмотреть контур в объёме'
            : model.wallSource === 'pdf-faces'
              ? model.walls.length === 0
                ? 'Посмотреть подтверждённый пол в объёме'
                : 'Посмотреть проверенные грани в объёме'
              : 'Посмотреть объёмную схему'}
      </button>
      {open ? (
        <div id={viewerId}>
          <fieldset className="mt-4 flex flex-wrap gap-2" aria-label="Режим объёмного просмотра">
            <button
              type="button"
              aria-pressed={view === 'scheme'}
              onClick={() => setView('scheme')}
              className="min-h-11 border border-line-strong px-4 py-2 text-sm text-ink hover:border-accent aria-pressed:border-accent aria-pressed:bg-accent-tint"
            >
              Объёмная схема
            </button>
            <button
              type="button"
              aria-pressed={view === 'scene'}
              onClick={() => setView('scene')}
              className="min-h-11 border border-line-strong px-4 py-2 text-sm text-ink hover:border-accent aria-pressed:border-accent aria-pressed:bg-accent-tint"
            >
              3D-сцена
            </button>
          </fieldset>
          {view === 'scene' ? (
            <PlanSceneViewer
              model={model}
              projectId={projectId}
              onFallback={() => setView('scheme')}
            />
          ) : (
            <PlanVolumeViewer model={model} projectId={projectId} />
          )}
        </div>
      ) : null}
    </section>
  )
}
