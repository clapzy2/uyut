'use client'

import dynamic from 'next/dynamic'
import { useState } from 'react'
import type { PlanVolume } from '@/lib/projects/plan-volume'

const PlanVolumeViewer = dynamic(() => import('./plan-volume-viewer'), {
  loading: () => <p className="mt-4 text-sm text-ink-2">Открываем объёмную схему…</p>,
})

const PlanSceneViewer = dynamic(() => import('./plan-scene-viewer'), {
  ssr: false,
  loading: () => <p className="mt-4 text-sm text-ink-2">Загружаем 3D-просмотр…</p>,
})

export function PlanVolumeLaunch({ model, projectId }: { model: PlanVolume; projectId?: string }) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'scheme' | 'scene'>('scheme')

  return (
    <div className="mt-6 border-t border-line pt-5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="border border-line-strong px-4 py-2 text-sm text-ink transition-colors hover:border-accent hover:text-accent"
      >
        {open
          ? 'Скрыть объёмную схему'
          : model.wallSource === 'room-layout'
            ? 'Посмотреть мебель в объёме'
            : model.wallSource === 'pdf-faces'
              ? 'Посмотреть проверенные грани в объёме'
              : 'Посмотреть объёмную схему'}
      </button>
      {open ? (
        <>
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
        </>
      ) : null}
    </div>
  )
}
