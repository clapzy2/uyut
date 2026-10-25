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
  const view = { azimuthDeg: azimuth, elevationDeg: elevation, verticalScale }
  const project = (point: { xCm: number; yCm: number }, level: number) =>
    projectFloorPreviewPoint(point, level, view)
  const surfaces = model.floors
    .map((floor) => ({
      ...floor,
      points: floor.polygon.map((point) => project(point, floor.elevationCm)),
    }))
    .sort(
      (a, b) =>
        b.points.reduce((sum, point) => sum + point.depth, 0) / b.points.length -
        a.points.reduce((sum, point) => sum + point.depth, 0) / a.points.length,
    )
  const held = model.heldRooms.map((room) => ({
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
  const selected = model.floors.find((floor) => floor.id === selectedId)

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
        Поверхностей с уровнем: {model.floors.length}. Без определённой поверхности:{' '}
        {model.heldRooms.length}. Общий ноль: «{model.datum.captionText}», PDF, страница{' '}
        {model.datum.pdfPage}.
      </p>
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
              {room.name}: проекция контура, уровень не задан. {room.reason}
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
        {model.floors
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
        Пунктирные контуры без заливки - проекции неизвестных областей на плоскость нулевой отметки,
        а не пол на нуле. Синие линии к нулю - графическая шкала, не стены. Выберите название
        комнаты ниже, чтобы выделить её поверхность.
      </p>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2" aria-label="Проектные поверхности пола">
        {model.floors.map((floor) => (
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
      {model.heldRooms.length ? (
        <ul
          className="mt-4 space-y-2 text-sm text-ink-2"
          aria-label="Неподтверждённые проектные поверхности"
        >
          {model.heldRooms.map((room) => (
            <li key={room.id}>
              {room.name}: {room.reason}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
