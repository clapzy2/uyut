// biome-ignore-all lint/suspicious/noArrayIndexKey: vertices are ordered and only appended or removed from the end
'use client'

import type { PlanImageCalibration, PlanPoint } from '@uyut/db'
import { Button, Input } from '@uyut/ui'
import { useEffect, useRef, useState } from 'react'
import {
  planImageConfirmationIssue,
  validPlanImageCalibration,
} from '@/lib/projects/plan-image-calibration'
import {
  type ImageContourPoint,
  imageContourFromMetric,
  traceImageContour,
} from '@/lib/projects/plan-image-contour'
import {
  type RasterRegionGuide,
  rasterCandidateSourceSha256,
  rasterCornerResponse,
  rasterLabelPoint,
  rasterRegionAt,
  rasterRegionResponse,
  rasterRegionStraightEdges,
  rasterRegionTraceDraft,
  snapRasterCorner,
} from '@/lib/projects/plan-raster-snap'

export function PlanImageContourTrace({
  planUrl,
  calibration,
  points,
  widthCm,
  heightCm,
  maxPoints,
  label,
  onChange,
  cornerSourceUrl,
  labelAnchor,
}: {
  planUrl: string
  calibration: PlanImageCalibration
  points: PlanPoint[] | undefined
  widthCm: number
  heightCm: number
  maxPoints: number
  label: string
  onChange: (points: PlanPoint[], sourcePixels: ImageContourPoint[]) => void
  cornerSourceUrl?: string
  labelAnchor?: { x: number; y: number; sourceSha256?: string; page?: number }
}) {
  const [tracing, setTracing] = useState(false)
  const [vertices, setVertices] = useState<ImageContourPoint[]>([])
  const [imageMatches, setImageMatches] = useState(false)
  const [error, setError] = useState<string>()
  const [corners, setCorners] = useState<ImageContourPoint[]>([])
  const [regions, setRegions] = useState<RasterRegionGuide[]>([])
  const [regionsUncertain, setRegionsUncertain] = useState(false)
  const [selectedRegion, setSelectedRegion] = useState<RasterRegionGuide>()
  const [selectingRegion, setSelectingRegion] = useState(false)
  const [selectingFocus, setSelectingFocus] = useState(false)
  const [cornersLoading, setCornersLoading] = useState(false)
  const [useCorners, setUseCorners] = useState(false)
  const [cornerNotice, setCornerNotice] = useState<string>()
  const [candidateSourceSha256, setCandidateSourceSha256] = useState<string>()
  const request = useRef<AbortController | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: source identity changes must clear cached candidates and abort the old request
  useEffect(() => {
    setCorners([])
    setRegions([])
    setRegionsUncertain(false)
    setSelectedRegion(undefined)
    setSelectingRegion(false)
    setSelectingFocus(false)
    setUseCorners(false)
    setCornerNotice(undefined)
    setCandidateSourceSha256(undefined)
    setCornersLoading(false)
    return () => request.current?.abort()
  }, [
    cornerSourceUrl,
    calibration.sourceSha256,
    calibration.pdfPage,
    calibration.imageWidthPx,
    calibration.imageHeightPx,
  ])

  async function loadCorners(focus?: ImageContourPoint) {
    if (!cornerSourceUrl || cornersLoading) return
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setCornersLoading(true)
    setUseCorners(false)
    setCorners([])
    // Global and focused region IDs are local to their own scan. Never mix
    // their guides or leave an old selection over a different source window.
    setRegions([])
    setRegionsUncertain(false)
    setSelectedRegion(undefined)
    setSelectingRegion(false)
    setSelectingFocus(false)
    setCornerNotice(undefined)
    setCandidateSourceSha256(undefined)
    try {
      const url = new URL(cornerSourceUrl, window.location.href)
      if (focus) {
        url.searchParams.set('focusX', String(Math.floor(focus.x)))
        url.searchParams.set('focusY', String(Math.floor(focus.y)))
      }
      const response = await fetch(url, {
        signal: controller.signal,
        cache: 'no-store',
      })
      if (!response.ok) throw new Error('Corners unavailable')
      const payload: unknown = await response.json()
      const candidates = rasterCornerResponse(
        payload,
        calibration.imageWidthPx,
        calibration.imageHeightPx,
        calibration.pdfPage ?? 1,
        calibration.sourceSha256,
      )
      const regionGuides = rasterRegionResponse(
        payload,
        calibration.imageWidthPx,
        calibration.imageHeightPx,
        calibration.pdfPage ?? 1,
        calibration.sourceSha256,
      )
      if (controller.signal.aborted) return
      if (!candidates && !regionGuides) {
        setCornerNotice('Подсказки неполные или источник изменился. Продолжайте обводку вручную.')
        return
      }
      setCandidateSourceSha256(
        rasterCandidateSourceSha256(
          payload,
          calibration.imageWidthPx,
          calibration.imageHeightPx,
          calibration.pdfPage ?? 1,
          calibration.sourceSha256,
        ),
      )
      setCorners(candidates ?? [])
      setRegions(regionGuides?.regions ?? [])
      setRegionsUncertain(regionGuides?.uncertain ?? false)
      const focusedRegion = focus ? rasterRegionAt(focus, regionGuides?.regions ?? []) : undefined
      setSelectedRegion(focusedRegion)
      const partial =
        payload && typeof payload === 'object' && 'truncated' in payload && payload.truncated
      setCornerNotice(
        focus
          ? `На участке найдено углов чернил: ${candidates?.length ?? 0}; замкнутых светлых областей: ${regionGuides?.regions.length ?? 0}. ${focusedRegion ? 'Область под нажатием показана для сверки. ' : ''}Области, обрезанные краем участка, отброшены. Это неполные подсказки, а не подтверждённый пол. Сверьте контур с исходником.`
          : `Найдено углов чернил: ${candidates?.length ?? 0}; светлых областей: ${regionGuides?.regions.length ?? 0}. ${partial ? 'Подсказки неполные из-за плотного чертежа; отсутствие точки ничего не доказывает. ' : ''}Это не подтверждённые границы пола.`,
      )
    } catch {
      if (!controller.signal.aborted)
        setCornerNotice('Подсказки не загрузились. Обводка вручную остаётся доступной.')
    } finally {
      if (!controller.signal.aborted) setCornersLoading(false)
    }
  }
  const calibrationIssue = !validPlanImageCalibration(calibration, widthCm, heightCm)
    ? 'Проверьте калибровку изображения и размеры полотна.'
    : planImageConfirmationIssue(calibration)
  const displayed = tracing
    ? vertices
    : calibrationIssue
      ? []
      : imageContourFromMetric(points ?? [], calibration)
  const candidateEdges = selectedRegion
    ? rasterRegionStraightEdges(selectedRegion, calibration.imageWidthPx, calibration.imageHeightPx)
    : []
  const regionDraft = selectedRegion ? rasterRegionTraceDraft(selectedRegion, maxPoints) : undefined
  const labelPoint = rasterLabelPoint(labelAnchor, {
    width: calibration.imageWidthPx,
    height: calibration.imageHeightPx,
    sha256: calibration.sourceSha256 ?? candidateSourceSha256,
    page: calibration.pdfPage ?? 1,
  })
  const labelRegion = labelPoint ? rasterRegionAt(labelPoint, regions) : undefined

  function start() {
    setVertices([])
    setTracing(true)
    setSelectingRegion(false)
    setSelectingFocus(false)
    setError(undefined)
  }

  function apply() {
    const result = traceImageContour(vertices, calibration, widthCm, heightCm, maxPoints)
    if (!result || !imageMatches) {
      setError(
        'Контур не применён: проверьте масштаб, минимум три разных угла, пересечения и границы полотна.',
      )
      return
    }
    onChange(
      result,
      vertices.map((point) => ({ ...point })),
    )
    setTracing(false)
    setError(undefined)
  }

  return (
    <details className="my-4 border border-line p-3">
      <summary className="cursor-pointer text-[14px]">Обвести на исходнике · {label}</summary>
      <p className="my-3 text-[13px] text-ink-2">
        Отмечайте углы внутренней границы по порядку, включая диагональ. Первая точка не
        повторяется. Общий пол и пол балкона как комнаты обводятся отдельно. Стены и проёмы не
        создаются; результат попадёт только в черновик редактора.
      </p>
      <div className="relative inline-block max-w-full">
        <button
          type="button"
          aria-label={
            selectingRegion
              ? `Выбрать внешний контур области: ${label}`
              : selectingFocus
                ? `Выбрать место для поиска углов: ${label}`
                : `Добавить угол контура: ${label}`
          }
          disabled={
            (!tracing && !selectingRegion && !selectingFocus) ||
            !imageMatches ||
            Boolean(calibrationIssue) ||
            (tracing && vertices.length >= maxPoints)
          }
          className="block max-w-full disabled:cursor-default"
          onClick={(event) => {
            if (event.detail === 0) return
            const image = event.currentTarget.querySelector('img')
            if (!image) return
            const rect = image.getBoundingClientRect()
            if (!rect.width || !rect.height) return
            const pointer = {
              x: ((event.clientX - rect.left) * image.naturalWidth) / rect.width,
              y: ((event.clientY - rect.top) * image.naturalHeight) / rect.height,
            }
            if (selectingRegion) {
              const region = rasterRegionAt(pointer, regions)
              setSelectedRegion(region)
              setSelectingRegion(false)
              setCornerNotice(
                region
                  ? 'Внешний контур области показан пунктиром. Сверьте его и обведите край пола вручную.'
                  : 'Вокруг этой точки нет однозначного контура. Нажмите приблизительно внутри нужной области.',
              )
              return
            }
            if (selectingFocus) {
              void loadCorners(pointer)
              return
            }
            const snapped = useCorners ? snapRasterCorner(pointer, corners) : undefined
            const point = snapped ?? pointer
            if (useCorners)
              setCornerNotice(
                snapped
                  ? 'Новый угол привязан к ближайшей границе чернил. Сверьте его на исходнике.'
                  : 'Однозначного угла рядом нет — точка оставлена по вашему нажатию.',
              )
            setVertices((current) => [...current, point])
            setError(undefined)
          }}
        >
          {/* biome-ignore lint/performance/noImgElement: signed source image preserves original coordinates */}
          <img
            src={planUrl}
            alt={`Исходник для обводки: ${label}`}
            className="block max-h-[32rem] max-w-full"
            onLoad={(event) =>
              setImageMatches(
                event.currentTarget.naturalWidth === calibration.imageWidthPx &&
                  event.currentTarget.naturalHeight === calibration.imageHeightPx,
              )
            }
            onError={() => setImageMatches(false)}
          />
        </button>
        <svg
          aria-hidden="true"
          viewBox={`0 0 ${calibration.imageWidthPx} ${calibration.imageHeightPx}`}
          className="pointer-events-none absolute inset-0 h-full w-full"
        >
          {selectedRegion ? (
            <>
              <polygon
                points={selectedRegion.polygon.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="#00788a"
                fillOpacity="0.12"
                stroke="#00788a"
                strokeDasharray="7 5"
                strokeWidth="2"
              />
              {candidateEdges.map(({ start, end, connectedAtBothEnds }, index) => (
                <line
                  key={`${start.x}-${start.y}-${end.x}-${end.y}`}
                  data-edge-index={index}
                  data-seedable={connectedAtBothEnds}
                  x1={start.x}
                  y1={start.y}
                  x2={end.x}
                  y2={end.y}
                  stroke={connectedAtBothEnds ? '#186c55' : '#b87522'}
                  strokeDasharray={connectedAtBothEnds ? '3 3' : '2 5'}
                  strokeWidth="3"
                />
              ))}
            </>
          ) : null}
          {imageMatches && labelRegion && labelPoint ? (
            <circle
              cx={labelPoint.x}
              cy={labelPoint.y}
              r="9"
              fill="none"
              stroke="#a62e70"
              strokeWidth="3"
            />
          ) : null}
          {useCorners
            ? corners.map((point, index) => (
                <circle
                  key={`guide-${index}`}
                  cx={point.x}
                  cy={point.y}
                  r="3"
                  fill="#00788a"
                  opacity="0.65"
                />
              ))
            : null}
          <polyline
            points={displayed.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke="#ca4766"
            strokeWidth="3"
          />
          {!tracing && displayed.length >= 3 ? (
            <line
              x1={displayed.at(-1)?.x}
              y1={displayed.at(-1)?.y}
              x2={displayed[0]?.x}
              y2={displayed[0]?.y}
              stroke="#ca4766"
              strokeWidth="3"
            />
          ) : null}
          {displayed.map((p, index) => (
            <circle key={`${index}-${p.x}-${p.y}`} cx={p.x} cy={p.y} r="5" fill="#ca4766" />
          ))}
        </svg>
      </div>
      {cornerSourceUrl ? (
        <div className="my-3 space-y-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={cornersLoading || !imageMatches || Boolean(calibrationIssue)}
            onClick={() => void loadCorners()}
          >
            {cornersLoading ? 'Ищем границы изображения…' : 'Найти углы по пикселям'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={cornersLoading || !imageMatches || Boolean(calibrationIssue)}
            onClick={() => {
              setSelectingRegion(false)
              setSelectingFocus(true)
            }}
          >
            {selectingFocus
              ? 'Нажмите внутри нужного участка'
              : 'Искать углы и области на участке плана'}
          </Button>
          {corners.length ? (
            <label className="flex min-h-11 items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={useCorners}
                onChange={(event) => setUseCorners(event.currentTarget.checked)}
                className="accent-accent"
              />
              Помогать привязкой новых углов к изображению
            </label>
          ) : null}
          {regions.length ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={tracing || !imageMatches || Boolean(calibrationIssue)}
                onClick={() => setSelectingRegion(true)}
              >
                {selectingRegion
                  ? 'Нажмите внутри интересующей области'
                  : 'Показать внешний контур области'}
              </Button>
              {selectedRegion ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setSelectedRegion(undefined)}
                >
                  Скрыть подсказку
                </Button>
              ) : null}
            </div>
          ) : null}
          {labelRegion ? (
            <div className="space-y-2 text-[12px] text-ink-2">
              <p>
                Розовый круг — примерная точка, которую модель дважды связала с комнатой «{label}».
                Она может быть не на самой подписи. Сверьте, что выбранная светлая область относится
                именно к этой комнате: два совпавших ответа модели этого не доказывают.
              </p>
              {!selectedRegion ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={!imageMatches || Boolean(calibrationIssue) || tracing}
                  onClick={() => setSelectedRegion(labelRegion)}
                >
                  Показать область у подписи для сверки
                </Button>
              ) : null}
            </div>
          ) : null}
          {selectedRegion ? (
            <div className="space-y-2">
              <p role="status" className="text-[12px] text-ink-2">
                Это светлая область изображения, а не готовый пол. Её граница может включать дугу
                двери, мебель и подписи. Нажатие внутри внешнего контура не проверяет, попали ли вы
                на тёмный штрих. Зелёный пунктир — стороны, с которых можно начать обводку; янтарный
                с редкими штрихами — стороны с сомнительными концами. Это не подтверждение стен или
                размеров; одиночные стороны могут быть пропущены.
                {selectedRegion.hasInteriorIslands || regionsUncertain
                  ? ' На исходнике есть внутренние штрихи или неоднозначные области.'
                  : ''}
              </p>
              {!tracing && regionDraft ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={!imageMatches || Boolean(calibrationIssue)}
                  onClick={() => {
                    setVertices(regionDraft.map((point) => ({ ...point })))
                    setTracing(true)
                    setSelectingRegion(false)
                    setError(undefined)
                    setCornerNotice(
                      'Пиксельный контур скопирован только в редактируемую обводку. Сверьте каждую грань с исходником и поправьте ошибки перед отдельным применением в черновик.',
                    )
                  }}
                >
                  Взять контур области для правки ({regionDraft.length} углов)
                </Button>
              ) : null}
              {!tracing && !regionDraft ? (
                <p className="text-[12px] text-ink-2">
                  Контур слишком подробный для обводки без потери формы. Начните с проверенной
                  стороны и добавьте нужные углы вручную.
                </p>
              ) : null}
              {!tracing && candidateEdges.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {candidateEdges.map(({ start, end, connectedAtBothEnds }, index) => (
                    <Button
                      key={`${start.x}-${start.y}-${end.x}-${end.y}`}
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={!connectedAtBothEnds || !imageMatches || Boolean(calibrationIssue)}
                      onClick={() => {
                        setVertices([start, end])
                        setTracing(true)
                        setSelectingRegion(false)
                        setError(undefined)
                        setCornerNotice(
                          'Два пиксельных угла добавлены в обводку. Проверьте эту сторону на исходнике, поправьте координаты и дорисуйте остальной пол вручную.',
                        )
                      }}
                    >
                      {connectedAtBothEnds ? 'Начать со стороны' : 'Проверить конец стороны'}{' '}
                      {index + 1}: ({start.x}, {start.y}) → ({end.x}, {end.y})
                    </Button>
                  ))}
                </div>
              ) : null}
              {candidateEdges.some((edge) => !edge.connectedAtBothEnds) ? (
                <p className="text-[12px] text-ink-2">
                  Сторона с короткими соседними штрихами остаётся подсказкой, но её конец нельзя
                  взять как готовый угол. Добавьте его вручную после сверки с исходником.
                </p>
              ) : null}
            </div>
          ) : null}
          <p className="text-[12px] text-ink-2">
            Подсказки могут относиться к надписям, мебели и размерным линиям. Привязка не меняет уже
            отмеченные углы, не создаёт стены и не подтверждает обмер.
          </p>
          {cornerNotice ? (
            <p role="status" className="text-[13px] text-ink-2">
              {cornerNotice}
            </p>
          ) : null}
        </div>
      ) : null}
      {calibrationIssue ? <p className="my-2 text-[13px] text-accent">{calibrationIssue}</p> : null}
      {!imageMatches ? (
        <p className="my-2 text-[13px] text-ink-2">
          Изображение должно загрузиться с теми же размерами, что при калибровке.
        </p>
      ) : null}
      {!tracing ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={!imageMatches || Boolean(calibrationIssue)}
          onClick={start}
        >
          Начать новую обводку
        </Button>
      ) : (
        <>
          <p className="my-2 text-[13px]">
            Углов: {vertices.length} / {maxPoints}. Замыкание — только при применении.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={vertices.length === 0}
              onClick={() => setVertices((current) => current.slice(0, -1))}
            >
              Убрать последний угол
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={vertices.length >= maxPoints}
              onClick={() => setVertices((current) => [...current, { x: 0, y: 0 }])}
            >
              Добавить угол числом
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={vertices.length < 3 || !imageMatches || Boolean(calibrationIssue)}
              onClick={apply}
            >
              Применить обводку в черновик
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setTracing(false)
                setError(undefined)
              }}
            >
              Отменить обводку
            </Button>
          </div>
          {vertices.map((p, index) => (
            <div key={`${index}`} className="mt-2 grid grid-cols-2 gap-2">
              {(['x', 'y'] as const).map((axis) => (
                <Input
                  key={axis}
                  id={`trace-${index}-${axis}`}
                  label={`Угол ${index + 1} · ${axis.toUpperCase()}, пикс.`}
                  type="number"
                  min="0"
                  max={axis === 'x' ? calibration.imageWidthPx : calibration.imageHeightPx}
                  step="0.1"
                  value={p[axis]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value)
                    setVertices((current) =>
                      current.map((point, at) =>
                        at === index ? { ...point, [axis]: value } : point,
                      ),
                    )
                  }}
                />
              ))}
            </div>
          ))}
        </>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-[13px] text-danger">
          {error}
        </p>
      ) : null}
    </details>
  )
}
