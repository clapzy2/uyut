// biome-ignore-all lint/suspicious/noArrayIndexKey: ordered polygon vertices keep their coordinate-field identity
'use client'

import type { PlanReading } from '@uyut/db'
import { Button, inputClassName } from '@uyut/ui'
import { type MouseEvent, useEffect, useRef, useState } from 'react'
import { savePlanPageReview } from '@/actions/plan-page-review'
import { FormError } from '@/components/form-error'
import {
  canAddPageFeature,
  contourDraftsFromSaved,
  finiteContourPoint,
  nativePointsFromResponse,
  numberedContourRooms,
  type PageContourDraft,
  type PageContourPoint,
  type PageContourTarget,
  type PlanPagePreview,
  pageContourPoint,
  pageContourRoomsForSave,
  previewFromHeaders,
  samePlanPage,
  savedPageOpeningCheck,
  snapPageContourPoint,
} from '@/components/plan-page-contour-editor-model'
import { PlanPageFeatureOverlay } from './plan-page-feature-overlay'
import { type NewPageFeatureKind, PlanPageFeatures } from './plan-page-features'
import { PlanPagePointControls } from './plan-page-point-controls'

const MAX_POINTS = 100

export function PlanPageContourEditor({
  projectId,
  sourceRevision,
  reading,
  pageNumber,
  disabled = false,
  onSaved,
  onConflict,
  onClose,
}: {
  projectId: string
  sourceRevision: string
  reading: PlanReading
  pageNumber: number
  disabled?: boolean
  onSaved: (data: { reading: PlanReading; revision: string }) => void
  onConflict: () => void
  onClose: () => void
}) {
  const eligibleRooms = numberedContourRooms(reading.rooms)
  const [selected, setSelected] = useState(String(eligibleRooms[0]?.sourceNumber ?? ''))
  const [drafts, setDrafts] = useState<PageContourDraft[]>([])
  const [target, setTarget] = useState<PageContourTarget>({ kind: 'room' })
  const [preview, setPreview] = useState<PlanPagePreview>()
  const [imageUrl, setImageUrl] = useState<string>()
  const [imageReady, setImageReady] = useState(false)
  const [nativePoints, setNativePoints] = useState<PageContourPoint[]>([])
  const [proposal, setProposal] = useState<{ point: PageContourPoint; index?: number }>()
  const [nodeFeedback, setNodeFeedback] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const [stale, setStale] = useState(false)
  const [checked, setChecked] = useState(false)
  const [state, setState] = useState<'' | 'existing' | 'proposed'>('')
  const [zoom, setZoom] = useState('100')
  const draftSource = useRef<PlanPagePreview | undefined>(undefined)
  const initialRevision = useRef(sourceRevision)
  const svgRef = useRef<SVGSVGElement>(null)
  const initialReading = useRef(reading)
  const conflictCallback = useRef(onConflict)
  conflictCallback.current = onConflict
  const locked =
    disabled || saving || loading || stale || !preview || !imageReady || nativePoints.length === 0
  const selectedDraft = drafts.find((draft) => draft.roomSourceNumber === Number(selected))
  const roomHasFeatures = Boolean(
    selectedDraft?.openings?.length || selectedDraft?.obstacles?.length,
  )
  const pointsLocked = locked || (target.kind === 'room' && roomHasFeatures)
  const selectedOpening =
    target.kind === 'opening'
      ? selectedDraft?.openings?.find((item) => item.id === target.id)
      : undefined
  const selectedObstacle =
    target.kind === 'obstacle'
      ? selectedDraft?.obstacles?.find((item) => item.id === target.id)
      : undefined
  const points =
    target.kind === 'room'
      ? (selectedDraft?.polygon ?? [])
      : (selectedOpening?.points ?? selectedObstacle?.polygon ?? [])
  const sourceCheck =
    reading.pageReview?.contours.source.state === reading.planState
      ? savedPageOpeningCheck(reading.pageReview, selectedDraft, selectedOpening, preview)
      : undefined
  const closed =
    target.kind === 'room'
      ? Boolean(selectedDraft?.closed)
      : target.kind === 'opening'
        ? points.length === 2
        : Boolean(selectedObstacle?.closed)
  const canDraw =
    !pointsLocked &&
    Boolean(selected) &&
    !closed &&
    points.length < (target.kind === 'opening' ? 2 : MAX_POINTS)

  useEffect(() => {
    const abort = new AbortController()
    let url: string | undefined
    setLoading(true)
    setImageReady(false)
    setError(undefined)
    const query = new URLSearchParams({ page: String(pageNumber), revision: sourceRevision })

    async function load() {
      try {
        const previewUrl = `/api/projects/${projectId}/plan-page?${query}`
        const options = { signal: abort.signal, cache: 'no-store' as const }
        const [response, pointsResponse] = await Promise.all([
          fetch(previewUrl, options),
          fetch(`${previewUrl}&format=points`, options),
        ])
        if (abort.signal.aborted) return
        if (!response.ok || !pointsResponse.ok) {
          const conflict = response.status === 409 || pointsResponse.status === 409
          if (conflict) conflictCallback.current()
          throw new Error(
            conflict
              ? 'Исходный план изменился. Черновик сохранён в форме; закройте разметку и загрузите актуальный план.'
              : 'Не удалось открыть лист. Попробуйте закрыть и снова открыть разметку.',
          )
        }
        const metadata = previewFromHeaders(response.headers, pageNumber)
        const pointsMetadata = previewFromHeaders(pointsResponse.headers, pageNumber)
        if (
          !metadata ||
          !pointsMetadata ||
          !samePlanPage(metadata, pointsMetadata) ||
          !response.headers.get('Content-Type')?.startsWith('image/jpeg') ||
          !pointsResponse.headers.get('Content-Type')?.startsWith('application/json')
        ) {
          throw new Error('Не удалось проверить исходный лист. Разметка пока недоступна.')
        }
        const [blob, pointsValue] = await Promise.all([response.blob(), pointsResponse.json()])
        if (abort.signal.aborted) return
        const nodes = nativePointsFromResponse(pointsValue)
        if (!nodes) {
          throw new Error('На этом листе не удалось проверить векторные узлы для точной привязки.')
        }
        setNativePoints(nodes)
        url = URL.createObjectURL(blob)
        setImageUrl(url)
        setPreview(metadata)
        if (draftSource.current) {
          setStale(
            sourceRevision !== initialRevision.current ||
              !samePlanPage(draftSource.current, metadata),
          )
        } else {
          draftSource.current = metadata
          const saved = initialReading.current.pageReview?.contours
          if (
            saved &&
            samePlanPage(metadata, {
              sha256: saved.source.sha256,
              page: saved.source.pdfPage,
              pageCount: metadata.pageCount,
              width: saved.pageWidth,
              height: saved.pageHeight,
            })
          ) {
            setDrafts(contourDraftsFromSaved(saved.rooms))
          }
        }
      } catch (cause) {
        if (!abort.signal.aborted) {
          setError(cause instanceof Error ? cause.message : 'Не удалось открыть исходный лист.')
          setPreview(undefined)
        }
      } finally {
        if (!abort.signal.aborted) setLoading(false)
      }
    }

    void load()
    return () => {
      abort.abort()
      if (url) URL.revokeObjectURL(url)
    }
  }, [projectId, pageNumber, sourceRevision])

  function changeSelected(polygon: PageContourPoint[], closed = false) {
    if (pointsLocked) return
    const number = Number(selected)
    setDrafts((current) => {
      if (target.kind === 'room') {
        const before = current.find((draft) => draft.roomSourceNumber === number)
        return [
          ...current.filter((draft) => draft.roomSourceNumber !== number),
          ...(polygon.length ? [{ ...before, roomSourceNumber: number, polygon, closed }] : []),
        ]
      }
      return current.map((draft) => {
        if (draft.roomSourceNumber !== number) return draft
        if (target.kind === 'opening') {
          return {
            ...draft,
            openings: draft.openings?.map((opening) =>
              opening.id === target.id ? { ...opening, points: polygon } : opening,
            ),
          }
        }
        return {
          ...draft,
          obstacles: draft.obstacles?.map((obstacle) =>
            obstacle.id === target.id ? { ...obstacle, polygon, closed } : obstacle,
          ),
        }
      })
    })
    resetReview()
  }

  function resetReview() {
    setChecked(false)
    setProposal(undefined)
    setNodeFeedback(undefined)
    setError(undefined)
  }

  function selectTarget(next: PageContourTarget) {
    setTarget(next)
    setProposal(undefined)
    setNodeFeedback(undefined)
  }

  function addFeature(kind: NewPageFeatureKind) {
    if (locked || !canAddPageFeature(selectedDraft, kind)) return
    const id = crypto.randomUUID()
    const opening = kind === 'door' || kind === 'window' || kind === 'balcony'
    setDrafts((current) =>
      current.map((draft) => {
        if (draft.roomSourceNumber !== Number(selected)) return draft
        return opening
          ? {
              ...draft,
              openings: [...(draft.openings ?? []), { id, kind, wallEdgeIndex: 0, points: [] }],
            }
          : {
              ...draft,
              obstacles: [...(draft.obstacles ?? []), { id, kind, polygon: [], closed: false }],
            }
      }),
    )
    setTarget({ kind: opening ? 'opening' : 'obstacle', id })
    resetReview()
  }

  function removeTarget() {
    if (locked) return
    setDrafts((current) =>
      current.flatMap((draft) => {
        if (draft.roomSourceNumber !== Number(selected)) return [draft]
        if (target.kind === 'room') return []
        return [
          {
            ...draft,
            ...(target.kind === 'opening'
              ? { openings: draft.openings?.filter((item) => item.id !== target.id) }
              : { obstacles: draft.obstacles?.filter((item) => item.id !== target.id) }),
          },
        ]
      }),
    )
    setTarget({ kind: 'room' })
    resetReview()
  }

  function changeEdge(wallEdgeIndex: number) {
    if (locked || target.kind !== 'opening') return
    setDrafts((current) =>
      current.map((draft) =>
        draft.roomSourceNumber === Number(selected)
          ? {
              ...draft,
              openings: draft.openings?.map((item) =>
                item.id === target.id ? { ...item, wallEdgeIndex } : item,
              ),
            }
          : draft,
      ),
    )
    resetReview()
  }

  function proposePoint(point: PageContourPoint, index?: number) {
    if (pointsLocked || !preview || (index === undefined && !canDraw)) return
    const candidate = snapPageContourPoint(point, nativePoints, preview)
    setChecked(false)
    setProposal(undefined)
    if (candidate.kind === 'none') {
      setNodeFeedback(
        'Рядом нет узла исходного PDF. Увеличьте лист и отметьте пересечение линий точнее.',
      )
    } else if (candidate.kind === 'ambiguous') {
      setNodeFeedback(
        'Рядом несколько одинаково близких узлов. Увеличьте лист и уточните вершину — неоднозначная привязка не сохранится.',
      )
    } else {
      setProposal({ point: candidate.point, ...(index !== undefined ? { index } : {}) })
      setNodeFeedback(
        'Проверьте отмеченный узел на листе и примите привязку. Координаты берутся из исходного PDF без округления.',
      )
    }
  }

  function acceptNode() {
    if (!proposal || pointsLocked) return
    const polygon =
      proposal.index === undefined
        ? [...points, { ...proposal.point }]
        : points.map((point, index) => (index === proposal.index ? { ...proposal.point } : point))
    changeSelected(polygon, proposal.index === undefined ? false : closed)
    setNodeFeedback(
      'Вершина привязана к узлу исходного PDF. Это привязка к линиям листа, не подтверждение размера в сантиметрах.',
    )
  }

  function choosePoint(event: MouseEvent<HTMLButtonElement>) {
    if (event.detail === 0 || !svgRef.current) return
    const point = pageContourPoint(
      { x: event.clientX, y: event.clientY },
      svgRef.current.getBoundingClientRect(),
    )
    if (point) proposePoint(point)
  }

  async function save() {
    if (locked || !preview || !checked || proposal) return
    if (!state || state !== reading.planState) {
      setError('Выберите состояние, которое обозначено на этом листе и в прочитанном плане.')
      return
    }
    const rooms = pageContourRoomsForSave(drafts, nativePoints)
    if (!rooms) {
      setError(
        'Замкните начатые контуры, отметьте оба конца каждого проёма и привяжите все точки к узлам PDF. Незавершённые объекты не исключаются из сохранения автоматически.',
      )
      return
    }
    setSaving(true)
    setError(undefined)
    try {
      const result = await savePlanPageReview(
        projectId,
        {
          source: { sha256: preview.sha256, pdfPage: preview.page, state },
          coordinateSystem: 'page-0-1000',
          review: 'manual-source-review',
          pageWidth: preview.width,
          pageHeight: preview.height,
          rooms,
        },
        sourceRevision,
      )
      if (!result.ok) {
        setError(result.error)
        if (result.code === 'plan-conflict') {
          setStale(true)
          onConflict()
        }
        return
      }
      onSaved(result.data)
    } catch {
      setError(
        'Ответ сервера не получен. Черновик остался в форме; перед повторным сохранением проверьте актуальную версию плана.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-5 border-y border-line py-6" aria-labelledby="page-contour-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mb-1 text-[11px] uppercase tracking-[0.12em] text-ink-2">
            Исходный лист · страница {pageNumber}
          </p>
          <h3 id="page-contour-title" className="font-serif text-2xl text-ink">
            Комнаты и объекты на исходном плане
          </h3>
        </div>
        <Button variant="ghost" size="sm" disabled={saving} onClick={onClose}>
          Закрыть разметку
        </Button>
      </div>
      <p className="text-sm leading-relaxed text-ink-2">
        Отметьте углы внутренней границы комнаты по порядку, включая ниши, и примите каждый узел
        исходного PDF. Номер комнаты должен совпадать с подписью на листе. Эта разметка связывает
        размерные линии с комнатой; масштаб в сантиметрах и 2D-расстановка проверяются отдельно.
      </p>
      {eligibleRooms.length !== reading.rooms.length ? (
        <p className="border-l-2 border-accent pl-3 text-sm leading-relaxed text-ink-2">
          Комнаты без номера на листе и с повторяющимся номером не доступны для разметки. Сначала
          уточните номера в прочитанном плане.
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="block">Комната по номеру на листе</span>
          <select
            className={inputClassName}
            value={selected}
            disabled={locked}
            onChange={(event) => {
              setSelected(event.target.value)
              selectTarget({ kind: 'room' })
            }}
          >
            {eligibleRooms.length === 0 ? (
              <option value="">Нет комнат с уникальным номером</option>
            ) : null}
            {eligibleRooms.map((room) => (
              <option key={room.sourceNumber} value={room.sourceNumber}>
                № {room.sourceNumber} · {room.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="block">Что изображено на листе</span>
          <select
            className={inputClassName}
            value={state}
            disabled={locked}
            onChange={(event) => {
              setState(event.target.value as typeof state)
              setChecked(false)
            }}
          >
            <option value="">Выберите по названию листа</option>
            <option value="existing">Существующее состояние / обмерный план</option>
            <option value="proposed">Проектное состояние / план изменений</option>
          </select>
        </label>
      </div>
      {selected ? (
        <PlanPageFeatures
          key={`features-${selected}-${target.kind}-${target.kind === 'room' ? '' : target.id}`}
          draft={selectedDraft}
          target={target}
          locked={locked}
          onSelect={selectTarget}
          onAdd={addFeature}
          onRemove={removeTarget}
          onChangeEdge={changeEdge}
          sourceCheck={sourceCheck}
        />
      ) : null}
      {loading ? (
        <p role="status" className="text-sm text-ink-2">
          Открываем выбранный лист…
        </p>
      ) : null}
      {imageUrl && preview ? (
        <div className="space-y-2">
          <label className="flex items-center gap-3 text-xs text-ink-2">
            Масштаб просмотра
            <select
              className={`${inputClassName} h-9 w-24`}
              value={zoom}
              disabled={saving}
              onChange={(event) => setZoom(event.target.value)}
            >
              <option value="100">100%</option>
              <option value="150">150%</option>
              <option value="200">200%</option>
            </select>
          </label>
          <div className="max-h-[70vh] max-w-3xl overflow-auto border border-line bg-[#fff]">
            <button
              type="button"
              disabled={!canDraw}
              onClick={choosePoint}
              className="block w-full disabled:cursor-default enabled:cursor-crosshair"
              style={{ width: `${zoom}%` }}
              aria-label={
                target.kind === 'opening'
                  ? 'Отметить конец проёма на исходном листе'
                  : 'Добавить вершину контура на исходном листе'
              }
              aria-describedby="page-contour-coordinate-help"
            >
              <svg
                ref={svgRef}
                viewBox="0 0 1000 1000"
                preserveAspectRatio="none"
                role="img"
                aria-label={`Исходный план, страница ${preview.page}`}
                className="block w-full"
                style={{ aspectRatio: `${preview.width} / ${preview.height}` }}
              >
                <title>Лист с разметкой комнат по печатным номерам</title>
                <image
                  href={imageUrl}
                  width="1000"
                  height="1000"
                  preserveAspectRatio="none"
                  onLoad={() => setImageReady(true)}
                  onError={() => {
                    setImageReady(false)
                    setError(
                      'Изображение листа не открылось. Закройте разметку и попробуйте ещё раз.',
                    )
                  }}
                />
                {proposal ? (
                  <g pointerEvents="none">
                    <circle
                      cx={proposal.point.x}
                      cy={proposal.point.y}
                      r={8}
                      fill="white"
                      stroke="#222"
                      strokeWidth={2}
                      vectorEffect="non-scaling-stroke"
                    />
                    <circle cx={proposal.point.x} cy={proposal.point.y} r={2} fill="#222" />
                  </g>
                ) : null}
                {drafts.map((draft) => {
                  const isSelected = draft.roomSourceNumber === Number(selected)
                  const valid = draft.polygon.every(finiteContourPoint)
                  const coordinates = draft.polygon
                    .map((point) => `${point.x},${point.y}`)
                    .join(' ')
                  return (
                    <g
                      key={draft.roomSourceNumber}
                      className={isSelected ? 'text-accent' : 'text-ink-2'}
                      pointerEvents="none"
                    >
                      {valid && draft.closed ? (
                        <polygon
                          points={coordinates}
                          fill="currentColor"
                          fillOpacity={0.16}
                          stroke="currentColor"
                          strokeWidth={2}
                          vectorEffect="non-scaling-stroke"
                        />
                      ) : null}
                      {valid && !draft.closed ? (
                        <polyline
                          points={coordinates}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          vectorEffect="non-scaling-stroke"
                        />
                      ) : null}
                      {draft.polygon.filter(finiteContourPoint).map((point, index) => (
                        <circle
                          key={index}
                          cx={point.x}
                          cy={point.y}
                          r={4}
                          fill="currentColor"
                          stroke="white"
                          strokeWidth={1}
                        />
                      ))}
                      {draft.polygon[0] && finiteContourPoint(draft.polygon[0]) ? (
                        <text
                          x={draft.polygon[0].x + 8}
                          y={draft.polygon[0].y - 8}
                          fill="currentColor"
                          stroke="white"
                          strokeWidth={3}
                          paintOrder="stroke"
                          fontSize={18}
                          fontWeight={600}
                        >
                          № {draft.roomSourceNumber}
                        </text>
                      ) : null}
                    </g>
                  )
                })}
                <PlanPageFeatureOverlay
                  drafts={drafts}
                  roomNumber={Number(selected)}
                  target={target}
                />
              </svg>
            </button>
          </div>
        </div>
      ) : null}
      <p id="page-contour-coordinate-help" className="text-xs leading-relaxed text-ink-2">
        Лист можно прокручивать внутри окна и увеличивать. Нажмите возле угла комнаты, проверьте
        предложенный узел и нажмите «Принять узел PDF». Для клавиатуры используйте поля ниже: X —
        слева направо, Y — сверху вниз, от 0 до 1000. Это координаты листа, не размеры комнаты.
      </p>
      {nodeFeedback ? (
        <p role="status" className="text-sm leading-relaxed text-ink-2">
          {nodeFeedback}
        </p>
      ) : null}
      {proposal ? (
        <div className="flex flex-wrap items-center gap-3 border-l-2 border-accent pl-3">
          <p className="text-xs text-ink-2">
            Узел PDF: X ≈ {proposal.point.x.toFixed(2)}, Y ≈ {proposal.point.y.toFixed(2)}
          </p>
          <Button size="sm" variant="secondary" disabled={locked} onClick={acceptNode}>
            Принять узел PDF
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={locked}
            onClick={() => {
              setProposal(undefined)
              setNodeFeedback(undefined)
            }}
          >
            Отменить привязку
          </Button>
        </div>
      ) : null}
      {selected ? (
        <PlanPagePointControls
          key={`points-${selected}-${target.kind}-${target.kind === 'room' ? '' : target.id}`}
          points={points}
          closed={closed}
          opening={target.kind === 'opening'}
          locked={pointsLocked}
          canDraw={canDraw}
          nativePoints={nativePoints}
          onChange={changeSelected}
          onPropose={proposePoint}
          onError={setError}
        />
      ) : null}
      {target.kind === 'room' && roomHasFeatures ? (
        <p className="text-xs leading-relaxed text-ink-2">
          У комнаты уже размечены объекты. Чтобы изменить порядок её вершин, сначала удалите эти
          объекты: иначе номера сторон проёмов станут неверными. Каждый объект можно выбрать и
          поправить отдельно.
        </p>
      ) : null}
      {stale ? (
        <FormError message="Лист или версия плана изменились. Черновик не отправлен. Закройте разметку и откройте актуальный лист, чтобы начать новую сверку." />
      ) : null}
      <FormError message={error} />
      <div className="space-y-3 border-t border-line pt-4">
        <p className="text-xs text-ink-2">
          Размечено комнат: {drafts.filter((draft) => draft.closed).length}. Другие комнаты можно
          добавить позже; отсутствующие размеры не вычисляются из площади.
        </p>
        <label className="flex items-start gap-3 text-sm leading-relaxed">
          <input
            type="checkbox"
            className="mt-1 size-4 accent-accent"
            checked={checked}
            disabled={locked}
            onChange={(event) => setChecked(event.target.checked)}
          />
          <span>
            Сверил контуры, проёмы, неподвижные объекты, номера комнат и состояние квартиры с
            исходным листом.
          </span>
        </label>
        <Button
          pending={saving}
          disabled={locked || !checked || !state || drafts.length === 0 || Boolean(proposal)}
          onClick={save}
        >
          Сохранить разметку листа
        </Button>
        <p className="text-xs leading-relaxed text-ink-2">
          Сохранение не запускает генерацию или повторное чтение. Разметка привязана к этому файлу и
          странице; при замене плана потребуется новая сверка.
        </p>
      </div>
    </section>
  )
}
