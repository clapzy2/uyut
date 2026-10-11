'use client'

import type { PlanGeometry } from '@uyut/db'
import { useId, useMemo, useState } from 'react'
import { deliveryVolumeScene, projectDeliveryVolume } from '@/lib/projects/plan-delivery-volume'
import type { FurnitureDeliveryResult } from '@/lib/projects/plan-furniture-delivery'
import type { FurnitureDeliveryReportRequest } from '@/lib/projects/plan-furniture-delivery-report'
import { DEFAULT_VOLUME_TILT, type VolumeScreenPoint } from '@/lib/projects/plan-volume-camera'

const points = (ring: VolumeScreenPoint[]) => ring.map((point) => `${point.x},${point.y}`).join(' ')
const ringPath = (ring: VolumeScreenPoint[]) =>
  `M ${ring.map((point) => `${point.x} ${point.y}`).join(' L ')} Z`
const stageNames = {
  lift: 'Подъём',
  translate: 'Перемещение',
  lower: 'Опускание',
  tilt: 'Наклон',
  untilt: 'Возврат в вертикальную позу',
  turn: 'Поворот',
}

export default function PlanDeliveryVolume({
  geometry,
  request,
  result,
}: {
  geometry: PlanGeometry
  request: FurnitureDeliveryReportRequest
  result: FurnitureDeliveryResult
}) {
  const titleId = useId()
  const [selection, setSelection] = useState({ result, index: 0 })
  const [angle, setAngle] = useState(0)
  const [tilt, setTilt] = useState(DEFAULT_VOLUME_TILT)
  const [zoom, setZoom] = useState(1)
  const scene = useMemo(
    () => deliveryVolumeScene(geometry, request, result),
    [geometry, request, result],
  )
  const index = selection.result === result ? selection.index : 0
  const drawing = useMemo(
    () => (scene ? projectDeliveryVolume(scene, index, angle, tilt, zoom) : null),
    [scene, index, angle, tilt, zoom],
  )
  const stage = scene?.stages[index]
  if (!scene || !drawing || !stage)
    return (
      <p role="status" className="mt-4 text-sm text-ink-2">
        3D маршрута недоступен: нужны актуальные сверенные уровни и полный расчёт заноса.
      </p>
    )
  const select = (value: number) =>
    setSelection({ result, index: Math.max(0, Math.min(scene.stages.length - 1, value)) })
  return (
    <section className="mt-6 border-t border-line pt-4" aria-labelledby={titleId}>
      <h4 id={titleId} className="font-medium text-ink">
        Маршрут заноса в 3D
      </h4>
      <p className="mt-1 text-sm leading-relaxed text-ink-2">
        Показ проверенных объёмов, не физическая симуляция доставки. Z в сантиметрах от сверенного
        общего нуля: {scene.datum}.
      </p>
      <svg
        role="img"
        aria-label="Полный маршрут на уровнях пола и проверенный объём выбранного этапа лестницы"
        viewBox={drawing.viewBox}
        className="mt-3 block w-full border border-line"
        style={{ height: 'min(65vw, 440px)', minHeight: 240 }}
      >
        <title>Маршрут заноса с абсолютными отметками высоты</title>
        {drawing.surfaces.map((surface) => (
          <path
            key={surface.id}
            d={surface.rings.map(ringPath).join(' ')}
            fillRule="evenodd"
            fill={
              surface.kind === 'stair'
                ? '#94a88b'
                : surface.kind === 'exterior'
                  ? '#baa782'
                  : '#a59a8c'
            }
            fillOpacity="0.35"
            stroke="currentColor"
            strokeOpacity="0.4"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          >
            <title>
              {surface.title}: Z{' '}
              {scene.surfaces.find((item) => item.id === surface.id)?.rings[0]?.[0]?.zCm} см
            </title>
          </path>
        ))}
        {drawing.leaves.map((leaf) => (
          <polygon
            key={leaf.id}
            points={points(leaf.points)}
            fill="#c19a6b"
            fillOpacity="0.1"
            stroke="#c19a6b"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {drawing.routes.map((route) => (
          <polyline
            key={route.id}
            points={points(route.points)}
            fill="none"
            stroke={route.id === 'exterior' ? '#bd995a' : '#63865d'}
            strokeWidth="3"
            vectorEffect="non-scaling-stroke"
          >
            <title>
              {route.id === 'exterior'
                ? 'Наружный занос'
                : route.id === 'stairs'
                  ? 'Лестница'
                  : route.id === 'entry'
                    ? 'От двери до лестницы'
                    : 'От лестницы до комнаты'}
            </title>
          </polyline>
        ))}
        {drawing.sweep.map((face) => (
          <polygon
            key={points(face)}
            points={points(face)}
            fill="#d58a98"
            fillOpacity="0.12"
            stroke="#d58a98"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <p className="mt-2 text-xs leading-relaxed text-ink-2">
        Зелёный — весь внутренний путь, охра — наружный участок и створки, розовый — консервативный
        проверенный объём этапа лестницы. Полы показаны только на сверенных уровнях, пустоты не
        залиты. Между точками нет придуманной анимации мебели.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-ghost min-h-11"
          disabled={index === 0}
          onClick={() => select(index - 1)}
        >
          Предыдущий этап
        </button>
        <button
          type="button"
          className="btn-ghost min-h-11"
          disabled={index === scene.stages.length - 1}
          onClick={() => select(index + 1)}
        >
          Следующий этап
        </button>
      </div>
      <label className="mt-3 block text-sm">
        Этап лестницы {index + 1} из {scene.stages.length}
        <input
          type="range"
          min="0"
          max={scene.stages.length - 1}
          value={index}
          onChange={(event) => select(Number(event.target.value))}
          className="mt-1 block min-h-11 w-full"
        />
      </label>
      <p aria-live="polite" className="text-sm leading-relaxed text-ink-2">
        {stageNames[stage.kind]}: ({stage.from.xCm}, {stage.from.yCm}, {stage.from.zCm}) → (
        {stage.to.xCm}, {stage.to.yCm}, {stage.to.zCm}) см. Проверенный объём по Z:{' '}
        {stage.bounds.bottomElevationCm}…{stage.bounds.topElevationCm} см.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <label className="text-sm">
          Поворот вида, °
          <input
            aria-label="Поворот вида, градусы"
            type="range"
            min="0"
            max="360"
            value={angle}
            onChange={(event) => setAngle(Number(event.target.value))}
            className="block min-h-11 w-full"
          />
        </label>
        <label className="text-sm">
          Наклон вида, °
          <input
            aria-label="Наклон вида, градусы"
            type="range"
            min="15"
            max="80"
            value={tilt}
            onChange={(event) => setTilt(Number(event.target.value))}
            className="block min-h-11 w-full"
          />
        </label>
        <label className="text-sm">
          Масштаб вида
          <input
            aria-label="Масштаб вида"
            type="range"
            min="0.6"
            max="2"
            step="0.1"
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
            className="block min-h-11 w-full"
          />
        </label>
      </div>
    </section>
  )
}
