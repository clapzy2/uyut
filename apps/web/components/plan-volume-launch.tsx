'use client'

import dynamic from 'next/dynamic'
import { useState } from 'react'
import type { PlanVolume } from '@/lib/projects/plan-volume'

const PlanVolumeViewer = dynamic(() => import('./plan-volume-viewer'), {
  loading: () => <p className="mt-4 text-sm text-ink-2">Открываем объёмную схему…</p>,
})

export function PlanVolumeLaunch({ model, projectId }: { model: PlanVolume; projectId?: string }) {
  const [open, setOpen] = useState(false)

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
      {open ? <PlanVolumeViewer model={model} projectId={projectId} /> : null}
    </div>
  )
}
