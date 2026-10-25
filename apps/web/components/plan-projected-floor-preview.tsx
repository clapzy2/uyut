'use client'

import {
  type ProjectedFloorPreview,
  projectFloorPreviewPoint,
} from '@uyut/catalog/plan-projected-floor-preview'
import { Button } from '@uyut/ui'
import { useState } from 'react'

const colors = ['#c6a777', '#8eae9a', '#91a8c5', '#c795a2', '#ad98bf', '#c7b364', '#82b6b9']
const number = new Intl.NumberFormat('ru', { maximumFractionDigits: 6 })

export function PlanProjectedFloorPreview({ model }: { model: ProjectedFloorPreview }) {
  const [azimuth, setAzimuth] = useState(-30)
  const [elevation, setElevation] = useState(35)
  const [verticalScale, setVerticalScale] = useState<1 | 10>(1)
  const [selectedId, setSelectedId] = useState('')
  const [showReference, setShowReference] = useState(false)
  const furnishingFloors = model.floors.filter((floor) => floor.purpose !== 'reference')
  const referenceFloors = model.floors.filter((floor) => floor.purpose === 'reference')
  const referenceRooms = [
    ...referenceFloors,
    ...model.heldRooms.filter((room) => room.purpose === 'reference'),
  ]
  const visibleFloors = showReference ? model.floors : furnishingFloors
  const furnishingHeld = model.heldRooms.filter((room) => room.purpose !== 'reference')
  const view = { azimuthDeg: azimuth, elevationDeg: elevation, verticalScale }
  const project = (point: { xCm: number; yCm: number }, level: number) =>
    projectFloorPreviewPoint(point, level, view)
  const surfaces = visibleFloors
    .map((floor) => ({
      ...floor,
      points: floor.polygon.map((point) => project(point, floor.elevationCm)),
    }))
    .sort(
      (a, b) =>
        b.points.reduce((sum, point) => sum + point.depth, 0) / b.points.length -
        a.points.reduce((sum, point) => sum + point.depth, 0) / a.points.length,
    )
  const held = [
    ...model.heldRooms,
    ...(!showReference
      ? referenceFloors.map((floor) => ({
          ...floor,
          reason: 'Санузел показан справочно; его уровень сейчас скрыт.',
        }))
      : []),
  ].map((room) => ({
    ...room,
    points: room.polygon.map((point) => project(point, 0)),
  }))
  const points = [
    ...surfaces.flatMap((floor) => floor.points),
    ...held.flatMap((room) => room.points),
    ...model.floors.flatMap((floor) => floor.polygon.map((point) => project(point, 0))),
  ]
  const left = Math.min(...points.map((point) => point.x))
  const top = Math.min(...points.map((point) => point.y))
  const width = Math.max(...points.map((point) => point.x)) - left
  const height = Math.max(...points.map((point) => point.y)) - top
  const padding = Math.max(width, height) * 0.08
  const polygon = (ring: Array<{ x: number; y: number }>) =>
    ring.map((point) => `${point.x},${point.y}`).join(' ')
  const selected = visibleFloors.find((floor) => floor.id === selectedId)

  return (
    <section
      className="mt-8 border-t border-line pt-6"
      aria-labelledby="projected-floor-preview-title"
    >
      <p className="text-xs uppercase tracking-widest text-ink-2">
        Проектное состояние · частичный просмотр
      </p>
      <h2 id="projected-floor-preview-title" className="mt-2 font-serif text-2xl">
        Проектный 3D: уровни пола
      </h2>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-2">
        Показаны только целые контуры с отдельно сверенным уровнем и общим печатным нулём. Это
        будущая планировка, не натурный обмер. Неизвестные стены, потолки, толщина пола, пороги и
        проход мебели не достраиваются.
      </p>
      {model.floorScopeNote ? (
        <p className="mt-3 text-sm">Пол проверен частично: {model.floorScopeNote}</p>
      ) : null}
      <p className="mt-3 text-sm">
        Поверхности для обстановки: с уровнем - {furnishingFloors.length}; без определённого уровня
        - {furnishingHeld.length}. Санузлы справочно: {referenceRooms.length}. Общий ноль: «
        {model.datum.captionText}», PDF, страница {model.datum.pdfPage}.
      </p>
      {referenceRooms.length ? (
        <div className="mt-3 space-y-2 text-sm">
          <p>
            Санузлы сохраняются на плане и не требуют расчёта пола для обстановки других комнат.
            Готовая отделка по плану не определяется. Стены и проходы через эти зоны по-прежнему
            учитываются при физических проверках. Число известных уровней не означает готовность
            всех обмеров или расстановки.
          </p>
          <Button
            size="sm"
            variant="secondary"
            aria-pressed={showReference}
            onClick={() => {
              if (showReference && referenceFloors.some((floor) => floor.id === selectedId)) {
                setSelectedId('')
              }
              setShowReference(!showReference)
            }}
          >
            {showReference
              ? 'Скрыть справочные уровни санузлов'
              : 'Показать справочные уровни санузлов'}
          </Button>
          <p className="text-xs">
            Справочные помещения: {referenceRooms.map((room) => room.name).join(', ')}. Серый
            пунктир показывает их положение на плане, а не пол на нуле.
          </p>
        </div>
      ) : null}
      <fieldset
        className="mt-4 flex flex-wrap gap-2"
        aria-label="Управление проектными уровнями пола"
      >
        <Button size="sm" variant="secondary" onClick={() => setAzimuth((value) => value - 30)}>
          Повернуть влево
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setAzimuth((value) => value + 30)}>
          Повернуть вправо
        </Button>
        <Button
          size="sm"
          variant="secondary"
          aria-pressed={elevation === 90}
          onClick={() => setElevation(elevation === 90 ? 35 : 90)}
        >
          {elevation === 90 ? 'Наклонный вид' : 'Вид сверху'}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          aria-pressed={verticalScale === 10}
          onClick={() => setVerticalScale(verticalScale === 1 ? 10 : 1)}
        >
          Вертикальное увеличение: {verticalScale}×
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setAzimuth(-30)
            setElevation(35)
            setVerticalScale(1)
          }}
        >
          Вернуть исходный вид
        </Button>
      </fieldset>
      <p className="mt-2 text-xs text-ink-2" role="status">
        {verticalScale === 10
          ? 'Высота на рисунке увеличена в 10 раз для наглядности. Числа и сохранённые данные не меняются.'
          : 'Вертикальный и горизонтальный масштаб одинаковы. Разница уровней может выглядеть небольшой.'}
      </p>
      <svg
        className="mt-4 block max-h-[34rem] w-full border border-line bg-paper"
        viewBox={`${left - padding} ${top - padding} ${width + padding * 2} ${height + padding * 2}`}
        role="img"
        aria-label="Проектный 3D-просмотр уровней пола"
      >
        <title>Только проектные поверхности пола с известными уровнями</title>
        {held.map((room) => (
          <polygon
            key={room.id}
            points={polygon(room.points)}
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            strokeDasharray="5 5"
            vectorEffect="non-scaling-stroke"
            opacity={0.55}
          >
            <title>
              {room.name}:{' '}
              {room.purpose === 'reference'
                ? 'справочная проекция, без утверждения уровня'
                : 'проекция контура, уровень не задан'}
              . {room.reason}
            </title>
          </polygon>
        ))}
        {surfaces.map((floor) => (
          <polygon
            key={floor.id}
            points={polygon(floor.points)}
            fill={colors[floor.roomIndex % colors.length]}
            fillOpacity={selectedId && selectedId !== floor.id ? 0.45 : 0.85}
            stroke={selectedId === floor.id ? '#7c2f3b' : '#51483a'}
            strokeWidth={selectedId === floor.id ? 3 : 1.5}
            vectorEffect="non-scaling-stroke"
          >
            <title>
              {floor.name}: {number.format(floor.elevationCm)} см, проектная отметка
            </title>
          </polygon>
        ))}
        {visibleFloors
          .filter((floor) => floor.elevationCm !== 0)
          .map((floor) => {
            const point = floor.polygon[0]
            if (!point) return null
            const start = project(point, 0)
            const end = project(point, floor.elevationCm)
            return (
              <line
                key={floor.id}
                x1={start.x}
                y1={start.y}
                x2={end.x}
                y2={end.y}
                stroke="#0369a1"
                strokeWidth="2"
                strokeDasharray="3 2"
                vectorEffect="non-scaling-stroke"
              >
                <title>Графическая шкала до общего нуля, не стена</title>
              </line>
            )
          })}
      </svg>
      <p className="mt-2 text-xs leading-relaxed text-ink-2">
        Пунктирные контуры без заливки - справочные или неопределённые области, показанные на
        плоскости нуля для ориентирования, а не пол на нуле. Синие линии к нулю - графическая шкала,
        не стены. Выберите название комнаты ниже, чтобы выделить её поверхность.
      </p>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2" aria-label="Проектные поверхности пола">
        {visibleFloors.map((floor) => (
          <li key={floor.id}>
            <button
              type="button"
              aria-pressed={selectedId === floor.id}
              onClick={() => setSelectedId(floor.id)}
              className="flex min-h-11 w-full items-center gap-2 border border-line p-2 text-left text-sm"
            >
              <span
                className="h-3 w-3 shrink-0"
                style={{ background: colors[floor.roomIndex % colors.length] }}
              />
              {floor.name}: {number.format(floor.elevationCm)} см
            </button>
          </li>
        ))}
      </ul>
      {selected ? (
        <p className="mt-3 border-l-2 border-accent pl-3 text-sm" role="status">
          {selected.name}: {number.format(selected.elevationCm)} см от выбранного проектного нуля.
          Применение ко всему контуру сверено человеком. Это не проверка потолка, порога или
          маршрута заноса.
        </p>
      ) : null}
      {furnishingHeld.length || (showReference && model.heldRooms.length) ? (
        <ul
          className="mt-4 space-y-2 text-sm text-ink-2"
          aria-label="Неподтверждённые проектные поверхности"
        >
          {(showReference ? model.heldRooms : furnishingHeld).map((room) => (
            <li key={room.id}>
              <p>
                {room.name}: {room.reason}
              </p>
              {room.levels.length ? (
                <details className="mt-2 border-l border-line pl-3">
                  <summary className="cursor-pointer">
                    Подписи без построенной поверхности ({room.levels.length})
                  </summary>
                  <p className="mt-2 text-xs">
                    Это значения из документа. Место подписи на листе не задаёт точку пола в 3D, а
                    одна отметка не определяет уклон или весь участок.
                  </p>
                  <ul className="mt-2 space-y-2" aria-label={`Исходные отметки: ${room.name}`}>
                    {room.levels.map((level) => (
                      <li key={level.evidenceId}>
                        <p>
                          {level.scopeLabel ? `${level.scopeLabel}: ` : ''}
                          {level.printedValue}{' '}
                          {level.unit === 'mm' ? 'мм' : level.unit === 'cm' ? 'см' : 'м'}.
                        </p>
                        <p className="text-xs">
                          PDF, страница {level.pdfPage}, подписи {level.captionIndexes.join(', ')}:{' '}
                          «{level.captionTexts.join(' / ')}».
                        </p>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
