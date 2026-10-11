'use client'

import { verticalReferenceReviewKey } from '@uyut/catalog/plan-vertical-floor-geometry'
import type { PlanGeometry } from '@uyut/db'
import { Button } from '@uyut/ui'
import { useId, useState } from 'react'
import {
  furnitureStairGeometryKey,
  inspectFurnitureStairTransfer,
} from '@/lib/projects/plan-furniture-stair-transfer'

type ProfileFields = {
  widthCm: string
  depthCm: string
  heightCm: string
  clearanceCm: string
  orientation: '0' | '90'
}
type StepFields = { id: string; runCm: string; elevationCm: string; ceilingElevationCm: string }
type Fields = {
  lowerFloorId: string
  upperFloorId: string
  direction: 'x' | 'y'
  travelDirection: 'up' | 'down'
  startCm: string
  crossStartCm: string
  widthCm: string
  lowerLandingLengthCm: string
  upperLandingLengthCm: string
  carryClearanceCm: string
  sourceReference: string
  tilt: 'none' | 'width' | 'depth'
  angleDeg: string
  steps: StepFields[]
}
const blankStep = (id: string): StepFields => ({
  id,
  runCm: '',
  elevationCm: '',
  ceilingElevationCm: '',
})
const initialFields: Fields = {
  lowerFloorId: '',
  upperFloorId: '',
  direction: 'y',
  travelDirection: 'up',
  startCm: '',
  crossStartCm: '',
  widthCm: '',
  lowerLandingLengthCm: '',
  upperLandingLengthCm: '',
  carryClearanceCm: '',
  sourceReference: '',
  tilt: 'none',
  angleDeg: '90',
  steps: [blankStep('step-1')],
}
const measurements = [
  ['startCm', 'Начало нижней площадки по оси марша, см'],
  ['crossStartCm', 'Начало по поперечной оси, см'],
  ['widthCm', 'Свободная ширина с учётом перил, см'],
  ['lowerLandingLengthCm', 'Длина нижней площадки, см'],
  ['upperLandingLengthCm', 'Длина верхней площадки, см'],
  ['carryClearanceCm', 'Запас низа над ступенями, см'],
] as const
const stepMeasurements = [
  ['runCm', 'Глубина проступи, см'],
  ['elevationCm', 'Верх ступени от общего нуля, см'],
  ['ceilingElevationCm', 'Минимальная отметка потолка над всей проступью, см'],
] as const
const controlClass =
  'min-h-11 w-full border border-line-strong bg-paper px-3 py-2 text-ink focus-visible:outline-2 focus-visible:outline-accent'
const stageNames = {
  lift: 'Подъём',
  translate: 'Перемещение',
  lower: 'Опускание',
  tilt: 'Наклон',
  untilt: 'Возврат положения',
}
const dimensionFormat = new Intl.NumberFormat('ru-RU', {
  maximumFractionDigits: 2,
  useGrouping: false,
})
function decimal(value: string): number {
  const text = value.trim()
  return /^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/u.test(text)
    ? Number(text.replace(',', '.'))
    : Number.NaN
}

/** Separate surveyed flight; never an inferred connection in the apartment's route graph. */
export function PlanFurnitureStairCheck({
  geometry,
  profileFields,
}: {
  geometry: PlanGeometry
  profileFields: ProfileFields
}) {
  const id = `stair-${useId()}`
  const [expanded, setExpanded] = useState(false)
  const [fields, setFields] = useState<Fields>(initialFields)
  const key = `${JSON.stringify(geometry)}:${JSON.stringify(profileFields)}:${JSON.stringify(fields)}`
  const [acknowledgedKey, setAcknowledgedKey] = useState<string>()
  const [checked, setChecked] = useState<{
    key: string
    response: ReturnType<typeof inspectFurnitureStairTransfer>
  }>()
  const current = checked?.key === key ? checked.response : undefined
  const reference = geometry.verticalReference
  const floors = reference?.floors.filter((floor) => floor.surface === 'finished-floor') ?? []
  const result = current?.result
  const along = (point: { xCm: number; yCm: number }) =>
    fields.direction === 'x' ? point.xCm : point.yCm

  function change<Key extends keyof Fields>(field: Key, value: Fields[Key]) {
    setFields((previous) => ({ ...previous, [field]: value }))
    setAcknowledgedKey(undefined)
    setChecked(undefined)
  }
  function check() {
    try {
      const ceiling = (floorId: string) =>
        reference?.ceilings?.find((item) => item.floorId === floorId)?.elevationCm
      const response = inspectFurnitureStairTransfer(
        geometry,
        {
          version: 1,
          geometryKey: furnitureStairGeometryKey(geometry),
          referenceKey: reference ? verticalReferenceReviewKey(reference) : '',
          source: { kind: 'site-measurement', reference: fields.sourceReference },
          lowerFloorId: fields.lowerFloorId,
          upperFloorId: fields.upperFloorId,
          direction: fields.direction,
          startCm: decimal(fields.startCm),
          crossStartCm: decimal(fields.crossStartCm),
          widthCm: decimal(fields.widthCm),
          lowerLandingLengthCm: decimal(fields.lowerLandingLengthCm),
          upperLandingLengthCm: decimal(fields.upperLandingLengthCm),
          lowerLandingCeilingCm: ceiling(fields.lowerFloorId),
          upperLandingCeilingCm: ceiling(fields.upperFloorId),
          treads: fields.steps.map((step) => ({
            runCm: decimal(step.runCm),
            elevationCm: decimal(step.elevationCm),
            ceilingElevationCm: decimal(step.ceilingElevationCm),
          })),
          travelDirection: fields.travelDirection,
          carryClearanceCm: decimal(fields.carryClearanceCm),
          tilt: fields.tilt,
          ...(fields.tilt === 'none' ? {} : { angleDeg: decimal(fields.angleDeg) }),
          acknowledged: acknowledgedKey === key,
        },
        {
          widthCm: decimal(profileFields.widthCm),
          depthCm: decimal(profileFields.depthCm),
          heightCm: decimal(profileFields.heightCm),
          clearanceCm: decimal(profileFields.clearanceCm),
          orientation: profileFields.orientation === '90' ? 90 : 0,
        },
      )
      setChecked({ key, response })
    } catch {
      setChecked({
        key,
        response: {
          error: 'Проверка марша не завершена. Сверьте контуры и полный набор обмеров.',
          notes: [],
        },
      })
    }
  }
  return (
    <section
      className="mt-5 min-w-0 break-words border-t border-line pt-4"
      aria-label="Перенос по измеренной лестнице"
    >
      <Button
        type="button"
        variant="secondary"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        {expanded ? 'Скрыть обмеры лестницы' : 'Проверить измеренный лестничный марш'}
      </Button>
      {expanded ? (
        <>
          <h4 className="mt-4 text-sm font-medium">Прямой лестничный марш — отдельная проверка</h4>
          <p className="mt-2 text-xs leading-relaxed text-ink-2">
            Используем габарит, запас и положение по X/Y из полей выше. Это не путь от входной двери
            и не автоматически распознанная лестница. Нужны обмеры всех ступеней и двух площадок
            внутри сверенной схемы. Площадки должны принадлежать выбранным чистовым полам;
            записанные стены, пустоты и препятствия не удаляются.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {(['lowerFloorId', 'upperFloorId'] as const).map((field) => (
              <label
                key={field}
                htmlFor={`${id}-${field}`}
                className="flex flex-col gap-1 text-sm text-ink-2"
              >
                {field === 'lowerFloorId' ? 'Пол нижней площадки' : 'Пол верхней площадки'}
                <select
                  id={`${id}-${field}`}
                  className={controlClass}
                  value={fields[field]}
                  onChange={(event) => change(field, event.currentTarget.value)}
                >
                  <option value="">Не выбран</option>
                  {floors.map((floor) => (
                    <option key={floor.id} value={floor.id}>
                      {floor.room.name} · {floor.elevationCm} см
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <label htmlFor={`${id}-direction`} className="flex flex-col gap-1 text-sm text-ink-2">
              Ось марша от нижней к верхней площадке
              <select
                id={`${id}-direction`}
                className={controlClass}
                value={fields.direction}
                onChange={(event) =>
                  change('direction', event.currentTarget.value === 'x' ? 'x' : 'y')
                }
              >
                <option value="y">По +Y (вниз на плане)</option>
                <option value="x">По +X (вправо на плане)</option>
              </select>
            </label>
            <label
              htmlFor={`${id}-travelDirection`}
              className="flex flex-col gap-1 text-sm text-ink-2"
            >
              Направление переноса
              <select
                id={`${id}-travelDirection`}
                className={controlClass}
                value={fields.travelDirection}
                onChange={(event) =>
                  change('travelDirection', event.currentTarget.value === 'down' ? 'down' : 'up')
                }
              >
                <option value="up">Подъём</option>
                <option value="down">Спуск</option>
              </select>
            </label>
            {measurements.map(([field, label]) => (
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
                  className={controlClass}
                  value={fields[field]}
                  onChange={(event) => change(field, event.currentTarget.value)}
                />
              </label>
            ))}
            <label htmlFor={`${id}-tilt`} className="flex flex-col gap-1 text-sm text-ink-2">
              Наклон на всём марше
              <select
                id={`${id}-tilt`}
                className={controlClass}
                value={fields.tilt}
                onChange={(event) => {
                  const value = event.currentTarget.value
                  change('tilt', value === 'width' || value === 'depth' ? value : 'none')
                }}
              >
                <option value="none">Без наклона</option>
                <option value="width">В сечении ширина/высота</option>
                <option value="depth">В сечении глубина/высота</option>
              </select>
            </label>
            {fields.tilt !== 'none' ? (
              <label htmlFor={`${id}-angleDeg`} className="flex flex-col gap-1 text-sm text-ink-2">
                Угол на марше, °
                <input
                  id={`${id}-angleDeg`}
                  type="text"
                  inputMode="decimal"
                  maxLength={20}
                  className={controlClass}
                  value={fields.angleDeg}
                  onChange={(event) => change('angleDeg', event.currentTarget.value)}
                />
              </label>
            ) : null}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-ink-2">
            Начало и все отметки — в текущих координатах и общем высотном отсчёте, не локальная
            высота подступёнка. Потолки площадок берутся из подтверждённых мерок полов. Для каждой
            проступи нужен минимальный абсолютный потолок над всей её шириной и глубиной.
            Неизвестные мерки не заменяются числами. При наклоне проверяется полный диагональный
            объём на обеих площадках; все размеры заранее увеличиваются на два запаса.
          </p>
          <div className="mt-4 space-y-3">
            {fields.steps.map((step, index) => (
              <fieldset key={step.id} className="border-t border-line pt-3">
                <legend className="text-sm text-ink">Ступень {index + 1} от нижней площадки</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {stepMeasurements.map(([field, label]) => (
                    <label
                      key={field}
                      htmlFor={`${id}-step-${index}-${field}`}
                      className="flex flex-col gap-1 text-sm text-ink-2"
                    >
                      {label}
                      <input
                        id={`${id}-step-${index}-${field}`}
                        type="text"
                        inputMode="decimal"
                        maxLength={20}
                        className={controlClass}
                        value={step[field]}
                        onChange={(event) =>
                          change(
                            'steps',
                            fields.steps.map((item, position) =>
                              position === index
                                ? { ...item, [field]: event.currentTarget.value }
                                : item,
                            ),
                          )
                        }
                      />
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                variant="secondary"
                disabled={fields.steps.length >= 64}
                onClick={() =>
                  change('steps', [...fields.steps, blankStep(`step-${fields.steps.length + 1}`)])
                }
              >
                Добавить ступень
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={fields.steps.length <= 1}
                onClick={() => change('steps', fields.steps.slice(0, -1))}
              >
                Убрать последнюю ступень
              </Button>
            </div>
          </div>
          <label
            htmlFor={`${id}-sourceReference`}
            className="mt-3 flex flex-col gap-1 text-sm text-ink-2"
          >
            Источник и дата обмеров марша
            <input
              id={`${id}-sourceReference`}
              type="text"
              maxLength={1000}
              className={controlClass}
              value={fields.sourceReference}
              onChange={(event) => change('sourceReference', event.currentTarget.value)}
            />
          </label>
          <label className="mt-3 flex min-h-11 items-start gap-2 text-sm leading-relaxed text-ink">
            <input
              id={`${id}-acknowledged`}
              type="checkbox"
              className="mt-1 accent-accent"
              checked={acknowledgedKey === key}
              onChange={(event) => {
                setAcknowledgedKey(event.currentTarget.checked ? key : undefined)
                setChecked(undefined)
              }}
            />
            Я сверил габарит мебели, все ступени, площадки, свободную ширину с учётом перил и
            минимальные потолки по всей занятой области. Это обмеры, не приблизительные числа с
            картинки.
          </label>
          <Button type="button" variant="secondary" className="mt-3" onClick={check}>
            Проверить марш
          </Button>
          {current ? (
            <div className="mt-3" role="status" aria-live="polite">
              {current.error ? <p className="text-sm text-accent">{current.error}</p> : null}
              {result ? (
                <>
                  <p className="text-sm font-medium">
                    Локальный путь по прямому маршу построен:{' '}
                    {result.travelDirection === 'up' ? 'подъём' : 'спуск'}.
                  </p>
                  <p className="mt-1 text-xs text-ink-2">
                    Переносимый габарит с запасом (приближённо){' '}
                    {dimensionFormat.format(result.carried.widthCm)} ×{' '}
                    {dimensionFormat.format(result.carried.depthCm)} ×{' '}
                    {dimensionFormat.format(result.carried.heightCm)} см; наклон {result.angleDeg}°.
                    Низ меняет высоту на отдельно проверенных этапах, а не держится на одном уровне
                    над всей лестницей.
                  </p>
                  {(() => {
                    const minimum = Math.min(
                      ...result.regions.flatMap((region) => region.polygon.map(along)),
                    )
                    const maximum = Math.max(
                      ...result.regions.flatMap((region) => region.polygon.map(along)),
                    )
                    const low = Math.min(...result.regions.map((region) => region.elevationCm))
                    const high = Math.max(
                      ...result.regions.map((region) => region.ceilingElevationCm),
                    )
                    return (
                      <svg
                        role="img"
                        aria-label="Высотный профиль измеренного марша и нижней границы габарита"
                        className="mt-3 h-64 w-full border border-line bg-paper"
                        viewBox={`${minimum - 10} ${-high - 10} ${maximum - minimum + 20} ${high - low + 20}`}
                      >
                        {result.regions.map((region) => {
                          const start = Math.min(...region.polygon.map(along))
                          const end = Math.max(...region.polygon.map(along))
                          return (
                            <g key={region.index}>
                              <title>{`Участок ${region.index + 1}: пол ${region.elevationCm} см, потолок ${region.ceilingElevationCm} см`}</title>
                              <path
                                d={`M ${start} ${-region.elevationCm} H ${end}`}
                                stroke="var(--ink)"
                                strokeWidth="2"
                                fill="none"
                              />
                              <path
                                d={`M ${start} ${-region.ceilingElevationCm} H ${end}`}
                                stroke="var(--ink-2)"
                                strokeWidth="1"
                                strokeDasharray="4 3"
                                fill="none"
                              />
                            </g>
                          )
                        })}
                        <polyline
                          points={result.points
                            .map((point) => `${along(point)},${-point.zCm}`)
                            .join(' ')}
                          fill="none"
                          stroke="var(--accent)"
                          strokeWidth="3"
                        >
                          <title>
                            Проверенный путь нижней границы расширенного габарита, не центра мебели
                          </title>
                        </polyline>
                      </svg>
                    )
                  })()}
                  <p className="mt-1 text-xs text-ink-2">
                    Сплошные линии — измеренные верхи ступеней и площадок; пунктир — минимальные
                    потолки; цветная линия — низ габарита. Толщина плит, люди и усилия не показаны.
                  </p>
                  <details className="mt-2 text-xs text-ink-2">
                    <summary className="cursor-pointer">
                      Этапы и высотные границы: {result.stages.length}
                    </summary>
                    <ol className="mt-2 space-y-1">
                      {result.stages.map((stage, index) => (
                        <li key={JSON.stringify(stage)}>
                          {index + 1}. {stageNames[stage.kind]}: низ {stage.from.zCm} →{' '}
                          {stage.to.zCm} см; верх всего проверенного объёма{' '}
                          {stage.bounds.topElevationCm} см.
                        </li>
                      ))}
                    </ol>
                  </details>
                </>
              ) : null}
              {current.notes.map((note) => (
                <p key={note} className="mt-1 text-xs leading-relaxed text-ink-2">
                  {note}
                </p>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
