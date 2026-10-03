'use client'

import { useEffect, useEffectEvent, useId, useRef, useState } from 'react'
import { mountPlanScene, type SceneCameraAction } from '@/lib/projects/plan-scene-renderer'
import type { PlanVolume } from '@/lib/projects/plan-volume'
import { PlanVolumeSelection, type VolumeSelection } from './plan-volume-selection'

const cameraButtons: { action: SceneCameraAction; title: string }[] = [
  { action: 'left', title: '↶ Влево' },
  { action: 'right', title: 'Вправо ↷' },
  { action: 'top', title: 'Сверху' },
  { action: 'closer', title: 'Приблизить' },
  { action: 'farther', title: 'Отдалить' },
  { action: 'reset', title: 'Исходный вид' },
]

export default function PlanSceneViewer({
  model,
  projectId,
  onFallback,
}: {
  model: PlanVolume
  projectId?: string
  onFallback: () => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const scene = useRef<ReturnType<typeof mountPlanScene> | null>(null)
  const [failed, setFailed] = useState(false)
  const [ready, setReady] = useState(false)
  const [selection, setSelection] = useState<VolumeSelection>(null)
  const [walls, setWalls] = useState(true)
  const [zones, setZones] = useState(true)
  const [gestures, setGestures] = useState(false)
  const instructionsId = useId()
  const applyCurrentView = useEffectEvent(() => {
    scene.current?.select(selection)
    scene.current?.setWalls(walls)
    scene.current?.setZones(zones)
    scene.current?.setGestures(gestures)
  })

  useEffect(() => {
    if (!canvas.current) return
    try {
      scene.current = mountPlanScene(canvas.current, model, setSelection, () => setFailed(true))
      applyCurrentView()
      setReady(true)
    } catch {
      setFailed(true)
    }
    return () => {
      scene.current?.dispose()
      scene.current = null
    }
  }, [model])

  useEffect(() => {
    scene.current?.select(selection)
  }, [selection])
  useEffect(() => {
    scene.current?.setWalls(walls)
  }, [walls])
  useEffect(() => {
    scene.current?.setZones(zones)
  }, [zones])
  useEffect(() => {
    scene.current?.setGestures(gestures)
  }, [gestures])
  useEffect(() => {
    if (failed) {
      scene.current?.dispose()
      scene.current = null
    }
  }, [failed])

  if (failed)
    return (
      <div className="mt-4 border border-line p-4" role="status">
        <p className="text-sm text-ink-2">
          3D-просмотр сейчас недоступен в этом браузере. Объёмная схема и 2D-план остаются доступны.
        </p>
        <button
          type="button"
          onClick={onFallback}
          className="mt-3 min-h-11 border border-line-strong px-4 py-2 text-sm text-ink hover:border-accent"
        >
          Открыть объёмную схему
        </button>
      </div>
    )

  return (
    <div className="mt-4">
      <fieldset
        className="flex flex-wrap gap-2 border border-line bg-paper p-3"
        aria-label="Управление 3D-сценой"
      >
        {cameraButtons.map(({ action, title }) => (
          <button
            key={action}
            type="button"
            disabled={!ready}
            onClick={() => {
              scene.current?.camera(action)
              if (action === 'reset') setSelection(null)
            }}
            className="min-h-11 border border-line-strong px-3 py-2 text-sm text-ink hover:border-accent focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
          >
            {title}
          </button>
        ))}
        <div className="flex w-full flex-wrap gap-x-5 gap-y-2 border-t border-line pt-3 text-sm text-ink">
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              checked={walls}
              onChange={(event) => setWalls(event.target.checked)}
              className="accent-accent"
            />
            Показать стены
          </label>
          {(model.floorZones?.length ?? 0) > 0 ? (
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                checked={zones}
                onChange={(event) => setZones(event.target.checked)}
                className="accent-accent"
              />
              Зоны из 2D
            </label>
          ) : null}
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              checked={gestures}
              onChange={(event) => setGestures(event.target.checked)}
              className="accent-accent"
            />
            Управлять мышью и жестами
          </label>
        </div>
      </fieldset>
      <PlanVolumeSelection
        model={model}
        selection={selection}
        onSelect={setSelection}
        projectId={projectId}
      />
      <p id={instructionsId} className="border-x border-line px-3 pb-3 text-sm text-ink-2">
        {gestures
          ? 'Вращение — перетаскивание, приближение — колесо или два пальца. Для прокрутки страницы проведите за пределами сцены.'
          : 'Выбирайте комнату или мебель касанием. Для вращения используйте кнопки либо включите управление мышью и жестами.'}
      </p>
      <canvas
        ref={canvas}
        role="img"
        aria-label="3D-сцена планировки квартиры"
        aria-describedby={instructionsId}
        data-scene-ready={ready}
        className="block h-[420px] w-full border border-line bg-paper sm:h-[520px]"
      />
      {!ready ? (
        <p role="status" className="mt-2 text-sm text-ink-2">
          Открываем 3D-сцену…
        </p>
      ) : null}
      <ul className="mt-3 space-y-1 text-sm text-ink-2" aria-label="Мебель в 3D-сцене">
        {(model.furniture ?? []).map((item, index) => (
          <li key={item.id}>
            <button
              type="button"
              aria-pressed={selection?.kind === 'furniture' && selection.id === item.id}
              onClick={() => setSelection({ kind: 'furniture', id: item.id })}
              className={`min-h-11 w-full border-l-2 px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-accent ${selection?.kind === 'furniture' && selection.id === item.id ? 'border-accent bg-accent-tint text-ink' : 'border-transparent hover:bg-accent-tint'}`}
            >
              {index + 1}. {item.title}
              {item.heightCm === undefined
                ? ' · высоту нужно уточнить'
                : ` · высота ${item.heightCm} см`}
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs leading-relaxed text-ink-2">
        Пол, проёмы и габариты мебели перенесены из проверенной схемы без новой расстановки. Мебель
        показана габаритными блоками, не точными моделями изделий. Стены без высоты и проёмы без
        вертикальных мерок отмечены только на полу; мебель без высоты — плоским пунктирным контуром.
        Толщина стен показана только там, где она отдельно сверена. Зоны использования и препятствия
        отмечены на полу; предварительные запасы уточняются по данным изделия. Проверки проходов
        смотрите на 2D-плане.
      </p>
      {model.layoutNote ? <p className="mt-2 text-xs text-ink-2">{model.layoutNote}</p> : null}
      {model.issues.length > 0 ? (
        <ul className="mt-2 list-inside list-disc text-xs text-ink-2">
          {model.issues.map((issue) => (
            <li key={issue.id}>{issue.message}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
