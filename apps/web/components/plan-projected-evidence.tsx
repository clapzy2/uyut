'use client'

import {
  currentProjectedVerticalEvidence,
  PROJECTED_VERTICAL_LABELS,
} from '@uyut/catalog/plan-projected-vertical-evidence'
import type { PlanGeometry, PlanProjectedVerticalEvidence } from '@uyut/db'
import { Button, inputClassName, toast } from '@uyut/ui'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import {
  getProjectedCaptionSource,
  type ProjectedCaptionSource,
  removeProjectedVerticalEvidence,
  saveProjectedVerticalEvidence,
} from '@/actions/plan-projected-evidence'

const units = { mm: 'мм', cm: 'см', m: 'м' }
type Quantity = PlanProjectedVerticalEvidence['quantity']

export function PlanProjectedEvidence({
  projectId,
  geometry,
  sourceRevision,
  canEdit,
}: {
  projectId: string
  geometry: PlanGeometry
  sourceRevision: string
  canEdit: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [revision, setRevision] = useState(sourceRevision)
  const [sourcePage, setSourcePage] = useState(String(geometry.pdfCalibration?.pdfPage ?? 1))
  const [source, setSource] = useState<ProjectedCaptionSource>()
  const [captionIndex, setCaptionIndex] = useState('')
  const [filter, setFilter] = useState('')
  const [quantity, setQuantity] = useState<Quantity>('floor-level')
  const [target, setTarget] = useState('')
  const [printedValue, setPrintedValue] = useState('')
  const [unit, setUnit] = useState<'mm' | 'cm' | 'm'>('m')
  const [scopeLabel, setScopeLabel] = useState('')
  const [reviewNote, setReviewNote] = useState('')
  const [checked, setChecked] = useState(false)
  const [error, setError] = useState('')
  const ownerKey = JSON.stringify({
    rooms: geometry.rooms,
    walls: geometry.walls,
    openings: geometry.openings,
    sha: geometry.pdfCalibration?.sourceSha256,
    page: geometry.pdfCalibration?.pdfPage,
  })
  const reviewedOwner = useRef(ownerKey)
  useEffect(() => {
    setRevision(sourceRevision)
  }, [sourceRevision])
  useEffect(() => {
    if (reviewedOwner.current === ownerKey) return
    reviewedOwner.current = ownerKey
    setSource(undefined)
    setTarget('')
    setChecked(false)
  }, [ownerKey])
  if (geometry.pdfCalibration?.sourceState !== 'proposed') return null
  const current = currentProjectedVerticalEvidence(geometry)
  const currentIds = new Set(current.map((entry) => entry.id))
  const entries = geometry.projectedVerticalEvidence ?? []
  const caption = source?.captions.find((item) => String(item.index) === captionIndex)
  const available =
    source?.captions.filter((item) =>
      item.text.toLocaleLowerCase('ru').includes(filter.toLocaleLowerCase('ru')),
    ) ?? []

  function openingLabel(opening: PlanGeometry['openings'][number], index: number) {
    const wall = geometry.walls.find((item) => item.id === opening.wallId)
    const rooms = wall
      ? geometry.rooms.filter((room) =>
          room.polygon.some((point, edge) => {
            const end = room.polygon[(edge + 1) % room.polygon.length]
            return (
              point.xCm === wall.start.xCm &&
              point.yCm === wall.start.yCm &&
              end?.xCm === wall.end.xCm &&
              end.yCm === wall.end.yCm
            )
          }),
        )
      : []
    const type = { door: 'дверь', window: 'окно', balcony: 'балконный проём' }[opening.type]
    return `Проём ${index + 1} · ${type} · ${opening.widthCm} см${rooms.length ? ` · ${rooms.map((room) => room.name).join(' / ')}` : ''}`
  }

  function loadSource() {
    setError('')
    start(async () => {
      try {
        const result = await getProjectedCaptionSource(projectId, Number(sourcePage), revision)
        if (!result.ok) {
          setError(result.error)
          return
        }
        setSource(result.data)
        setCaptionIndex('')
        setChecked(false)
      } catch {
        setError('Не удалось открыть источник. Сохранённые отметки не изменены.')
      }
    })
  }
  function save() {
    if (!source || !caption || !target) return
    setError('')
    start(async () => {
      try {
        const owner =
          target === 'project'
            ? { kind: 'project' as const }
            : target.startsWith('room:')
              ? { kind: 'room' as const, roomIndex: Number(target.slice(5)) }
              : { kind: 'opening' as const, openingId: target.slice(8) }
        const result = await saveProjectedVerticalEvidence(
          projectId,
          {
            quantity,
            target: owner,
            printedValue,
            unit,
            sourceSha256: source.sha256,
            sourcePage: source.pdfPage,
            captionIndex: caption.index,
            ...(scopeLabel.trim() ? { scopeLabel: scopeLabel.trim() } : {}),
            ...(reviewNote.trim() ? { reviewNote: reviewNote.trim() } : {}),
            acknowledged: checked,
          },
          revision,
        )
        if (!result.ok) {
          setError(result.error)
          return
        }
        setRevision(result.data.revision)
        setChecked(false)
        toast({ title: 'Проектная подпись сохранена с привязкой к объекту', tone: 'success' })
        router.refresh()
      } catch {
        setError('Ответ сервера не получен. Обновите проект перед повторной записью.')
      }
    })
  }
  function remove(id: string) {
    setError('')
    start(async () => {
      try {
        const result = await removeProjectedVerticalEvidence(projectId, id, revision)
        if (!result.ok) {
          setError(result.error)
          return
        }
        setRevision(result.data.revision)
        router.refresh()
      } catch {
        setError('Ответ сервера не получен. Обновите проект перед повторной записью.')
      }
    })
  }
  return (
    <section className="mt-8 border-t border-line pt-6" aria-labelledby="projected-evidence-title">
      <h2 id="projected-evidence-title" className="font-serif text-2xl">
        Проектные отметки и высоты
      </h2>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-2">
        Подписи из проектного PDF хранятся отдельно от обмеров. Отметка пола, опуск от перекрытия и
        местная высота из развёртки — разные величины. Они не задают неизвестную абсолютную высоту
        потолка, порог или фактический проход и не включают физический 3D.
      </p>
      {geometry.pdfCalibration.floorScope ? (
        <p role="status" className="mt-3 text-sm text-ink-2">
          Пол проверен частично: {geometry.pdfCalibration.floorScope.note}
        </p>
      ) : null}
      <p className="mt-3 text-sm">
        Актуальных привязок: {current.length}. Требуют повторной сверки:{' '}
        {entries.length - current.length}.
      </p>
      {entries.length ? (
        <ul className="mt-3 space-y-3 text-sm" aria-label="Сохранённые проектные подписи">
          {entries.map((entry) => (
            <li key={entry.id} className="border-l-2 border-line pl-3">
              <p>
                {entry.target.kind === 'room'
                  ? entry.target.room.name
                  : entry.target.kind === 'opening'
                    ? `Проём ${entry.target.opening.widthCm} см`
                    : 'Вся квартира'}
                {entry.scopeLabel ? ` · ${entry.scopeLabel}` : ''}:{' '}
                {PROJECTED_VERTICAL_LABELS[entry.quantity]} {entry.printedValue} {units[entry.unit]}
                .{' '}
                {currentIds.has(entry.id)
                  ? 'Привязка актуальна.'
                  : 'Объект или источник изменился; нужна повторная сверка.'}
              </p>
              <p className="mt-1 text-ink-2">
                PDF, страница {entry.source.pdfPage}: «{entry.source.captionTexts.join(' ')}».{' '}
                {entry.reviewNote}
              </p>
              {canEdit ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => remove(entry.id)}
                >
                  Удалить эту проектную подпись
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {canEdit ? (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium">
            Привязать подпись с проектного листа
          </summary>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              <label className="block text-sm">
                Страница источника
                <input
                  aria-label="Страница проектной подписи"
                  type="number"
                  min={1}
                  max={10000}
                  className={inputClassName}
                  value={sourcePage}
                  disabled={pending}
                  onChange={(event) => {
                    setSourcePage(event.target.value)
                    setSource(undefined)
                    setChecked(false)
                  }}
                />
              </label>
              <Button size="sm" variant="secondary" pending={pending} onClick={loadSource}>
                Открыть проектные подписи
              </Button>
              {source ? (
                <>
                  <label className="block text-sm">
                    Найти подпись
                    <input
                      aria-label="Найти проектную подпись"
                      className={inputClassName}
                      value={filter}
                      onChange={(event) => {
                        setFilter(event.target.value)
                        setCaptionIndex('')
                        setChecked(false)
                      }}
                    />
                  </label>
                  <label className="block text-sm">
                    Подпись на листе
                    <select
                      aria-label="Подпись на проектном листе"
                      className={inputClassName}
                      value={captionIndex}
                      disabled={pending}
                      onChange={(event) => {
                        setCaptionIndex(event.target.value)
                        setChecked(false)
                      }}
                    >
                      <option value="">Выберите и сверьте на изображении</option>
                      {available.map((item) => (
                        <option key={item.index} value={item.index}>
                          {item.text} · X {item.x.toFixed(1)}, Y {item.y.toFixed(1)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm">
                    Что означает число
                    <select
                      aria-label="Вид проектной величины"
                      className={inputClassName}
                      value={quantity}
                      disabled={pending}
                      onChange={(event) => {
                        const next = event.target.value as Quantity
                        setQuantity(next)
                        setTarget('')
                        setUnit(next === 'floor-level' ? 'm' : 'mm')
                        setChecked(false)
                      }}
                    >
                      {Object.entries(PROJECTED_VERTICAL_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm">
                    К чему относится
                    <select
                      aria-label="Объект проектной подписи"
                      className={inputClassName}
                      value={target}
                      disabled={pending}
                      onChange={(event) => {
                        setTarget(event.target.value)
                        setChecked(false)
                      }}
                    >
                      <option value="">Выберите объект схемы</option>
                      {quantity === 'slab-height' ? (
                        <option value="project">Вся квартира — между перекрытиями</option>
                      ) : quantity === 'opening-height' ? (
                        geometry.openings.map((opening, index) => (
                          <option key={opening.id} value={`opening:${opening.id}`}>
                            {openingLabel(opening, index)}
                          </option>
                        ))
                      ) : (
                        geometry.rooms.map((room, index) => (
                          <option key={room.name} value={`room:${index}`}>
                            {room.name}
                          </option>
                        ))
                      )}
                    </select>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-sm">
                      Напечатанное число
                      <input
                        aria-label="Напечатанное проектное число"
                        className={inputClassName}
                        value={printedValue}
                        maxLength={100}
                        disabled={pending}
                        onChange={(event) => {
                          setPrintedValue(event.target.value)
                          setChecked(false)
                        }}
                      />
                    </label>
                    <label className="text-sm">
                      Единицы
                      <select
                        aria-label="Единицы проектной величины"
                        className={inputClassName}
                        value={unit}
                        disabled={pending}
                        onChange={(event) => {
                          setUnit(event.target.value as typeof unit)
                          setChecked(false)
                        }}
                      >
                        {Object.entries(units).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label className="block text-sm">
                    Подобласть или обозначение
                    <input
                      aria-label="Подобласть проектной подписи"
                      className={inputClassName}
                      value={scopeLabel}
                      maxLength={300}
                      disabled={pending}
                      onChange={(event) => {
                        setScopeLabel(event.target.value)
                        setChecked(false)
                      }}
                      placeholder="Например, душевая часть или Д5"
                    />
                  </label>
                  <label className="block text-sm">
                    Что остаётся неясным
                    <textarea
                      aria-label="Примечание к проектной подписи"
                      className={inputClassName}
                      value={reviewNote}
                      maxLength={1000}
                      disabled={pending}
                      onChange={(event) => {
                        setReviewNote(event.target.value)
                        setChecked(false)
                      }}
                    />
                  </label>
                  <label className="flex gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={pending}
                      onChange={(event) => setChecked(event.target.checked)}
                    />
                    Сверил число, единицы, вид величины и выбранный объект с проектным листом. Это
                    проектная подпись, не натурный обмер.
                  </label>
                  <Button
                    size="sm"
                    pending={pending}
                    disabled={!checked || !caption || !target || !printedValue.trim()}
                    onClick={save}
                  >
                    Сохранить проектную привязку
                  </Button>
                </>
              ) : null}
              {error ? (
                <p role="alert" className="text-sm text-danger">
                  {error}
                </p>
              ) : null}
            </div>
            {source ? (
              <div className="self-start">
                <p className="mb-2 text-xs text-ink-2">
                  Исходный PDF, страница {source.pdfPage}. Маркер показывает подпись, а не обмер.
                </p>
                <div className="relative overflow-hidden border border-line">
                  {/* biome-ignore lint/performance/noImgElement: The private PDF is already rendered; keep its exact coordinate frame. */}
                  <img
                    src={source.preview}
                    alt={`Проектный лист ${source.pdfPage} для сверки подписи`}
                    className="block h-auto w-full"
                  />
                  {caption ? (
                    <span
                      className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-amber-800 bg-amber-300/50"
                      style={{ left: `${caption.x / 10}%`, top: `${caption.y / 10}%` }}
                    />
                  ) : null}
                  {source.pdfPage === geometry.pdfCalibration.pdfPage &&
                  geometry.pdfCalibration.floorScope?.sourcePoint ? (
                    <span
                      title={geometry.pdfCalibration.floorScope.note}
                      className="absolute h-6 w-6 rounded-full border-2 border-red-700 bg-red-400/40"
                      style={{
                        left: `${geometry.pdfCalibration.floorScope.sourcePoint.x / 10}%`,
                        top: `${geometry.pdfCalibration.floorScope.sourcePoint.y / 10}%`,
                      }}
                    />
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </details>
      ) : null}
    </section>
  )
}
