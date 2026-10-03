'use client'

import type { PlanOpening, PlanOpeningMeasurement, PlanWall } from '@uyut/db'
import { Button, Input } from '@uyut/ui'
import { useState } from 'react'
import {
  openingMeasurementSnapshot,
  openingMeasurementWallSnapshot,
  type VerifyOpeningMeasurementRequest,
} from '@/lib/projects/plan-opening-measurements'

export function PlanOpeningMeasurementEditor({
  opening,
  wall,
  measurement,
  pending,
  required,
  invalidated = false,
  onVerify,
  onRemove,
}: {
  opening: PlanOpening
  wall: PlanWall
  measurement?: PlanOpeningMeasurement
  pending: boolean
  required: boolean
  invalidated?: boolean
  onVerify: (request: VerifyOpeningMeasurementRequest) => void
  onRemove: () => void
}) {
  const [width, setWidth] = useState('')
  const [offset, setOffset] = useState('')
  const [kind, setKind] = useState<PlanOpeningMeasurement['source']['kind']>('site-measurement')
  const [reference, setReference] = useState('')
  const [acknowledgedSnapshot, setAcknowledgedSnapshot] = useState<string>()
  const snapshot = JSON.stringify([
    openingMeasurementSnapshot(opening),
    openingMeasurementWallSnapshot(wall),
    width,
    offset,
    kind,
    reference,
  ])
  const acknowledged = acknowledgedSnapshot === snapshot
  const widthCm = Number(width)
  const offsetCm = Number(offset)
  const length = Math.hypot(wall.end.xCm - wall.start.xCm, wall.end.yCm - wall.start.yCm)
  const valid =
    width.trim() !== '' &&
    offset.trim() !== '' &&
    Number.isFinite(widthCm) &&
    Number.isFinite(offsetCm) &&
    widthCm >= 30 &&
    widthCm <= 1000 &&
    widthCm === Math.round(widthCm * 10) / 10 &&
    offsetCm >= 0 &&
    offsetCm === Math.round(offsetCm * 10) / 10 &&
    offsetCm + widthCm <= length + 1e-7 &&
    reference.trim().length >= 3 &&
    reference.trim().length <= 300

  return (
    <section className="space-y-3 border-t border-line pt-4" aria-label="Сверка мерок проёма">
      <h3 className="text-sm font-medium text-ink">Сверка ширины и привязки</h3>
      <p className="text-xs leading-relaxed text-ink-2">
        На схеме А — начало выбранной стены, Б — конец. Отступ измеряйте от А до ближнего края
        проёма. Координаты А: {wall.start.xCm.toLocaleString('ru-RU')},{' '}
        {wall.start.yCm.toLocaleString('ru-RU')} см.
      </p>
      {invalidated ? (
        <p className="text-xs leading-relaxed text-danger" role="status">
          Проём или стена изменились — прежняя сверка больше не действует. Сверьте обе мерки заново.
        </p>
      ) : null}
      {measurement ? (
        <div className="space-y-1 text-sm text-ink-2" role="status">
          <p>
            {pending ? 'Сверка подготовлена — сохраните черновик.' : 'Мерки сверены пользователем.'}
          </p>
          <p className="break-words">
            {measurement.source.kind === 'site-measurement' ? 'Обмер' : 'Размерный чертёж'}:{' '}
            {measurement.source.reference}
          </p>
          <p>
            {measurement.opening.widthCm.toLocaleString('ru-RU')} см · от начала стены{' '}
            {measurement.opening.offsetCm.toLocaleString('ru-RU')} см
          </p>
          <Button variant="ghost" size="sm" onClick={onRemove}>
            Снять сверку
          </Button>
        </div>
      ) : (
        <p className="text-xs leading-relaxed text-ink-2">
          {required ? 'Для этих мерок нужна отдельная сверка. ' : ''}Введите ширину проёма и
          расстояние от начала выбранной стены до его ближнего края. Используйте существующее
          состояние, не проект перепланировки и не измерение картинки.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Input
          id="opening-measured-width"
          label="Сверенная ширина, см"
          type="number"
          min="30"
          max="1000"
          step="0.1"
          value={width}
          onChange={(event) => setWidth(event.currentTarget.value)}
        />
        <Input
          id="opening-measured-offset"
          label="Сверенный отступ, см"
          type="number"
          min="0"
          max="10000"
          step="0.1"
          value={offset}
          onChange={(event) => setOffset(event.currentTarget.value)}
        />
      </div>
      <label className="block text-[13px] text-ink-2" htmlFor="opening-measurement-source">
        Источник сверки
      </label>
      <select
        id="opening-measurement-source"
        value={kind}
        onChange={(event) =>
          setKind(event.currentTarget.value as PlanOpeningMeasurement['source']['kind'])
        }
        className="h-11 w-full rounded-sm border border-control bg-paper px-3 text-sm text-ink"
      >
        <option value="site-measurement">Обмер квартиры</option>
        <option value="dimensioned-drawing">Размерный чертёж</option>
      </select>
      <Input
        id="opening-measurement-reference"
        label="Откуда взяты мерки"
        hint={
          kind === 'site-measurement'
            ? 'Например: обмер 3 октября, дверь спальни.'
            : 'Название документа, лист и размерная линия существующего состояния.'
        }
        maxLength={300}
        value={reference}
        onChange={(event) => setReference(event.currentTarget.value)}
      />
      <label className="flex items-start gap-3 text-xs leading-relaxed text-ink-2">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
          checked={acknowledged}
          onChange={(event) =>
            setAcknowledgedSnapshot(event.currentTarget.checked ? snapshot : undefined)
          }
        />
        Ширина и привязка сверены по указанному источнику для существующего состояния квартиры.
      </label>
      {!valid && (width || offset || reference) ? (
        <p className="text-xs text-ink-2">
          Нужны обе мерки и описание источника. Шаг — 0,1 см, ширина — от 30 см; проём должен
          помещаться на стене.
        </p>
      ) : null}
      <Button
        variant="secondary"
        size="sm"
        disabled={!valid || !acknowledged}
        onClick={() => {
          onVerify({
            action: 'verify',
            opening: openingMeasurementSnapshot({ ...opening, widthCm, offsetCm }),
            wall: openingMeasurementWallSnapshot(wall),
            source: { kind, reference: reference.trim() },
            acknowledged: true,
          })
          setAcknowledgedSnapshot(undefined)
        }}
      >
        Применить сверенные мерки
      </Button>
      <p className="text-xs leading-relaxed text-ink-2">
        Изменение ширины, привязки или стены сбросит сверку. Высота, подоконник и зона открывания
        проверяются отдельно.
      </p>
    </section>
  )
}
