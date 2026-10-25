'use client'

import {
  currentProjectedVerticalEvidence,
  isPrintedProjectZero,
} from '@uyut/catalog/plan-projected-vertical-evidence'
import type { PlanGeometry } from '@uyut/db'
import { Button, inputClassName } from '@uyut/ui'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import {
  getProjectedCaptionSource,
  type ProjectedCaptionSource,
  reviewProjectedFloorContour,
} from '@/actions/plan-projected-evidence'

const units = { mm: 'мм', cm: 'см', m: 'м' }

export function PlanProjectedFloorReview({
  projectId,
  geometry,
  sourceRevision,
}: {
  projectId: string
  geometry: PlanGeometry
  sourceRevision: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [entryId, setEntryId] = useState('')
  const [source, setSource] = useState<ProjectedCaptionSource>()
  const [zeroIndex, setZeroIndex] = useState('')
  const [wholeRoom, setWholeRoom] = useState(false)
  const [commonZero, setCommonZero] = useState(false)
  const [error, setError] = useState('')
  const floors = currentProjectedVerticalEvidence(geometry).filter(
    (entry) => entry.quantity === 'floor-level' && entry.target.kind === 'room',
  )
  const entry = floors.find((item) => item.id === entryId)
  const zero = source?.captions.find((caption) => String(caption.index) === zeroIndex)
  const caption = source?.captions.find(
    (caption) => caption.index === entry?.source.captionIndexes[0],
  )
  if (geometry.pdfCalibration?.sourceState !== 'proposed') return null

  function openSource() {
    if (!entry) return
    setError('')
    start(async () => {
      try {
        const result = await getProjectedCaptionSource(
          projectId,
          entry.source.pdfPage,
          sourceRevision,
        )
        if (!result.ok) {
          setError(result.error)
          return
        }
        setSource(result.data)
        setZeroIndex('')
        setWholeRoom(false)
        setCommonZero(false)
      } catch {
        setError('Не удалось открыть исходник. Проектные полы не изменены.')
      }
    })
  }

  function save(mode: 'apply' | 'remove') {
    if (!entry) return
    setError('')
    start(async () => {
      try {
        const result = await reviewProjectedFloorContour(
          projectId,
          mode === 'apply'
            ? {
                mode,
                evidenceId: entry.id,
                zeroCaptionIndex: Number(zeroIndex),
                roomContourAcknowledged: wholeRoom,
                commonZeroAcknowledged: commonZero,
              }
            : { mode, evidenceId: entry.id },
          sourceRevision,
        )
        if (!result.ok) {
          setError(result.error)
          return
        }
        router.refresh()
      } catch {
        setError('Ответ сервера не получен. Обновите страницу перед повторной записью.')
      }
    })
  }

  return (
    <details className="mt-6 border-t border-line pt-5">
      <summary className="cursor-pointer text-sm font-medium">
        Сверить целые полы для проектного 3D
      </summary>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-2">
        Отдельная числовая подпись ещё не задаёт поверхность. Здесь можно сверить, что один уровень
        относится ко всему сохранённому контуру и связан с выбранной печатной нулевой отметкой. Это
        проектный просмотр, не подтверждение обмера или прохода мебели.
      </p>
      {floors.length ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <label className="block text-sm">
              Сохранённая отметка пола
              <select
                aria-label="Отметка для проектного пола"
                className={inputClassName}
                value={entryId}
                disabled={pending}
                onChange={(event) => {
                  setEntryId(event.target.value)
                  setSource(undefined)
                  setWholeRoom(false)
                  setCommonZero(false)
                  setZeroIndex('')
                  setError('')
                }}
              >
                <option value="">Выберите отметку и комнату</option>
                {floors.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.target.kind === 'room' ? item.target.room.name : ''} · {item.printedValue}{' '}
                    {units[item.unit]}
                    {item.scopeLabel ? ` · ${item.scopeLabel}` : ''}
                    {item.floorContourReview ? ' · сверено для контура' : ''}
                  </option>
                ))}
              </select>
            </label>
            {entry?.floorContourReview ? (
              <div className="space-y-2 text-sm">
                <p>
                  Контур сверён. Общий ноль: PDF, страница {entry.source.pdfPage}, «
                  {entry.floorContourReview.zeroCaptionText}», подпись{' '}
                  {entry.floorContourReview.zeroCaptionIndex}.
                </p>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => save('remove')}>
                  Отменить применение уровня ко всему контуру
                </Button>
              </div>
            ) : null}
            <Button size="sm" variant="secondary" disabled={pending || !entry} onClick={openSource}>
              Открыть лист для сверки пола
            </Button>
            {source && entry ? (
              <>
                <label className="block text-sm">
                  Общий проектный ноль
                  <select
                    aria-label="Нулевая подпись проектного пола"
                    className={inputClassName}
                    value={zeroIndex}
                    disabled={pending}
                    onChange={(event) => {
                      setZeroIndex(event.target.value)
                      setCommonZero(false)
                    }}
                  >
                    <option value="">Выберите одну исходную нулевую отметку</option>
                    {source.captions
                      .filter((item) => isPrintedProjectZero(item.text))
                      .map((item) => (
                        <option key={item.index} value={item.index}>
                          {item.text} · подпись {item.index} · X {item.x.toFixed(1)}, Y{' '}
                          {item.y.toFixed(1)}
                        </option>
                      ))}
                  </select>
                </label>
                <p className="text-xs text-ink-2">
                  Для связанных полов выбирайте одну и ту же нулевую подпись, а не разные похожие
                  числа. Синяя метка на листе показывает выбранный ноль, янтарная - отметку комнаты.
                </p>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={wholeRoom}
                    disabled={pending}
                    onChange={(event) => setWholeRoom(event.target.checked)}
                  />
                  Сверил: этот уровень относится ко всему контуру комнаты; участков с другим или
                  неизвестным уровнем внутри нет.
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={commonZero}
                    disabled={pending}
                    onChange={(event) => setCommonZero(event.target.checked)}
                  />
                  Сверил: отметка комнаты и выбранный ноль относятся к одному проектному отсчёту на
                  этом листе.
                </label>
                <Button
                  size="sm"
                  disabled={pending || !wholeRoom || !commonZero || !zero || !caption}
                  onClick={() => save('apply')}
                >
                  Сохранить сверку проектного пола
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
                Исходный PDF, страница {source.pdfPage}. Маркеры - привязки подписей, не новые
                обмеры.
              </p>
              <div className="relative overflow-hidden border border-line">
                {/* biome-ignore lint/performance/noImgElement: Native PDF preview must keep its exact marker frame. */}
                <img
                  src={source.preview}
                  alt={`Проектный лист ${source.pdfPage} для сверки пола`}
                  className="block h-auto w-full"
                />
                {caption ? (
                  <span
                    title={`Отметка: ${caption.text}`}
                    className="absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-amber-700 bg-amber-400/40"
                    style={{ left: `${caption.x / 10}%`, top: `${caption.y / 10}%` }}
                  />
                ) : null}
                {zero ? (
                  <span
                    title={`Общий ноль: ${zero.text}`}
                    className="absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-blue-700 bg-blue-400/25"
                    style={{ left: `${zero.x / 10}%`, top: `${zero.y / 10}%` }}
                  />
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-sm text-ink-2">
          Сначала сохраните актуальные проектные отметки пола с привязкой к комнатам.
        </p>
      )}
    </details>
  )
}
