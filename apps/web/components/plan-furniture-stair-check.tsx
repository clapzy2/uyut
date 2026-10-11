'use client'

import type { PlanGeometry } from '@uyut/db'
import { Button } from '@uyut/ui'
import { useId, useRef, useState } from 'react'
import { inspectFurnitureDeliveryViaStairs } from '@/lib/projects/plan-furniture-delivery'
import {
  type FurnitureDeliveryDraftFields as Fields,
  MAX_FURNITURE_DELIVERY_DRAFT_BYTES,
  type FurnitureDeliveryProfileFields as ProfileFields,
  parseFurnitureDeliveryDraft,
  serializeFurnitureDeliveryDraft,
} from '@/lib/projects/plan-furniture-delivery-archive'
import { createFurnitureDeliveryRequest } from '@/lib/projects/plan-furniture-delivery-input'
import {
  type FurnitureDeliveryReportRequest,
  serializeFurnitureDeliveryReport,
} from '@/lib/projects/plan-furniture-delivery-report'
import { inspectFurnitureStairTransfer } from '@/lib/projects/plan-furniture-stair-transfer'
import { PlanDeliveryAccount, type PlanDeliveryAccountContext } from './plan-delivery-account'
import PlanDeliveryVolume from './plan-delivery-volume'

type StepFields = Fields['steps'][number]
type LayoutFields = NonNullable<Fields['layout']>[number]
const blankStep = (id: string): StepFields => ({
  id,
  runCm: '',
  elevationCm: '',
  ceilingElevationCm: '',
})
const blankLayout = (id: string, kind: LayoutFields['kind']): LayoutFields => ({
  id,
  kind,
  leftCm: '',
  topCm: '',
  rightCm: '',
  bottomCm: '',
  elevationCm: '',
  ceilingElevationCm: '',
})
const initialFields: Fields = {
  polygonMode: false,
  polygonLayoutJson: '',
  exteriorEnabled: false,
  exteriorJson: '',
  doorLeavesEnabled: false,
  doorLeavesJson: '',
  turning: false,
  targetRoomId: '',
  allowQuarterTurns: false,
  layout: [blankLayout('layout-1', 'landing'), blankLayout('layout-2', 'landing')],
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
const layoutMeasurements = [
  ['leftCm', 'Левая граница X, см'],
  ['topCm', 'Верхняя граница Y, см'],
  ['rightCm', 'Правая граница X, см'],
  ['bottomCm', 'Нижняя граница Y, см'],
  ['elevationCm', 'Верх участка от общего нуля, см'],
  ['ceilingElevationCm', 'Минимальная отметка потолка над всем участком, см'],
] as const
const controlClass =
  'min-h-11 w-full border border-line-strong bg-paper px-3 py-2 text-ink focus-visible:outline-2 focus-visible:outline-accent'
const stageNames = {
  lift: 'Подъём',
  translate: 'Перемещение',
  lower: 'Опускание',
  tilt: 'Наклон',
  untilt: 'Возврат положения',
  turn: 'Поворот мебели на площадке',
}
const dimensionFormat = new Intl.NumberFormat('ru-RU', {
  maximumFractionDigits: 2,
  useGrouping: false,
})
function nextFieldId(items: { id: string }[], prefix: string): string {
  const ids = new Set(items.map((item) => item.id))
  let index = items.length + 1
  while (ids.has(`${prefix}-${index}`)) index += 1
  return `${prefix}-${index}`
}

function downloadJson(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }))
  const link = document.createElement('a')
  try {
    link.href = url
    link.download = filename
    document.body.append(link)
    link.click()
  } finally {
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

/** Separate surveyed flight; never an inferred connection in the apartment's route graph. */
export function PlanFurnitureStairCheck({
  geometry,
  profileFields: suppliedProfileFields,
  account,
  onProfileFieldsChange,
}: {
  geometry: PlanGeometry
  profileFields: ProfileFields
  account?: PlanDeliveryAccountContext
  onProfileFieldsChange?: (profile: ProfileFields) => void
}) {
  // The parent also owns unrelated flat-route options. Only these five fields
  // describe the body used by this checker and its portable draft.
  const profileFields: ProfileFields = {
    widthCm: suppliedProfileFields.widthCm,
    depthCm: suppliedProfileFields.depthCm,
    heightCm: suppliedProfileFields.heightCm,
    clearanceCm: suppliedProfileFields.clearanceCm,
    orientation: suppliedProfileFields.orientation,
  }
  const id = `stair-${useId()}`
  const [expanded, setExpanded] = useState(false)
  const [fields, setFields] = useState<Fields>(initialFields)
  const key = `${JSON.stringify(geometry)}:${JSON.stringify(profileFields)}:${JSON.stringify(fields)}`
  const [acknowledgedKey, setAcknowledgedKey] = useState<string>()
  const [checked, setChecked] = useState<{
    key: string
    response: ReturnType<typeof inspectFurnitureStairTransfer>
    delivery?: ReturnType<typeof inspectFurnitureDeliveryViaStairs>
    request?: FurnitureDeliveryReportRequest
  }>()
  const [fileNotice, setFileNotice] = useState<string>()
  const [pendingImport, setPendingImport] = useState<{ text: string; filename: string }>()
  const importGeneration = useRef(0)
  const importContext = useRef({ geometry, profileFields })
  importContext.current = { geometry, profileFields }
  const current = checked?.key === key ? checked.response : undefined
  const reference = geometry.verticalReference
  const floors = reference?.floors.filter((floor) => floor.surface === 'finished-floor') ?? []
  const result = current?.result
  const delivery = checked?.key === key ? checked.delivery?.result : undefined
  const along = (point: { xCm: number; yCm: number }) =>
    fields.direction === 'x' ? point.xCm : point.yCm

  function change<Key extends keyof Fields>(field: Key, value: Fields[Key]) {
    setFields((previous) => ({
      ...previous,
      [field]: value,
      ...(field === 'polygonMode' && value === true ? { turning: false } : {}),
      ...(field === 'turning' && value === true ? { polygonMode: false } : {}),
    }))
    setAcknowledgedKey(undefined)
    setChecked(undefined)
    setFileNotice(undefined)
  }

  async function readDraft(file: File | undefined) {
    const generation = ++importGeneration.current
    setPendingImport(undefined)
    setFileNotice(undefined)
    if (!file) return
    if (file.size > MAX_FURNITURE_DELIVERY_DRAFT_BYTES) {
      setFileNotice('Файл больше 2 МиБ. Обмеры не изменены.')
      return
    }
    try {
      const text = await file.text()
      if (generation !== importGeneration.current) return
      const parsed = parseFurnitureDeliveryDraft(
        text,
        importContext.current.geometry,
        importContext.current.profileFields,
      )
      if (!parsed.fields) {
        setFileNotice(parsed.error ?? 'Не удалось прочитать обмеры.')
        return
      }
      setPendingImport({ text, filename: file.name })
      setFileNotice('Черновик прочитан. Применение заменит поля обмеров и снимет подтверждение.')
    } catch {
      if (generation === importGeneration.current) {
        setFileNotice('Не удалось прочитать файл. Обмеры не изменены.')
      }
    }
  }

  function applyDraft() {
    if (!pendingImport) return
    const parsed = parseFurnitureDeliveryDraft(pendingImport.text, geometry, profileFields)
    if (!parsed.fields) {
      setFileNotice(parsed.error ?? 'Не удалось применить обмеры.')
      return
    }
    setFields(parsed.fields)
    setAcknowledgedKey(undefined)
    setChecked(undefined)
    setPendingImport(undefined)
    setFileNotice('Обмеры загружены без подтверждения. Сверьте их и запустите новую проверку.')
  }

  function saveDraft() {
    try {
      downloadJson(
        serializeFurnitureDeliveryDraft(geometry, profileFields, fields),
        'domitsa-delivery-measurements.json',
      )
      setFileNotice(
        'Файл обмеров подготовлен для скачивания. В аккаунте эти обмеры не сохраняются.',
      )
    } catch {
      setFileNotice('Не удалось выгрузить обмеры. Проверьте длину полей и размер черновика.')
    }
  }

  function saveReport() {
    if (!delivery || !checked?.request || acknowledgedKey !== key) return
    const report = serializeFurnitureDeliveryReport(geometry, checked.request)
    if (!report.text) {
      setFileNotice(report.error ?? 'Полный маршрут не подтверждён; отчёт не выгружен.')
      return
    }
    try {
      downloadJson(report.text, 'domitsa-delivery-route.json')
      setFileNotice(
        'Отчёт повторной проверки подготовлен для скачивания. Это снимок, не гарантия доставки.',
      )
    } catch {
      setFileNotice('Не удалось скачать отчёт. Обмеры и результат на экране не изменены.')
    }
  }
  function check(complete = false) {
    try {
      const request = createFurnitureDeliveryRequest(
        geometry,
        profileFields,
        fields,
        acknowledgedKey === key,
        complete,
      )
      const { survey, profile } = request
      if (complete) {
        const argumentsWithoutAccess = [geometry, survey, profile, request.targetRoomId] as const
        const response = request.accessInput
          ? inspectFurnitureDeliveryViaStairs(...argumentsWithoutAccess, request.accessInput)
          : inspectFurnitureDeliveryViaStairs(...argumentsWithoutAccess)
        setChecked({
          key,
          delivery: response,
          request,
          response: {
            error: response.error,
            notes: response.notes,
            result: response.result?.stairs,
          },
        })
      } else {
        setChecked({ key, response: inspectFurnitureStairTransfer(geometry, survey, profile) })
      }
    } catch {
      setChecked({
        key,
        response: {
          error: 'Проверка не завершена. Сверьте формат JSON, контуры и полный набор обмеров.',
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
          <h4 className="mt-4 text-sm font-medium">
            {fields.polygonMode === true
              ? 'Полигональная лестница — отдельная проверка'
              : fields.turning
                ? 'Поворотная лестница — отдельная проверка'
                : 'Прямой лестничный марш — отдельная проверка'}
          </h4>
          <p className="mt-2 text-xs leading-relaxed text-ink-2">
            Используем габарит, запас и положение по X/Y из полей выше. Это не путь от входной двери
            и не автоматически распознанная лестница. Нужны обмеры всех ступеней и двух площадок
            внутри сверенной схемы. Площадки должны принадлежать выбранным чистовым полам;
            записанные стены, пустоты и препятствия не удаляются.
          </p>
          <div className="mt-3 border-b border-line pb-3">
            <div className="flex flex-wrap gap-3">
              <Button type="button" variant="secondary" onClick={saveDraft}>
                Скачать обмеры JSON
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={!delivery || !checked?.request || acknowledgedKey !== key}
                onClick={saveReport}
              >
                Скачать проверенный маршрут JSON
              </Button>
            </div>
            <label
              htmlFor={`${id}-draft-file`}
              className="mt-3 flex flex-col gap-1 text-sm text-ink-2"
            >
              Открыть файл обмеров (JSON, до 2 МиБ)
              <input
                id={`${id}-draft-file`}
                type="file"
                accept=".json,application/json"
                className={`${controlClass} min-w-0`}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0]
                  event.currentTarget.value = ''
                  void readDraft(file)
                }}
              />
            </label>
            <p className="mt-2 text-xs leading-relaxed text-ink-2">
              Можно сохранить незавершённые обмеры. Файл привязан к этой схеме, общему нулю и
              текущему габариту мебели. Загрузка не подтверждает размеры. Отчёт содержит точные
              данные расчёта X/Y/Z, этапы и ограничения; его нельзя загрузить как обмеры. Файл сам
              по себе не сохраняет обмеры в аккаунте.
            </p>
            {account && onProfileFieldsChange ? (
              <PlanDeliveryAccount
                account={account}
                geometry={geometry}
                profileFields={profileFields}
                fields={fields}
                canSaveChecked={Boolean(delivery && checked?.request && acknowledgedKey === key)}
                onLoaded={(profile, loadedFields) => {
                  onProfileFieldsChange(profile)
                  setFields(loadedFields)
                  setAcknowledgedKey(undefined)
                  setChecked(undefined)
                  setFileNotice(undefined)
                  setPendingImport(undefined)
                }}
              />
            ) : (
              <p className="mt-2 text-xs text-ink-2">Автоматического сохранения в аккаунте нет.</p>
            )}
            {pendingImport ? (
              <div className="mt-2">
                <p className="break-all text-xs text-ink-2">Файл: {pendingImport.filename}</p>
                <Button type="button" variant="secondary" className="mt-2" onClick={applyDraft}>
                  Заменить обмеры из файла
                </Button>
              </div>
            ) : null}
            {fileNotice ? (
              <p className="mt-2 text-xs text-ink-2" role="status">
                {fileNotice}
              </p>
            ) : null}
          </div>
          <label className="mt-3 flex min-h-11 items-start gap-2 text-sm text-ink">
            <input
              id={`${id}-turning`}
              type="checkbox"
              className="mt-1 accent-accent"
              checked={fields.turning === true}
              onChange={(event) => change('turning', event.currentTarget.checked)}
            />
            Задать поворотный марш по обмеренным участкам
          </label>
          <label className="mt-3 flex min-h-11 items-start gap-2 text-sm text-ink">
            <input
              id={`${id}-polygonMode`}
              type="checkbox"
              className="mt-1 accent-accent"
              checked={fields.polygonMode === true}
              onChange={(event) => change('polygonMode', event.currentTarget.checked)}
            />
            Полигональные забежные или винтовые ступени
          </label>
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
            {!fields.turning && !fields.polygonMode ? (
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
            ) : null}
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
            {measurements
              .filter(
                ([field]) =>
                  (!fields.turning && !fields.polygonMode) || field === 'carryClearanceCm',
              )
              .map(([field, label]) => (
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
          {fields.polygonMode === true ? (
            <p className="mt-2 text-xs leading-relaxed text-ink-2">
              Введите массив участков по порядку снизу вверх. Для каждого нужны kind (landing или
              tread), polygon из 3–32 точек xCm/yCm, измеренная station (xCm/yCm), elevationCm и
              ceilingElevationCm от общего нуля. Первый и последний участки — площадки. До 128
              участков и 2048 точек суммарно. Поддерживается один оборот без наложения участков в
              X/Y; центральная пустота не заполняется. Радиус, число ступеней и точки переноса не
              вычисляются вместо обмеров. Учитывайте перила в свободном контуре каждого участка.
            </p>
          ) : !fields.turning ? (
            <p className="mt-2 text-xs leading-relaxed text-ink-2">
              Начало и все отметки — в текущих координатах и общем высотном отсчёте, не локальная
              высота подступёнка. Потолки площадок берутся из подтверждённых мерок полов. Для каждой
              проступи нужен минимальный абсолютный потолок над всей её шириной и глубиной.
              Неизвестные мерки не заменяются числами. При наклоне проверяется полный диагональный
              объём на обеих площадках; все размеры заранее увеличиваются на два запаса.
            </p>
          ) : (
            <p className="mt-2 text-xs leading-relaxed text-ink-2">
              Укажите прямоугольные участки свободного пола по порядку от нижней площадки к верхней,
              независимо от направления переноса. Первый и последний участки — площадки. Соседние
              участки должны соприкасаться общей гранью, не только углом. Поворотная площадка может
              иметь ту же отметку, что соседняя ступень. Все координаты и потолки — абсолютные, в
              текущей схеме и общем высотном отсчёте. Учитывайте перила и препятствия в свободных
              границах. Пустые поля не заменяются предполагаемыми размерами. Не более 128 участков;
              забежные и винтовые ступени здесь не описываются.
            </p>
          )}
          {fields.polygonMode === true ? (
            <label
              htmlFor={`${id}-polygonLayoutJson`}
              className="mt-3 flex flex-col gap-1 text-sm text-ink-2"
            >
              Обмеры полигональных участков (JSON)
              <textarea
                id={`${id}-polygonLayoutJson`}
                className={`${controlClass} min-h-40 font-mono text-xs`}
                value={fields.polygonLayoutJson ?? ''}
                maxLength={200000}
                onChange={(event) => change('polygonLayoutJson', event.currentTarget.value)}
              />
            </label>
          ) : fields.turning ? (
            <div className="mt-4 space-y-3">
              {(fields.layout ?? []).map((section, index) => (
                <fieldset key={section.id} className="border-t border-line pt-3">
                  <legend className="text-sm text-ink">
                    Участок {index + 1} от нижней площадки
                  </legend>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label
                      htmlFor={`${id}-layout-${index}-kind`}
                      className="flex flex-col gap-1 text-sm text-ink-2"
                    >
                      Тип участка
                      <select
                        id={`${id}-layout-${index}-kind`}
                        className={controlClass}
                        value={section.kind}
                        onChange={(event) =>
                          change(
                            'layout',
                            (fields.layout ?? []).map((item, position) =>
                              position === index
                                ? {
                                    ...item,
                                    kind:
                                      event.currentTarget.value === 'tread' ? 'tread' : 'landing',
                                  }
                                : item,
                            ),
                          )
                        }
                      >
                        <option value="landing">Площадка</option>
                        <option value="tread">Проступь</option>
                      </select>
                    </label>
                    {layoutMeasurements.map(([field, label]) => (
                      <label
                        key={field}
                        htmlFor={`${id}-layout-${index}-${field}`}
                        className="flex flex-col gap-1 text-sm text-ink-2"
                      >
                        {label}
                        <input
                          id={`${id}-layout-${index}-${field}`}
                          type="text"
                          inputMode="decimal"
                          maxLength={20}
                          className={controlClass}
                          value={section[field]}
                          onChange={(event) =>
                            change(
                              'layout',
                              (fields.layout ?? []).map((item, position) =>
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
                  disabled={(fields.layout?.length ?? 0) >= 128}
                  onClick={() =>
                    change('layout', [
                      ...(fields.layout ?? []),
                      blankLayout(nextFieldId(fields.layout ?? [], 'layout'), 'tread'),
                    ])
                  }
                >
                  Добавить участок
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={(fields.layout?.length ?? 0) <= 2}
                  onClick={() => change('layout', fields.layout?.slice(0, -1))}
                >
                  Убрать последний участок
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {fields.steps.map((step, index) => (
                <fieldset key={step.id} className="border-t border-line pt-3">
                  <legend className="text-sm text-ink">
                    Ступень {index + 1} от нижней площадки
                  </legend>
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
                    change('steps', [...fields.steps, blankStep(nextFieldId(fields.steps, 'step'))])
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
          )}
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
              id={`${id}-allowQuarterTurns`}
              type="checkbox"
              className="mt-1 accent-accent"
              checked={!!fields.allowQuarterTurns}
              onChange={(event) => change('allowQuarterTurns', event.currentTarget.checked)}
            />
            Разрешить поворот мебели на площадках на 90°. Весь консервативный квадрат поворота
            должен помещаться на одной площадке, не на проступях.
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
            {fields.exteriorEnabled === true || fields.doorLeavesEnabled === true
              ? ' Также сверены включённые обмеры наружной площадки, порога и дверных створок в том же общем отсчёте.'
              : ''}
          </label>
          <Button type="button" variant="secondary" className="mt-3" onClick={() => check()}>
            Проверить марш
          </Button>
          <label
            htmlFor={`${id}-targetRoomId`}
            className="mt-4 flex flex-col gap-1 text-sm text-ink-2"
          >
            Целевая комната для пути от стартовой двери
            <select
              id={`${id}-targetRoomId`}
              className={controlClass}
              value={fields.targetRoomId ?? ''}
              onChange={(event) => change('targetRoomId', event.currentTarget.value)}
            >
              <option value="">Не выбрана</option>
              {geometry.rooms.map((room, index) => (
                <option key={JSON.stringify(room)} value={String(index)}>
                  {room.name}
                </option>
              ))}
            </select>
          </label>
          {(
            [
              [
                'exteriorEnabled',
                'exteriorJson',
                'Проверить наружный занос',
                'Обмеры наружной площадки и порога (JSON)',
              ],
              [
                'doorLeavesEnabled',
                'doorLeavesJson',
                'Учесть обмеренные дверные створки',
                'Обмеры дверных створок (JSON)',
              ],
            ] as const
          ).map(([enabledField, jsonField, title, label]) => (
            <div key={enabledField} className="mt-3">
              <label className="flex min-h-11 items-start gap-2 text-sm text-ink">
                <input
                  id={`${id}-${enabledField}`}
                  type="checkbox"
                  className="mt-1 accent-accent"
                  checked={fields[enabledField] === true}
                  onChange={(event) => change(enabledField, event.currentTarget.checked)}
                />
                {title}
              </label>
              {fields[enabledField] === true ? (
                <>
                  <p className="mb-2 text-xs leading-relaxed text-ink-2">
                    {enabledField === 'exteriorEnabled'
                      ? 'Нужен объект: openingId, outerWallId, outerCut (две точки xCm/yCm), outside (polygon, start, elevationCm, ceilingElevationCm), thresholdElevationCm, carryElevationCm, outerBottomElevationCm, outerTopElevationCm и corridorCeilingElevationCm. Последние три поля — измеренные нижняя и верхняя отметки наружного проёма и минимальный потолок над всей глубиной прохода. Наружные координаты могут быть отрицательными. Нужны обе измеренные грани стены и все обмеры створок: включите их проверку ниже. Высоты — от общего нуля, не высота подступёнка.'
                      : 'Нужен массив для всех дверей схемы: openingId, hinge и closedTip (точки xCm/yCm), thicknessCm, bottomElevationCm, topElevationCm, openAngleDeg от −180 до 180 и mode (fixed-open или moving). 0° — закрыто; положительный угол — по часовой стрелке на плане (X вправо, Y вниз). Толщина включает ручки. moving проверяет консервативный полный круг движения; неподвижная створка — её измеренное открытое положение.'}{' '}
                    Источник и подтверждение берутся из текущих полей; JSON не задаёт свой ключ
                    геометрии или подтверждение.
                  </p>
                  <label
                    htmlFor={`${id}-${jsonField}`}
                    className="flex flex-col gap-1 text-sm text-ink-2"
                  >
                    {label}
                    <textarea
                      id={`${id}-${jsonField}`}
                      className={`${controlClass} min-h-32 font-mono text-xs`}
                      maxLength={200000}
                      value={fields[jsonField] ?? ''}
                      onChange={(event) => change(jsonField, event.currentTarget.value)}
                    />
                  </label>
                </>
              ) : null}
            </div>
          ))}
          <p className="mt-2 text-xs leading-relaxed text-ink-2">
            Выберите стартовую дверь в схеме. Проверяем внутренний путь от её площадки к лестнице и
            далее в комнату.
            {fields.exteriorEnabled === true || fields.doorLeavesEnabled === true
              ? ' Наружный занос и створки проверяются только в едином пути, если соответствующий режим включён и обмеры подтверждены. Кнопка «Проверить марш» их не проверяет. Работа грузчиков не проверяется.'
              : ' Проход снаружи, наружный порог и работа грузчиков не проверены.'}{' '}
            Положение мебели по X/Y на участках квартиры фиксировано.
          </p>
          <Button type="button" variant="secondary" className="mt-3" onClick={() => check(true)}>
            Проверить путь от стартовой двери
          </Button>
          {current ? (
            <div className="mt-3" role="status" aria-live="polite">
              {current.error ? <p className="text-sm text-accent">{current.error}</p> : null}
              {result ? (
                <>
                  <p className="text-sm font-medium">
                    {delivery
                      ? 'exteriorChecked' in delivery && delivery.exteriorChecked === true
                        ? 'Единый путь с наружным заносом построен: '
                        : 'Единый внутренний путь построен: '
                      : fields.polygonMode === true
                        ? 'Локальный путь по полигональному маршу построен: '
                        : fields.turning
                          ? 'Локальный путь по поворотному маршу построен: '
                          : 'Локальный путь по прямому маршу построен: '}
                    {result.travelDirection === 'up' ? 'подъём' : 'спуск'}.
                  </p>
                  {delivery ? (
                    <>
                      <p className="mt-1 text-xs text-ink-2">
                        Цель: {geometry.rooms[Number(delivery.targetRoomId)]?.name}. Стыки участка
                        от двери, лестницы и продолжения совпадают по X/Y/Z. Проверено узлов и
                        этапов: {delivery.checkedNodes} из общего бюджета 6000.
                      </p>
                      {'leavesChecked' in delivery && delivery.leavesChecked === true ? (
                        <p className="mt-1 text-xs text-ink-2">
                          Обмеренные дверные створки учтены в едином пути.
                        </p>
                      ) : null}
                      <svg
                        role="img"
                        aria-label={
                          'exteriorChecked' in delivery && delivery.exteriorChecked === true
                            ? 'Единый план наружного заноса и внутреннего пути через лестницу'
                            : 'Единый план внутреннего пути от стартовой двери через лестницу'
                        }
                        className="mt-3 h-64 w-full border border-line bg-paper"
                        viewBox={(() => {
                          const x = [
                            0,
                            geometry.widthCm,
                            ...delivery.points.map((point) => point.xCm),
                          ]
                          const y = [
                            0,
                            geometry.heightCm,
                            ...delivery.points.map((point) => point.yCm),
                          ]
                          const left = Math.min(...x) - 10
                          const top = Math.min(...y) - 10
                          return `${left} ${top} ${Math.max(...x) - left + 10} ${Math.max(...y) - top + 10}`
                        })()}
                      >
                        {geometry.rooms.map((room) => (
                          <polygon
                            key={JSON.stringify(room.polygon)}
                            points={room.polygon
                              .map((point) => `${point.xCm},${point.yCm}`)
                              .join(' ')}
                            fill="none"
                            stroke="var(--ink-2)"
                            strokeWidth="2"
                          >
                            <title>{room.name}</title>
                          </polygon>
                        ))}
                        {delivery.stairs.regions.map((region) => (
                          <polygon
                            key={region.index}
                            points={region.polygon
                              .map((point) => `${point.xCm},${point.yCm}`)
                              .join(' ')}
                            fill="none"
                            stroke="var(--ink)"
                            strokeWidth="1"
                          />
                        ))}
                        <polyline
                          points={delivery.points
                            .map((point) => `${point.xCm},${point.yCm}`)
                            .join(' ')}
                          fill="none"
                          stroke="var(--accent)"
                          strokeWidth="3"
                        >
                          <title>
                            Непрерывный проверенный путь; высоты проверены в расчёте и этапах
                            лестницы
                          </title>
                        </polyline>
                      </svg>
                    </>
                  ) : null}
                  {delivery && checked?.request ? (
                    <PlanDeliveryVolume
                      geometry={geometry}
                      request={checked.request}
                      result={delivery}
                    />
                  ) : null}
                  <p className="mt-1 text-xs text-ink-2">
                    Переносимый габарит с запасом (приближённо){' '}
                    {dimensionFormat.format(result.carried.widthCm)} ×{' '}
                    {dimensionFormat.format(result.carried.depthCm)} ×{' '}
                    {dimensionFormat.format(result.carried.heightCm)} см; наклон {result.angleDeg}°.
                    Низ меняет высоту на отдельно проверенных этапах, а не держится на одном уровне
                    над всей лестницей.
                    {fields.allowQuarterTurns
                      ? ' Показаны размеры начального положения по X/Y; повороты на площадках меняют их местами. Итоговое положение сохранено в следующих участках пути.'
                      : ''}
                  </p>
                  {(() => {
                    if (fields.turning || fields.polygonMode === true) {
                      const vertices = result.regions.flatMap((region) => region.polygon)
                      const left = Math.min(...vertices.map((point) => point.xCm))
                      const top = Math.min(...vertices.map((point) => point.yCm))
                      const right = Math.max(...vertices.map((point) => point.xCm))
                      const bottom = Math.max(...vertices.map((point) => point.yCm))
                      return (
                        <svg
                          role="img"
                          aria-label="План измеренных участков поворотной лестницы и пути габарита"
                          className="mt-3 h-64 w-full border border-line bg-paper"
                          viewBox={`${left - 10} ${top - 10} ${right - left + 20} ${bottom - top + 20}`}
                        >
                          {result.regions.map((region) => (
                            <polygon
                              key={region.index}
                              points={region.polygon
                                .map((point) => `${point.xCm},${point.yCm}`)
                                .join(' ')}
                              fill="none"
                              stroke="var(--ink)"
                              strokeWidth="2"
                            >
                              <title>{`Участок ${region.index + 1}: пол ${region.elevationCm} см, потолок ${region.ceilingElevationCm} см`}</title>
                            </polygon>
                          ))}
                          {fields.polygonMode === true
                            ? result.points
                                .filter(
                                  (point, index, points) =>
                                    points.findIndex(
                                      (other) => JSON.stringify(other) === JSON.stringify(point),
                                    ) === index,
                                )
                                .map((point, index) => (
                                  <circle
                                    key={JSON.stringify(point)}
                                    cx={point.xCm}
                                    cy={point.yCm}
                                    r="2"
                                    fill="var(--accent)"
                                  >
                                    <title>{`Проверенная позиция ${index + 1}: ${point.xCm}, ${point.yCm}, низ ${point.zCm} см`}</title>
                                  </circle>
                                ))
                            : null}
                          <polyline
                            points={result.points
                              .map((point) => `${point.xCm},${point.yCm}`)
                              .join(' ')}
                            fill="none"
                            stroke="var(--accent)"
                            strokeWidth="3"
                          />
                        </svg>
                      )
                    }
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
                  {!fields.turning && !fields.polygonMode ? (
                    <p className="mt-1 text-xs text-ink-2">
                      Сплошные линии — измеренные верхи ступеней и площадок; пунктир — минимальные
                      потолки; цветная линия — низ габарита. Толщина плит, люди и усилия не
                      показаны.
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-ink-2">
                      План показывает измеренные свободные участки и путь в X/Y. Высотные этапы
                      перечислены ниже; совмещённые на плане подъёмы не исчезают из проверки. Люди,
                      усилия и толщина плит не показаны. Поворот пути не означает вращение мебели.
                    </p>
                  )}
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
                          {stage.kind === 'turn'
                            ? ` Положение ${stage.from.orientation ?? 0}° → ${stage.to.orientation ?? 0}° относительно начального.`
                            : ''}
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
