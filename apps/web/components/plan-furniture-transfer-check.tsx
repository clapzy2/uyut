'use client'

import { inspectThresholdLevelTransitions } from '@uyut/catalog/plan-threshold-geometry'
import { signedElevationSum } from '@uyut/catalog/plan-vertical-floor-geometry'
import type { PlanGeometry } from '@uyut/db'
import { Button } from '@uyut/ui'
import { useId, useMemo, useState } from 'react'
import { inspectFurnitureTransfer } from '@/lib/projects/plan-furniture-transfer'

type ProfileFields = {
  widthCm: string
  depthCm: string
  heightCm: string
  clearanceCm: string
  orientation: '0' | '90'
  allowTurns: boolean
}
const emptyFields: ProfileFields = {
  widthCm: '',
  depthCm: '',
  heightCm: '',
  clearanceCm: '',
  orientation: '0',
  allowTurns: false,
}
const labels = [
  ['widthCm', 'Ширина габарита, см'],
  ['depthCm', 'Глубина габарита, см'],
  ['heightCm', 'Высота габарита, см'],
  ['clearanceCm', 'Запас на сторону, см'],
] as const

/** Separate rigid-body test, not a verdict that furniture can physically be carried in. */
export function PlanFurnitureTransferCheck({ geometry }: { geometry: PlanGeometry }) {
  const id = useId()
  const snapshot = JSON.stringify(geometry)
  const [fields, setFields] = useState<ProfileFields>(emptyFields)
  const key = `${snapshot}:${JSON.stringify(fields)}`
  const [acknowledgedKey, setAcknowledgedKey] = useState<string>()
  const [checked, setChecked] = useState<{
    key: string
    result: ReturnType<typeof inspectFurnitureTransfer>
  }>()
  const current = checked?.key === key ? checked.result : undefined
  const acknowledged = acknowledgedKey === key
  const transitions = useMemo(
    () => inspectThresholdLevelTransitions(JSON.parse(snapshot) as PlanGeometry),
    [snapshot],
  )
  const result = current?.inspection?.result
  const start = result?.routes[0]?.points[0]
  const footprint = result?.footprintCm
  const turnSweep =
    fields.allowTurns &&
    result?.turnPolicy === 'conservative-square' &&
    result.turnSweepCm !== undefined &&
    Number.isFinite(result.turnSweepCm) &&
    result.turnSweepCm > 0
      ? result.turnSweepCm
      : undefined
  const turns = new Map<string, { xCm: number; yCm: number; from: 0 | 90; to: 0 | 90 }>()
  if (turnSweep !== undefined) {
    for (const route of result?.routes ?? []) {
      for (const [index, point] of route.points.entries()) {
        const previous = route.points[index - 1]
        if (
          previous?.orientation !== undefined &&
          point.orientation !== undefined &&
          previous.orientation !== point.orientation &&
          previous.xCm === point.xCm &&
          previous.yCm === point.yCm
        ) {
          turns.set(`${point.xCm},${point.yCm}`, {
            xCm: point.xCm,
            yCm: point.yCm,
            from: previous.orientation,
            to: point.orientation,
          })
        }
      }
    }
  }

  function change<Key extends keyof ProfileFields>(field: Key, value: ProfileFields[Key]) {
    setFields((previous) => ({ ...previous, [field]: value }))
    setAcknowledgedKey(undefined)
    setChecked(undefined)
  }
  function check() {
    const number = (value: string) => {
      const decimal = value.trim()
      if (decimal === '') return undefined
      if (!/^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/u.test(decimal)) return Number.NaN
      return Number(decimal.replace(',', '.'))
    }
    try {
      setChecked({
        key,
        result: inspectFurnitureTransfer(geometry, {
          widthCm: number(fields.widthCm),
          depthCm: number(fields.depthCm),
          heightCm: number(fields.heightCm),
          clearanceCm: number(fields.clearanceCm),
          orientation: Number(fields.orientation),
          allowTurns: fields.allowTurns,
          acknowledged,
        }),
      })
    } catch {
      setChecked({
        key,
        result: {
          error: 'Проверка габарита не завершена. Сверьте исходную схему и введённые мерки.',
          notes: [],
        },
      })
    }
  }
  return (
    <section
      className="mt-5 min-w-0 break-words border-t border-line pt-4"
      aria-label="Проверка переносимого габарита"
    >
      <h3 className="text-sm font-medium">Переносимый габарит мебели</h3>
      <p className="mt-2 text-sm leading-relaxed text-ink-2">
        Отдельная проверка жёсткого прямоугольного габарита или упаковки. Введите реальные обмеры
        переносимого предмета: размеры собранной мебели из каталога не подставляются автоматически.
      </p>
      <p className="mt-2 text-xs leading-relaxed text-ink-2">
        {fields.allowTurns
          ? 'Габарит остаётся вертикальным. Поворот на месте на 90° допускается только внутри свободного консервативного квадрата со стороной, равной диагонали габарита с запасом. Наклон, подъём и лестницы не рассчитываются.'
          : 'Только горизонтальное перемещение вертикального габарита в фиксированном положении. Повороты вдоль пути, наклон, подъём и лестницы не рассчитываются.'}
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {labels.map(([field, label]) => (
          <label
            key={field}
            htmlFor={`${id}-${field}`}
            className="flex flex-col gap-1 text-sm text-ink-2"
          >
            {label}
            <input
              id={`${id}-${field}`}
              type="text"
              inputMode="decimal"
              maxLength={20}
              value={fields[field]}
              onChange={(event) => change(field, event.currentTarget.value)}
              className="min-h-11 w-full border border-line-strong bg-paper px-3 py-2 text-ink focus-visible:outline-2 focus-visible:outline-accent"
            />
          </label>
        ))}
        <label htmlFor={`${id}-orientation`} className="flex flex-col gap-1 text-sm text-ink-2">
          Положение габарита на плане
          <select
            id={`${id}-orientation`}
            value={fields.orientation}
            onChange={(event) =>
              change('orientation', event.currentTarget.value === '90' ? '90' : '0')
            }
            className="min-h-11 w-full border border-line-strong bg-paper px-3 py-2 text-ink focus-visible:outline-2 focus-visible:outline-accent"
          >
            <option value="0">0°: ширина по X, глубина по Y</option>
            <option value="90">90°: глубина по X, ширина по Y</option>
          </select>
        </label>
      </div>
      <label className="mt-3 flex min-h-11 items-start gap-2 text-sm leading-relaxed text-ink">
        <input
          id={`${id}-allow-turns`}
          type="checkbox"
          className="mt-1 accent-accent"
          checked={fields.allowTurns}
          onChange={(event) => change('allowTurns', event.currentTarget.checked)}
        />
        Разрешить повороты на месте на 90° по консервативному квадрату
      </label>
      <p className="mt-2 text-xs leading-relaxed text-ink-2">
        Запас добавляется с каждой стороны ширины и глубины, а по высоте - только над предметом;
        основание остаётся на полу. Пустое поле означает неизвестное значение, а не ноль.
      </p>
      <label className="mt-3 flex min-h-11 items-start gap-2 text-sm leading-relaxed text-ink">
        <input
          id={`${id}-acknowledged`}
          type="checkbox"
          className="mt-1 accent-accent"
          checked={acknowledged}
          onChange={(event) => {
            setAcknowledgedKey(event.currentTarget.checked ? key : undefined)
            setChecked(undefined)
          }}
        />
        Я сверил переносимый габарит, запас, начальное положение и выбранный режим поворотов по
        обмеру предмета или упаковки.
      </label>
      <Button type="button" variant="secondary" className="mt-3" onClick={check}>
        Проверить габарит
      </Button>
      <div className="mt-3 text-sm" aria-live="polite">
        {checked && !current ? (
          <p className="text-ink-2">
            Схема или профиль изменились. Прежние пути скрыты; сверьте мерки и повторите проверку.
          </p>
        ) : null}
        {current?.error ? <p className="text-ink-2">{current.error}</p> : null}
        {current?.notes.length ? (
          <details className="mt-2 text-xs leading-relaxed text-ink-2">
            <summary className="min-h-11 cursor-pointer py-2">Что учитывает расчёт</summary>
            {current.notes.map((note, index) => (
              <p key={String(index)} className="mt-1">
                {note}
              </p>
            ))}
          </details>
        ) : null}
        {current?.inspection?.missing ? (
          <p className="mt-2 text-ink-2">{current.inspection.missing}</p>
        ) : null}
        {result ? (
          <>
            <p>
              Найденные горизонтальные пути габарита: {result.routes.length} из{' '}
              {geometry.rooms.length}.
            </p>
            {result.vertical && current?.profile ? (
              <p className="mt-1 text-xs text-ink-2">
                Основание на отметке {result.vertical.elevationCm} см от общего нуля; верх габарита
                с запасом над ним{' '}
                {signedElevationSum(
                  result.vertical.elevationCm,
                  signedElevationSum(current.profile.heightCm, current.profile.clearanceCm),
                )}{' '}
                см. Это положение без подъёма и наклона.
              </p>
            ) : null}
            {footprint ? (
              <p className="mt-1 text-xs text-ink-2">
                Проверяемый прямоугольник с запасом: {footprint.widthCm} × {footprint.depthCm} см.
                {turnSweep !== undefined
                  ? ' Начальное положение; поворот меняет местами ширину и глубину.'
                  : ' Положение не меняется вдоль пути.'}
              </p>
            ) : null}
            {result.unresolvedRoomIds.length ? (
              <p className="mt-1 text-xs text-ink-2">
                Не найден путь для комнат:{' '}
                {result.unresolvedRoomIds
                  .map((roomId) => geometry.rooms[Number(roomId)]?.name ?? roomId)
                  .join(', ')}
                . Это не доказательство невозможности переноса.
              </p>
            ) : null}
            {result.vertical?.heldTransitions.length ? (
              <ul className="mt-2 space-y-1 text-xs text-ink-2">
                {result.vertical.heldTransitions.map((transition, index) => (
                  <li key={String(index)}>
                    {transition.openingIds.join(', ')}: {transition.reason}
                  </li>
                ))}
              </ul>
            ) : null}
            <svg
              className="mt-3 w-full border border-line bg-paper"
              viewBox={`0 0 ${geometry.widthCm} ${geometry.heightCm}`}
              role="img"
              aria-label="Горизонтальные пути фиксированного габарита"
            >
              {geometry.rooms.map((room, index) => (
                <polygon
                  key={String(index)}
                  points={room.polygon.map((point) => `${point.xCm},${point.yCm}`).join(' ')}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                />
              ))}
              {(geometry.voids ?? []).map((region) => (
                <polygon
                  key={region.id}
                  points={region.polygon.map((point) => `${point.xCm},${point.yCm}`).join(' ')}
                  fill="currentColor"
                  opacity="0.25"
                />
              ))}
              {result.routes.map((route) => (
                <polyline
                  key={route.roomId}
                  points={route.points.map((point) => `${point.xCm},${point.yCm}`).join(' ')}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="5"
                />
              ))}
              {[...(geometry.obstacles ?? []), ...(geometry.kitchenItems ?? [])].map((obstacle) => (
                <rect
                  key={`obstacle-${obstacle.id}`}
                  x={obstacle.xCm}
                  y={obstacle.yCm}
                  width={obstacle.widthCm}
                  height={obstacle.depthCm}
                  fill="currentColor"
                  opacity="0.25"
                >
                  <title>Неподвижный объект или кухонный модуль</title>
                </rect>
              ))}
              {start && footprint ? (
                <rect
                  x={start.xCm - footprint.widthCm / 2}
                  y={start.yCm - footprint.depthCm / 2}
                  width={footprint.widthCm}
                  height={footprint.depthCm}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="2"
                  strokeDasharray="5 3"
                >
                  <title>Стартовый прямоугольник с заданным запасом</title>
                </rect>
              ) : null}
              {[...turns.values()].map((turn, index) => (
                <g key={`${turn.xCm},${turn.yCm}`} data-transfer-turn={String(index + 1)}>
                  <title>{`Поворот ${index + 1}: ${turn.from}° → ${turn.to}° относительно начального положения; квадрат ${turnSweep} см`}</title>
                  <rect
                    x={turn.xCm - (turnSweep ?? 0) / 2}
                    y={turn.yCm - (turnSweep ?? 0) / 2}
                    width={turnSweep}
                    height={turnSweep}
                    fill="none"
                    stroke="var(--accent)"
                    strokeWidth="2"
                    strokeDasharray="5 3"
                  />
                  <circle
                    cx={turn.xCm}
                    cy={turn.yCm}
                    r="10"
                    fill="var(--paper)"
                    stroke="var(--accent)"
                    strokeWidth="2"
                  />
                  <text
                    x={turn.xCm}
                    y={turn.yCm}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize="12"
                    fill="var(--accent)"
                  >
                    {index + 1}
                  </text>
                </g>
              ))}
            </svg>
            {turnSweep !== undefined ? (
              <p className="mt-1 text-xs text-ink-2">
                Номера отмечают найденные повороты на месте: {turns.size}. Пунктирный квадрат -
                проверенная зона поворота со стороной {turnSweep} см, не точная траектория углов
                предмета. Направления 0°/90° отсчитываются от выбранного начального положения.
              </p>
            ) : null}
            <p className="mt-1 text-xs text-ink-2">
              Сетка поиска {result.stepCm} см. Линия показывает только проверенный горизонтальный
              путь заданного прямоугольника.
            </p>
          </>
        ) : null}
      </div>
      {geometry.verticalReference ? (
        <div className="mt-4 text-xs leading-relaxed text-ink-2">
          <h4 className="font-medium text-ink">Известные перепады у порогов</h4>
          <p className="mt-1">
            Это разность измеренных отметок, не описание конструкции ступени или лестницы.
          </p>
          {transitions.issues.map((issue) => (
            <p key={issue.id} className="mt-1">
              {issue.message}
            </p>
          ))}
          {transitions.transitions.map((transition) => (
            <p key={transition.id} className="mt-2">
              {transition.floorNames
                .map(
                  (name, index) =>
                    `${name} (${transition.floorSurfaces[index] === 'finished-floor' ? 'чистовой' : 'существующий'} пол)`,
                )
                .join(' / ')}
              : отметки полов {transition.floorElevationsCm.join(' / ')} см; верх порога{' '}
              {transition.thresholdTopCm} см от общего нуля. Подъём к верху с каждой стороны:{' '}
              {transition.risesCm.join(' / ')} см; разность полов {transition.deltaCm} см.
              {transition.surfaceKnown
                ? ' Поверхность верха подтверждена.'
                : ' Контур верха не подтверждён.'}{' '}
              Преодоление ступени не проверено.
            </p>
          ))}
          {!transitions.transitions.length && !transitions.issues.length ? (
            <p className="mt-1">
              Нет свежих подтверждённых переходов для сравнения уровней. Неизвестный порог не
              считается нулевым.
            </p>
          ) : null}
        </div>
      ) : null}
      <p className="mt-3 text-xs leading-relaxed text-ink-2">
        {fields.allowTurns
          ? 'Проверяется только выбранная консервативная модель поворота на месте. '
          : 'Габарит остаётся вертикальным и в одном положении; повороты вдоль пути не проверяются. '}
        Наклон, подъём, лестницы, внешний вход, место для грузчиков и их головы, масса предмета не
        проверяются. Другая подвижная мебель не учтена. Неизвестные высоты проёмов и потолков
        требуют обмера. Найденный путь не подтверждает физический перенос мебели.
      </p>
    </section>
  )
}
