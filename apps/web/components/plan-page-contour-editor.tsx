// biome-ignore-all lint/suspicious/noArrayIndexKey: ordered polygon vertices keep their coordinate-field identity
'use client'

import type {
  PlanPageContours,
  PlanPageEndpointProof,
  PlanPageVertexProof,
  PlanReading,
} from '@uyut/db'
import { Button, inputClassName } from '@uyut/ui'
import { type MouseEvent, useEffect, useMemo, useRef, useState } from 'react'
import { savePlanPageReview } from '@/actions/plan-page-review'
import { FormError } from '@/components/form-error'
import {
  canAddPageFeature,
  contourDraftsFromSaved,
  dimensionLabelsFromResponse,
  fillHintsFromResponse,
  finiteContourPoint,
  groupPageContourDraft,
  nativePointsFromResponse,
  nativeSegmentsFromResponse,
  numberedContourRooms,
  type PageContourDraft,
  type PageContourPoint,
  type PageContourTarget,
  type PageDimensionLabel,
  type PageVoidDraft,
  type PlanFillHints,
  type PlanPagePreview,
  pageContourOptions,
  pageContourPoint,
  pageContourProgress,
  pageContourRoomsForSave,
  pageContourVertexProofsChanged,
  pageContourVoidsForSave,
  pageExteriorForSave,
  pageFloorForSave,
  pageOpeningPointsChanged,
  previewFromHeaders,
  samePlanPage,
  savedPageOpeningCheck,
  snapPageContourPoint,
  snapPageOpeningPoint,
  voidDraftsFromSaved,
} from '@/components/plan-page-contour-editor-model'
import type { SourceFloorReference } from '@/lib/projects/plan-page-source-floors'
import type { NativePageSegment } from '@/lib/projects/plan-pdf-opening-endpoint'
import {
  pdfContourIdentity,
  pdfContourKey,
  pdfContourRoomNumbers,
} from '@/lib/projects/plan-pdf-room-binding'
import { type PageBoundaryKind, PlanPageBoundaryControls } from './plan-page-boundary-controls'
import { sourceEdgeCandidates } from './plan-page-edge-candidates'
import { PlanPageEdgeDimensions } from './plan-page-edge-dimensions'
import { PlanPageFeatureOverlay } from './plan-page-feature-overlay'
import { type NewPageFeatureKind, PlanPageFeatures } from './plan-page-features'
import { PlanPagePointControls } from './plan-page-point-controls'
import { PlanPageSourceFloorControls } from './plan-page-source-floor-controls'
import {
  sourceFloorBlockersForEdge,
  sourceFloorDraft,
  sourceFloorReferenceFromResponse,
  sourceFloorReferencePath,
} from './plan-page-source-floor-model'
import { snapPageSourceContourPoint } from './plan-page-vertex-candidate'

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
  const [voids, setVoids] = useState<PageVoidDraft[]>([])
  const [selectedVoidId, setSelectedVoidId] = useState<string>()
  const [exterior, setExterior] = useState<PlanPageContours['exterior']>()
  const [exteriorClosed, setExteriorClosed] = useState(false)
  const [floor, setFloor] = useState<PlanPageContours['floor']>()
  const [floorClosed, setFloorClosed] = useState(false)
  const [editingBoundary, setEditingBoundary] = useState<PageBoundaryKind>()
  const [target, setTarget] = useState<PageContourTarget>({ kind: 'room' })
  const [preview, setPreview] = useState<PlanPagePreview>()
  const [imageUrl, setImageUrl] = useState<string>()
  const [imageReady, setImageReady] = useState(false)
  const [nativePoints, setNativePoints] = useState<PageContourPoint[]>([])
  const [nativeSegments, setNativeSegments] = useState<NativePageSegment[]>([])
  const [dimensionLabels, setDimensionLabels] = useState<PageDimensionLabel[]>([])
  const [dimensionHighlight, setDimensionHighlight] = useState<{
    roomKey: string
    edge?: number
    indexes: number[]
  }>()
  const [proposal, setProposal] = useState<{
    point: PageContourPoint
    index?: number
    proof?: PlanPageEndpointProof
    vertexProof?: PlanPageVertexProof
  }>()
  const [nodeFeedback, setNodeFeedback] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const [stale, setStale] = useState(false)
  const [checked, setChecked] = useState(false)
  const [state, setState] = useState<'' | 'existing' | 'proposed'>('')
  const [zoom, setZoom] = useState('100')
  const [sourceFloors, setSourceFloors] = useState<SourceFloorReference>()
  const [sourceFloorsShown, setSourceFloorsShown] = useState(false)
  const [sourceFloorsLoading, setSourceFloorsLoading] = useState(false)
  const [sourceFloorsError, setSourceFloorsError] = useState<string>()
  const [sourceEdgeHighlight, setSourceEdgeHighlight] = useState<{
    revision: string
    page: number
    floorId: string
    ringIndex: number
    edgeIndex: number
  }>()
  const [sourceStrokeHighlight, setSourceStrokeHighlight] = useState<{
    edgeKey: string
    sourceRef: string
  }>()
  const [sourceBlockerHighlight, setSourceBlockerHighlight] = useState<{
    edgeKey: string
    operationIndex: number
  }>()
  const [traceReferences, setTraceReferences] = useState<
    Record<
      string,
      {
        draft: PageContourDraft
        revision: string
        page: number
      }
    >
  >({})
  const [fillHints, setFillHints] = useState<PlanFillHints>()
  const [fillHintsShown, setFillHintsShown] = useState(false)
  const [fillHintsLoading, setFillHintsLoading] = useState(false)
  const [fillHintsError, setFillHintsError] = useState<string>()
  const [selectedFillHint, setSelectedFillHint] = useState('')
  const sourceFloorsRequest = useRef<AbortController | undefined>(undefined)
  const fillHintsRequest = useRef<AbortController | undefined>(undefined)
  const draftSource = useRef<PlanPagePreview | undefined>(undefined)
  const initialRevision = useRef(sourceRevision)
  const svgRef = useRef<SVGSVGElement>(null)
  const initialReading = useRef(reading)
  const conflictCallback = useRef(onConflict)
  conflictCallback.current = onConflict
  const locked =
    disabled || saving || loading || stale || !preview || !imageReady || nativePoints.length === 0
  const options = pageContourOptions(reading.rooms, drafts)
  const sourceRooms =
    reading.pageReview?.sourceRooms ??
    eligibleRooms.map((room) => ({ sourceNumber: room.sourceNumber as number, name: room.name }))
  const progress = pageContourProgress(sourceRooms, reading.rooms, drafts)
  const physicalRoomCount = progress.filter((room) => room.status === 'physical').length
  const selectedIdentity = options.find((option) => option.key === selected)?.identity
  const selectedDraft = drafts.find((draft) => pdfContourKey(draft) === selected)
  const selectedTrace = traceReferences[selected]
  const selectedTraceReference =
    selectedTrace?.revision === sourceRevision && selectedTrace.page === pageNumber
      ? selectedTrace.draft
      : selectedDraft?.sourceTrace
        ? {
            ...pdfContourIdentity(selectedDraft),
            polygon: selectedDraft.sourceTrace.polygon,
            closed: true,
            sourceTopology: selectedDraft.sourceTrace.sourceTopology,
          }
        : undefined
  const selectedVoid = voids.find((draft) => draft.id === selectedVoidId)
  const groupCandidates = eligibleRooms.filter(
    (room) =>
      room.sourceNumber !== selectedIdentity?.roomSourceNumber &&
      !drafts.some((draft) => pdfContourRoomNumbers(draft).includes(room.sourceNumber as number)),
  )
  const roomHasFeatures =
    Boolean(
      selectedDraft?.openings?.length ||
        selectedDraft?.obstacles?.length ||
        selectedDraft?.conditionalEdges?.length,
    ) || Boolean(selectedDraft?.dimensionEdges?.length)
  const pointsLocked =
    locked ||
    (!editingBoundary && !selectedVoid && target.kind === 'room' && roomHasFeatures) ||
    (!editingBoundary && !selectedVoid && Boolean(selectedDraft?.sourceTopology))
  const selectedOpening =
    target.kind === 'opening'
      ? selectedDraft?.openings?.find((item) => item.id === target.id)
      : undefined
  const selectedObstacle =
    target.kind === 'obstacle'
      ? selectedDraft?.obstacles?.find((item) => item.id === target.id)
      : undefined
  const points = editingBoundary
    ? ((editingBoundary === 'floor' ? floor : exterior)?.polygon ?? [])
    : selectedVoid
      ? selectedVoid.polygon
      : target.kind === 'room'
        ? (selectedDraft?.polygon ?? [])
        : (selectedOpening?.points ?? selectedObstacle?.polygon ?? [])
  const sourceCheck =
    reading.pageReview?.contours.source.state === reading.planState
      ? savedPageOpeningCheck(reading.pageReview, selectedDraft, selectedOpening, preview)
      : undefined
  const closed = editingBoundary
    ? editingBoundary === 'floor'
      ? floorClosed
      : exteriorClosed
    : selectedVoid
      ? selectedVoid.closed
      : target.kind === 'room'
        ? Boolean(selectedDraft?.closed)
        : target.kind === 'opening'
          ? points.length === 2
          : Boolean(selectedObstacle?.closed)
  const canDraw =
    !pointsLocked &&
    Boolean(editingBoundary || selectedVoid || selected) &&
    !closed &&
    points.length <
      (!editingBoundary && !selectedVoid && target.kind === 'opening' ? 2 : MAX_POINTS)
  const nextSourceTracePoint =
    target.kind === 'room' &&
    !editingBoundary &&
    !selectedVoid &&
    points.every((point, index) => {
      const sourcePoint = selectedTraceReference?.polygon[index]
      return sourcePoint?.x === point.x && sourcePoint.y === point.y
    })
      ? selectedTraceReference?.polygon[points.length]
      : undefined
  const currentSourceFloors =
    sourceFloors?.sourceRevision === sourceRevision &&
    preview &&
    samePlanPage(preview, {
      sha256: sourceFloors.source.sha256,
      page: sourceFloors.source.pdfPage,
      pageCount: preview.pageCount,
      width: sourceFloors.pageWidth,
      height: sourceFloors.pageHeight,
    }) &&
    state === 'existing'
      ? sourceFloors
      : undefined
  const sourceRoomKey =
    selectedIdentity?.roomSourceNumber === undefined
      ? undefined
      : String(selectedIdentity.roomSourceNumber)
  const selectedSourceFloor =
    currentSourceFloors?.status === 'checked'
      ? currentSourceFloors.floors.find((item) => item.sourceRoomKey === sourceRoomKey)
      : undefined
  const currentFillHints =
    fillHints?.sourceRevision === sourceRevision &&
    fillHints.sourceSha256 === preview?.sha256 &&
    fillHints.page === pageNumber
      ? fillHints
      : undefined
  const selectedPaintHint = fillHintsShown
    ? currentFillHints?.candidates.find((candidate) => candidate.id === selectedFillHint)
    : undefined
  const highlightedSourceEdge =
    sourceFloorsShown &&
    selectedSourceFloor &&
    sourceEdgeHighlight?.revision === sourceRevision &&
    sourceEdgeHighlight.page === pageNumber &&
    sourceEdgeHighlight.floorId === selectedSourceFloor.id
      ? sourceEdgeHighlight
      : undefined
  const highlightedSourceRing = highlightedSourceEdge
    ? [selectedSourceFloor?.polygon, ...(selectedSourceFloor?.holes ?? [])][
        highlightedSourceEdge.ringIndex
      ]
    : undefined
  const highlightedSourceSegment =
    highlightedSourceRing && highlightedSourceEdge
      ? [
          highlightedSourceRing[highlightedSourceEdge.edgeIndex],
          highlightedSourceRing[
            (highlightedSourceEdge.edgeIndex + 1) % highlightedSourceRing.length
          ],
        ]
      : undefined
  const highlightedEdgeKey = highlightedSourceEdge
    ? `${sourceRevision}:${pageNumber}:${highlightedSourceEdge.floorId}:${highlightedSourceEdge.ringIndex}:${highlightedSourceEdge.edgeIndex}`
    : undefined
  const highlightedMaterialSpans =
    selectedSourceFloor?.materialSupports?.status === 'diagnostic' &&
    highlightedSourceEdge?.ringIndex === 0
      ? selectedSourceFloor.materialSupports.spans.filter(
          (span) => span.wallEdgeIndex === highlightedSourceEdge.edgeIndex,
        )
      : []
  const nearbySourceEdges = useMemo(
    () =>
      highlightedSourceSegment?.[0] && highlightedSourceSegment[1] && preview
        ? sourceEdgeCandidates(
            [highlightedSourceSegment[0], highlightedSourceSegment[1]],
            nativeSegments,
            preview,
          )
        : undefined,
    [highlightedSourceSegment?.[0], highlightedSourceSegment?.[1], nativeSegments, preview],
  )
  const selectedSourceStroke =
    sourceStrokeHighlight &&
    highlightedEdgeKey &&
    sourceStrokeHighlight.edgeKey === highlightedEdgeKey &&
    nearbySourceEdges?.status === 'checked'
      ? nearbySourceEdges.candidates.find(
          ({ segment }) =>
            `${segment.operationIndex}:${segment.subpathIndex}:${segment.segmentIndex}` ===
            sourceStrokeHighlight.sourceRef,
        )?.segment
      : undefined
  const selectedSourceBlocker =
    sourceBlockerHighlight &&
    highlightedEdgeKey &&
    sourceBlockerHighlight.edgeKey === highlightedEdgeKey &&
    currentSourceFloors?.blockerPaint?.status === 'checked' &&
    sourceFloorBlockersForEdge(
      currentSourceFloors,
      selectedSourceFloor?.id,
      highlightedSourceEdge?.ringIndex,
      highlightedSourceEdge?.edgeIndex,
    ).includes(sourceBlockerHighlight.operationIndex)
      ? currentSourceFloors.blockerPaint.events.find(
          (event) => event.operationIndex === sourceBlockerHighlight.operationIndex,
        )
      : undefined
  const sourceFloorConversion = useMemo(
    () =>
      sourceFloorsShown && preview
        ? sourceFloorDraft(selectedSourceFloor)
        : { kind: 'held' as const, reason: 'missing-selection' as const },
    [sourceFloorsShown, selectedSourceFloor, preview],
  )

  useEffect(() => {
    const abort = new AbortController()
    let url: string | undefined
    setLoading(true)
    sourceFloorsRequest.current?.abort()
    fillHintsRequest.current?.abort()
    setSourceFloors(undefined)
    setFillHints(undefined)
    setFillHintsShown(false)
    setFillHintsLoading(false)
    setFillHintsError(undefined)
    setSelectedFillHint('')
    setSourceFloorsShown(false)
    setSourceFloorsError(undefined)
    setSourceFloorsLoading(false)
    setImageReady(false)
    setError(undefined)
    setVoids([])
    setSelectedVoidId(undefined)
    setExterior(undefined)
    setExteriorClosed(false)
    setFloor(undefined)
    setFloorClosed(false)
    setEditingBoundary(undefined)
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
        const segments = nativeSegmentsFromResponse(pointsValue)
        const labels = dimensionLabelsFromResponse(pointsValue)
        if (!nodes || !segments || !labels) {
          throw new Error('На этом листе не удалось проверить векторные узлы для точной привязки.')
        }
        setNativePoints(nodes)
        setNativeSegments(segments)
        setDimensionLabels(labels)
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
            saved.source.state === initialReading.current.planState &&
            samePlanPage(metadata, {
              sha256: saved.source.sha256,
              page: saved.source.pdfPage,
              pageCount: metadata.pageCount,
              width: saved.pageWidth,
              height: saved.pageHeight,
            })
          ) {
            setDrafts(contourDraftsFromSaved(saved.rooms))
            setVoids(voidDraftsFromSaved(saved.voids))
            const first = saved.rooms[0]
            if (first) setSelected(pdfContourKey(first))
            setExterior(saved.exterior ? structuredClone(saved.exterior) : undefined)
            setExteriorClosed(Boolean(saved.exterior))
            setFloor(saved.floor ? structuredClone(saved.floor) : undefined)
            setFloorClosed(Boolean(saved.floor))
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
      sourceFloorsRequest.current?.abort()
      fillHintsRequest.current?.abort()
      if (url) URL.revokeObjectURL(url)
    }
  }, [projectId, pageNumber, sourceRevision])

  async function toggleFillHints() {
    if (locked || fillHintsLoading || !preview || state !== 'existing') return
    if (currentFillHints) {
      setFillHintsShown((shown) => !shown)
      return
    }
    const request = new AbortController()
    fillHintsRequest.current?.abort()
    fillHintsRequest.current = request
    setFillHintsLoading(true)
    setFillHintsError(undefined)
    try {
      const query = new URLSearchParams({
        page: String(pageNumber),
        revision: sourceRevision,
        format: 'fill-hints',
      })
      const response = await fetch(`/api/projects/${projectId}/plan-page?${query}`, {
        signal: request.signal,
        cache: 'no-store',
      })
      if (request.signal.aborted) return
      if (response.status === 409) {
        setStale(true)
        conflictCallback.current()
        throw new Error('План изменился. Откройте актуальную версию листа.')
      }
      const metadata = previewFromHeaders(response.headers, pageNumber)
      if (
        !response.ok ||
        !metadata ||
        !samePlanPage(preview, metadata) ||
        !response.headers.get('Content-Type')?.startsWith('application/json')
      )
        throw new Error('Не удалось открыть подсказки заливок этого листа.')
      const hints = fillHintsFromResponse(await response.json(), preview, sourceRevision)
      if (request.signal.aborted) return
      if (!hints) throw new Error('Подсказки не совпадают с открытым исходным листом.')
      setFillHints(hints)
      setFillHintsShown(true)
    } catch (cause) {
      if (!request.signal.aborted)
        setFillHintsError(cause instanceof Error ? cause.message : 'Не удалось открыть подсказки.')
    } finally {
      if (!request.signal.aborted) setFillHintsLoading(false)
    }
  }

  async function toggleSourceFloors() {
    if (locked || sourceFloorsLoading || !preview || state !== 'existing') return
    if (currentSourceFloors) {
      setSourceFloorsShown((shown) => !shown)
      return
    }
    const request = new AbortController()
    sourceFloorsRequest.current?.abort()
    sourceFloorsRequest.current = request
    setSourceFloors(undefined)
    setSourceFloorsShown(false)
    setSourceFloorsError(undefined)
    setSourceFloorsLoading(true)
    try {
      const query = new URLSearchParams({
        page: String(pageNumber),
        revision: sourceRevision,
        format: 'source-floor-reference',
        openingInspection: '1',
        evidenceVersion: '3',
      })
      const response = await fetch(`/api/projects/${projectId}/plan-page?${query}`, {
        signal: request.signal,
        cache: 'no-store',
      })
      if (request.signal.aborted) return
      if (response.status === 409) {
        setStale(true)
        conflictCallback.current()
        throw new Error('План изменился. Закройте разметку и загрузите актуальную версию.')
      }
      const metadata = previewFromHeaders(response.headers, pageNumber)
      if (
        !response.ok ||
        !response.headers.get('Content-Type')?.startsWith('application/json') ||
        !metadata ||
        !samePlanPage(preview, metadata)
      )
        throw new Error('Не удалось проверить исходную область. Рабочая разметка не изменена.')
      const reference = sourceFloorReferenceFromResponse(
        await response.json(),
        preview,
        sourceRevision,
      )
      if (request.signal.aborted) return
      if (!reference) throw new Error('Ответ исходной области не соответствует открытому листу.')
      setSourceFloors(reference)
      setSourceFloorsShown(true)
    } catch (cause) {
      if (!request.signal.aborted)
        setSourceFloorsError(
          cause instanceof Error ? cause.message : 'Не удалось открыть исходную область.',
        )
    } finally {
      if (!request.signal.aborted) setSourceFloorsLoading(false)
    }
  }

  function copySourceFloor() {
    if (
      locked ||
      sourceFloorsLoading ||
      !sourceFloorsShown ||
      editingBoundary ||
      selectedVoid ||
      target.kind !== 'room' ||
      selectedDraft ||
      !sourceRoomKey ||
      sourceFloorConversion.kind !== 'candidate'
    )
      return
    const candidate = structuredClone(sourceFloorConversion.draft)
    setDrafts((current) =>
      current.some((draft) =>
        pdfContourRoomNumbers(draft).includes(candidate.roomSourceNumber as number),
      )
        ? current
        : [...current, candidate],
    )
    setSourceFloorsShown(false)
    resetReview()
  }

  function startPhysicalTrace() {
    if (locked || !selectedDraft?.sourceTopology || editingBoundary || selectedVoid) return
    setTraceReferences((current) => ({
      ...current,
      [selected]: {
        draft: structuredClone(selectedDraft),
        revision: sourceRevision,
        page: pageNumber,
      },
    }))
    setDrafts((current) =>
      current.map((draft) =>
        pdfContourKey(draft) === selected && draft.sourceTopology
          ? {
              ...pdfContourIdentity(draft),
              polygon: [],
              closed: false,
              sourceTrace: {
                polygon: structuredClone(draft.polygon),
                sourceTopology: structuredClone(draft.sourceTopology),
              },
            }
          : draft,
      ),
    )
    setTarget({ kind: 'room' })
    setProposal(undefined)
    resetReview()
  }

  function restoreSourceTrace() {
    if (locked || !selectedTraceReference || editingBoundary || selectedVoid) return
    if (
      selectedDraft &&
      (selectedDraft.polygon.length > 0 || roomHasFeatures) &&
      !window.confirm('Заменить текущую физическую обводку исходным черновиком?')
    )
      return
    setDrafts((current) =>
      current.map((draft) =>
        pdfContourKey(draft) === selected ? structuredClone(selectedTraceReference) : draft,
      ),
    )
    setTraceReferences((current) => {
      const next = { ...current }
      delete next[selected]
      return next
    })
    setTarget({ kind: 'room' })
    setProposal(undefined)
    resetReview()
  }

  function changeSelected(
    polygon: PageContourPoint[],
    closed = false,
    replacement?: {
      index: number
      proof?: PlanPageEndpointProof
      vertexProof?: PlanPageVertexProof
    },
  ) {
    if (pointsLocked) return
    if (editingBoundary) {
      if (editingBoundary === 'floor') {
        setFloor((current) => ({
          polygon,
          vertexProofs: pageContourVertexProofsChanged(current, polygon, replacement),
        }))
        setFloorClosed(closed)
      } else {
        setExterior((current) => ({
          ...current,
          polygon,
          vertexProofs: pageContourVertexProofsChanged(current, polygon, replacement),
        }))
        setExteriorClosed(closed)
      }
      resetReview()
      return
    }
    if (selectedVoid) {
      setVoids((current) =>
        current.map((draft) =>
          draft.id === selectedVoid.id ? { ...draft, polygon, closed } : draft,
        ),
      )
      resetReview()
      return
    }
    if (!selectedIdentity) return
    setDrafts((current) => {
      if (target.kind === 'room') {
        const before = current.find((draft) => pdfContourKey(draft) === selected)
        return [
          ...current.filter((draft) => pdfContourKey(draft) !== selected),
          ...(polygon.length || selectedIdentity.roomSourceNumbers || before?.sourceTrace
            ? [
                {
                  ...pdfContourIdentity(selectedIdentity),
                  polygon,
                  closed,
                  vertexProofs: pageContourVertexProofsChanged(before, polygon, replacement),
                  ...(before?.sourceTrace ? { sourceTrace: before.sourceTrace } : {}),
                  ...(before?.openings ? { openings: before.openings } : {}),
                  ...(before?.conditionalEdges
                    ? { conditionalEdges: before.conditionalEdges }
                    : {}),
                  ...(before?.obstacles ? { obstacles: before.obstacles } : {}),
                  ...(before?.dimensionEdges ? { dimensionEdges: before.dimensionEdges } : {}),
                },
              ]
            : []),
        ]
      }
      return current.map((draft) => {
        if (pdfContourKey(draft) !== selected) return draft
        if (target.kind === 'opening') {
          return {
            ...draft,
            openings: draft.openings?.map((opening) =>
              opening.id === target.id
                ? pageOpeningPointsChanged(opening, polygon, replacement)
                : opening,
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
    setDimensionHighlight(undefined)
    setSelectedVoidId(undefined)
    setEditingBoundary(undefined)
    setTarget(next)
    setProposal(undefined)
    setNodeFeedback(undefined)
  }

  function addVoid() {
    if (locked || voids.length >= 20) return
    const id = crypto.randomUUID()
    setVoids((current) => [...current, { id, polygon: [], closed: false }])
    setSelectedVoidId(id)
    setEditingBoundary(undefined)
    setTarget({ kind: 'room' })
    resetReview()
  }

  function removeVoid() {
    if (locked || !selectedVoid) return
    setVoids((current) => current.filter((draft) => draft.id !== selectedVoid.id))
    setSelectedVoidId(undefined)
    setTarget({ kind: 'room' })
    resetReview()
  }

  function addFeature(kind: NewPageFeatureKind) {
    if (locked || !canAddPageFeature(selectedDraft, kind)) return
    const id = crypto.randomUUID()
    const opening = kind === 'door' || kind === 'window' || kind === 'balcony'
    setDrafts((current) =>
      current.map((draft) => {
        if (pdfContourKey(draft) !== selected) return draft
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
    if (target.kind === 'room' && selectedTraceReference)
      setTraceReferences((current) => {
        const next = { ...current }
        delete next[selected]
        return next
      })
    setDrafts((current) =>
      current.flatMap((draft) => {
        if (pdfContourKey(draft) !== selected) return [draft]
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
    if (target.kind === 'room' && selectedIdentity?.roomSourceNumbers) {
      setSelected(String(selectedIdentity.roomSourceNumbers[0]))
    }
    resetReview()
  }

  function changeEdge(wallEdgeIndex: number) {
    if (locked || target.kind !== 'opening') return
    setDrafts((current) =>
      current.map((draft) =>
        pdfContourKey(draft) === selected
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

  function toggleConditionalEdge(wallEdgeIndex: number) {
    if (locked || !selectedDraft?.closed || selectedDraft.sourceTopology || target.kind !== 'room')
      return
    if (selectedDraft.openings?.some((opening) => opening.wallEdgeIndex === wallEdgeIndex)) return
    setDrafts((current) =>
      current.map((draft) => {
        if (pdfContourKey(draft) !== selected) return draft
        const existing = draft.conditionalEdges ?? []
        const marked = existing.some((edge) => edge.wallEdgeIndex === wallEdgeIndex)
        return {
          ...draft,
          conditionalEdges: marked
            ? existing.filter((edge) => edge.wallEdgeIndex !== wallEdgeIndex)
            : [...existing, { wallEdgeIndex }],
        }
      }),
    )
    resetReview()
  }

  function proposePoint(point: PageContourPoint, index?: number) {
    if (pointsLocked || !preview || (index === undefined && !canDraw)) return
    const a =
      !editingBoundary &&
      !selectedVoid &&
      selectedOpening &&
      selectedDraft?.polygon[selectedOpening.wallEdgeIndex]
    const b =
      !editingBoundary &&
      !selectedVoid &&
      selectedOpening &&
      selectedDraft?.polygon[(selectedOpening.wallEdgeIndex + 1) % selectedDraft.polygon.length]
    const candidate =
      a && b
        ? snapPageOpeningPoint(point, nativePoints, preview, [a, b], nativeSegments)
        : selectedVoid || (!editingBoundary && target.kind === 'obstacle')
          ? snapPageContourPoint(point, nativePoints, preview)
          : snapPageSourceContourPoint(
              point,
              nativePoints,
              preview,
              nativeSegments,
              index ?? points.length,
            )
    setChecked(false)
    setProposal(undefined)
    if (candidate.kind === 'none') {
      setNodeFeedback(
        'Рядом нет узла исходного PDF. Увеличьте лист и отметьте пересечение линий точнее.',
      )
    } else if (candidate.kind === 'held') {
      setNodeFeedback(
        candidate.reason === 'intersection-budget'
          ? 'В этой точке слишком много исходных линий для однозначной проверки. Выберите исходный узел или уточните участок.'
          : 'Пересечение нельзя сохранить без потери исходной точности. Оно не округляется до ближайшей вершины; выберите проверенный узел PDF.',
      )
    } else if (candidate.kind === 'ambiguous') {
      setNodeFeedback(
        'Рядом несколько одинаково близких узлов. Увеличьте лист и уточните вершину — неоднозначная привязка не сохранится.',
      )
    } else {
      setProposal({
        point: candidate.point,
        proof: 'proof' in candidate ? candidate.proof : undefined,
        vertexProof: 'vertexProof' in candidate ? candidate.vertexProof : undefined,
        ...(index !== undefined ? { index } : {}),
      })
      setNodeFeedback(
        'vertexProof' in candidate && candidate.vertexProof
          ? 'Проверьте пересечение двух ограниченных линий PDF. Точная дробная запись и исходные отрезки сохраняются; сервер пересчитает пересечение без округления. Назначение стены или пола этим не подтверждается.'
          : 'proof' in candidate && candidate.proof
            ? 'Проверьте пересечение исходного отрезка со стороной комнаты. Сервер повторно вычислит его по этому PDF; произвольные координаты не принимаются.'
            : 'Проверьте отмеченный узел на листе и примите привязку. Координаты берутся из исходного PDF без округления.',
      )
    }
  }

  function acceptNode() {
    if (!proposal || pointsLocked) return
    const polygon =
      proposal.index === undefined
        ? [...points, { ...proposal.point }]
        : points.map((point, index) => (index === proposal.index ? { ...proposal.point } : point))
    changeSelected(polygon, proposal.index === undefined ? false : closed, {
      index: proposal.index ?? points.length,
      proof: proposal.proof,
      vertexProof: proposal.vertexProof,
    })
    setNodeFeedback(
      'Точка привязана к исходным линиям PDF. Подписанный размер сверяется отдельно после сохранения.',
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
    const rooms = pageContourRoomsForSave(drafts, nativePoints, nativeSegments)
    const savedVoids = pageContourVoidsForSave(voids, nativePoints)
    const savedExterior = pageExteriorForSave(
      exterior,
      exteriorClosed,
      nativePoints,
      nativeSegments,
    )
    const savedFloor = pageFloorForSave(floor, floorClosed, nativePoints, nativeSegments)
    if (
      !rooms ||
      !savedVoids ||
      savedExterior === null ||
      savedFloor === null ||
      (savedFloor && savedExterior?.boundaryRole !== 'outer-wall-envelope')
    ) {
      setError(
        'Замкните начатые контуры и привяжите их вершины к узлам PDF. Отдельную границу пола сохраняйте вместе с наружной стороной стен; проверьте её назначение и положение комнат внутри пола.',
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
          ...(savedVoids.length ? { voids: savedVoids } : {}),
          ...(savedExterior ? { exterior: savedExterior } : {}),
          ...(savedFloor ? { floor: savedFloor } : {}),
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
      {progress.length > 0 ? (
        <section aria-label="Готовность исходного плана" className="border border-line p-4">
          <p className="text-sm font-medium text-ink">
            Физические контуры: {physicalRoomCount} из {progress.length}. Граница пола:{' '}
            {floorClosed ? 'обведена' : 'не завершена'}. Наружный контур:{' '}
            {exteriorClosed ? 'обведён' : 'не завершён'}.
          </p>
          <p className="mt-1 text-xs leading-relaxed text-ink-2">
            Исходная область и строка таблицы ещё не доказывают физический пол. Недостающие места
            можно сохранить как черновик, но полную квартиру нельзя подтвердить до сверки.
          </p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {progress.map((room) => (
              <li key={room.sourceNumber} className="border-t border-line pt-2 text-sm">
                <button
                  type="button"
                  disabled={locked || !room.selectable}
                  onClick={() => {
                    setSelected(room.contourKey)
                    selectTarget({ kind: 'room' })
                  }}
                  className="min-h-11 text-left text-accent underline underline-offset-4 disabled:cursor-default disabled:text-ink-2 disabled:no-underline"
                >
                  № {room.sourceNumber} · {room.name}
                </button>
                <span className="ml-2 text-xs text-ink-2">
                  {room.status === 'physical'
                    ? 'физический контур обведён'
                    : room.status === 'source-only'
                      ? 'исходная область — нужна физическая обводка'
                      : room.status === 'incomplete'
                        ? 'обводка не завершена'
                        : room.status === 'missing-reading'
                          ? 'сначала добавьте номер в список комнат'
                          : room.status === 'ambiguous'
                            ? 'номер относится к нескольким контурам'
                            : 'контур не нанесён'}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            {(['floor', 'exterior'] as const).map((kind) => (
              <Button
                key={kind}
                type="button"
                size="sm"
                variant="secondary"
                disabled={
                  locked ||
                  (kind === 'floor' && exterior?.boundaryRole !== 'outer-wall-envelope' && !floor)
                }
                onClick={() => {
                  if (kind === 'floor') setFloor((current) => current ?? { polygon: [] })
                  else setExterior((current) => current ?? { polygon: [] })
                  setEditingBoundary(kind)
                  setSelectedVoidId(undefined)
                  setTarget({ kind: 'room' })
                  resetReview()
                }}
              >
                {kind === 'floor' ? 'Отдельная граница пола' : 'Наружный контур'}
              </Button>
            ))}
          </div>
        </section>
      ) : null}
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
            {options.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
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
      {!editingBoundary &&
      selectedIdentity?.roomSourceNumbers === undefined &&
      selectedIdentity &&
      groupCandidates.length &&
      !selectedTraceReference &&
      !selectedDraft?.sourceTopology ? (
        <label className="block max-w-sm space-y-1 text-sm">
          <span className="block">Общая зона без стены между номерами</span>
          <select
            className={inputClassName}
            value=""
            disabled={locked}
            onChange={(event) => {
              const grouped = groupPageContourDraft(
                drafts,
                selectedIdentity,
                Number(event.target.value),
                reading.rooms,
              )
              if (!grouped) return
              const group = grouped[grouped.length - 1]
              if (!group) return
              setDrafts(grouped)
              setSelected(pdfContourKey(group))
              selectTarget({ kind: 'room' })
              resetReview()
            }}
          >
            <option value="">Добавить второй номер…</option>
            {groupCandidates.map((room) => (
              <option key={room.sourceNumber} value={room.sourceNumber}>
                № {room.sourceNumber} · {room.name}
              </option>
            ))}
          </select>
          <span className="block text-xs leading-relaxed text-ink-2">
            Только если на исходном листе это одна открытая зона. Существующие отдельные контуры не
            объединяются автоматически.
          </span>
        </label>
      ) : null}
      {!editingBoundary && selectedIdentity?.roomSourceNumbers ? (
        <p className="text-xs leading-relaxed text-ink-2">
          Номера {selectedIdentity.roomSourceNumbers.join(' и ')} размечаются одним контуром общей
          зоны, без добавления перегородки.
        </p>
      ) : null}
      <PlanPageBoundaryControls
        exterior={exterior}
        floor={floor}
        editing={editingBoundary}
        disabled={locked}
        onEdit={(kind) => {
          // Starting a boundary is a draft even before the first vertex is accepted.
          if (kind === 'floor') {
            setFloor((current) => current ?? { polygon: [] })
          } else {
            setExterior((current) => current ?? { polygon: [] })
          }
          setEditingBoundary((current) => (current === kind ? undefined : kind))
          setSelectedVoidId(undefined)
          setTarget({ kind: 'room' })
          setDimensionHighlight(undefined)
          resetReview()
        }}
        onRemove={(kind) => {
          if (kind === 'floor') {
            setFloor(undefined)
            setFloorClosed(false)
          } else {
            setExterior(undefined)
            setExteriorClosed(false)
          }
          if (editingBoundary === kind) setEditingBoundary(undefined)
          resetReview()
        }}
        onRole={(boundaryRole) => {
          setExterior((current) => ({
            polygon: current?.polygon ?? [],
            ...(current?.vertexProofs ? { vertexProofs: current.vertexProofs } : {}),
            ...(boundaryRole ? { boundaryRole } : {}),
          }))
          resetReview()
        }}
      />
      <div className="space-y-2 border-l-2 border-amber-600 pl-3 text-sm">
        <p className="font-medium text-ink">Технические пустоты на листе</p>
        <p className="text-xs leading-relaxed text-ink-2">
          Отметьте шахту или другую явно показанную пустоту отдельно от комнат. Обведите её по
          исходным узлам PDF. Промежутки между комнатами сами пустотами не считаются.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-56 space-y-1 text-xs">
            <span className="block">Выбранная пустота</span>
            <select
              className={inputClassName}
              value={selectedVoidId ?? ''}
              disabled={locked}
              onChange={(event) => {
                setSelectedVoidId(event.target.value || undefined)
                setEditingBoundary(undefined)
                setTarget({ kind: 'room' })
                resetReview()
              }}
            >
              <option value="">Работать с комнатой</option>
              {voids.map((draft, index) => (
                <option key={draft.id} value={draft.id}>
                  Пустота {index + 1} · {draft.closed ? 'замкнута' : 'в работе'}
                </option>
              ))}
            </select>
          </label>
          <Button
            size="sm"
            variant="secondary"
            disabled={locked || voids.length >= 20}
            onClick={addVoid}
          >
            Добавить пустоту
          </Button>
          <Button size="sm" variant="ghost" disabled={locked || !selectedVoid} onClick={removeVoid}>
            Удалить выбранную
          </Button>
        </div>
      </div>
      {!editingBoundary &&
      !selectedVoid &&
      selectedDraft?.closed &&
      !selectedDraft.sourceTopology &&
      target.kind === 'room' ? (
        <div className="space-y-2 border-l-2 border-accent pl-3 text-sm">
          <p className="font-medium text-ink">Открытая зона без перегородки</p>
          <p className="text-xs leading-relaxed text-ink-2">
            Если сторона делит помещения только условно, отметьте её. Она останется границей
            площади, но не станет стеной в 2D-схеме и 3D. Концы должны быть привязаны к исходному
            PDF.
          </p>
          <div className="flex flex-wrap gap-2">
            {selectedDraft.polygon.map((_, index) => {
              const marked = selectedDraft.conditionalEdges?.some(
                (edge) => edge.wallEdgeIndex === index,
              )
              const occupied = selectedDraft.openings?.some(
                (opening) => opening.wallEdgeIndex === index,
              )
              return (
                <Button
                  key={index}
                  size="sm"
                  variant={marked ? 'secondary' : 'ghost'}
                  disabled={locked || occupied}
                  onClick={() => toggleConditionalEdge(index)}
                  aria-pressed={Boolean(marked)}
                  title={occupied ? 'На этой стороне уже размечен проём' : undefined}
                >
                  Сторона {index + 1}: {marked ? 'условная' : 'стена'}
                </Button>
              )
            })}
          </div>
        </div>
      ) : null}
      {!editingBoundary &&
      !selectedVoid &&
      selectedDraft?.closed &&
      !selectedDraft.sourceTopology &&
      target.kind === 'room' &&
      state === 'existing' ? (
        <PlanPageEdgeDimensions
          key={`dimensions-${selected}`}
          draft={selectedDraft}
          labels={dimensionLabels}
          locked={locked}
          onHighlight={(edge, indexes) =>
            setDimensionHighlight({ roomKey: selected, edge, indexes })
          }
          onChange={(dimensionEdges) => {
            setDrafts((current) =>
              current.map((draft) =>
                pdfContourKey(draft) === selected ? { ...draft, dimensionEdges } : draft,
              ),
            )
            resetReview()
          }}
        />
      ) : null}
      {selected && !selectedVoid && !editingBoundary && !selectedDraft?.sourceTopology ? (
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
      {selectedDraft?.sourceTopology && !editingBoundary && !selectedVoid ? (
        <div className="space-y-2 border-l-2 border-line pl-3">
          <p role="status" className="text-sm leading-relaxed text-ink-2">
            Исходный контур сохранён с точными ключами и {selectedDraft.sourceTopology.holes.length}{' '}
            вырезами. Это ещё не физическая граница комнаты. Вершины, проёмы и размерные привязки
            здесь не редактируются. Можно начать отдельную ручную обводку: исходный контур останется
            подсказкой до закрытия редактора. Перенос в размеры, 2D/3D и маршруты пока заблокирован.
          </p>
          <Button size="sm" variant="secondary" disabled={locked} onClick={startPhysicalTrace}>
            Начать физическую обводку
          </Button>
          <Button size="sm" variant="ghost" disabled={locked} onClick={removeTarget}>
            Удалить исходный черновик
          </Button>
        </div>
      ) : null}
      {selectedTraceReference &&
      !selectedDraft?.sourceTopology &&
      !editingBoundary &&
      !selectedVoid ? (
        <div className="space-y-2 border-l-2 border-amber-600 pl-3">
          <p role="status" className="text-sm leading-relaxed text-ink-2">
            Пунктирный исходный контур — только подсказка. Обведите физическую границу по узлам PDF;
            исходные точки не считаются подтверждёнными автоматически. Исходный контур сохранится
            для сравнения после повторного открытия разметки. Вернуть исходный черновик можно,
            заменив текущую физическую обводку.
          </p>
          {nextSourceTracePoint ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={!canDraw}
              onClick={() => proposePoint(nextSourceTracePoint)}
            >
              {`Предложить исходную вершину ${points.length + 1}`}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" disabled={locked} onClick={restoreSourceTrace}>
            Вернуть исходный черновик
          </Button>
        </div>
      ) : null}
      {loading ? (
        <p role="status" className="text-sm text-ink-2">
          Открываем выбранный лист…
        </p>
      ) : null}
      {imageUrl && preview ? (
        <div className="space-y-2">
          {state === 'existing' ? (
            <div className="space-y-2 border-l-2 border-line pl-3 text-xs text-ink-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={locked || fillHintsLoading}
                pending={fillHintsLoading}
                onClick={toggleFillHints}
              >
                {fillHintsShown ? 'Скрыть заливки PDF' : 'Показать заливки PDF как ориентир'}
              </Button>
              {fillHintsError ? <p role="alert">{fillHintsError}</p> : null}
              {fillHintsShown && currentFillHints ? (
                <>
                  <p role="status">
                    Найдено областей: {currentFillHints.candidates.length}. Заливка не доказывает
                    границу пола и не привязана к выбранной комнате. Выберите её только для
                    сравнения с исходником, затем обведите физический контур обычными инструментами.
                    {currentFillHints.truncated ? ' Набор неполный.' : ''}
                  </p>
                  {currentFillHints.status === 'held' ? (
                    <p>Нативный слой неполон: подсказки для этого листа не показаны.</p>
                  ) : null}
                  {currentFillHints.candidates.length ? (
                    <label className="block max-w-md space-y-1">
                      <span>Область для подсветки</span>
                      <select
                        className={inputClassName}
                        value={selectedFillHint}
                        onChange={(event) => setSelectedFillHint(event.target.value)}
                      >
                        <option value="">Не выбрана</option>
                        {currentFillHints.candidates.map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.id}
                            {candidate.nearbyText.length
                              ? ` · рядом текст: ${candidate.nearbyText.join(', ')}`
                              : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}
          {state === 'existing' ? (
            <PlanPageSourceFloorControls
              reference={currentSourceFloors}
              selectedKey={sourceRoomKey}
              shown={sourceFloorsShown}
              loading={sourceFloorsLoading}
              locked={locked || Boolean(editingBoundary || selectedVoid || target.kind !== 'room')}
              draftExists={Boolean(selectedDraft)}
              conversion={sourceFloorConversion}
              error={sourceFloorsError}
              highlightedEdge={highlightedSourceEdge}
              highlightedEdgePoints={
                highlightedSourceSegment?.[0] && highlightedSourceSegment[1]
                  ? [highlightedSourceSegment[0], highlightedSourceSegment[1]]
                  : undefined
              }
              nearbySourceEdges={nearbySourceEdges}
              highlightedStrokeRef={
                sourceStrokeHighlight &&
                highlightedEdgeKey &&
                sourceStrokeHighlight.edgeKey === highlightedEdgeKey
                  ? sourceStrokeHighlight.sourceRef
                  : undefined
              }
              highlightedBlockerOperation={selectedSourceBlocker?.operationIndex}
              onToggle={toggleSourceFloors}
              onCopy={copySourceFloor}
              onHighlightEdge={(edge) =>
                setSourceEdgeHighlight(
                  edge && selectedSourceFloor
                    ? {
                        revision: sourceRevision,
                        page: pageNumber,
                        floorId: selectedSourceFloor.id,
                        ...edge,
                      }
                    : undefined,
                )
              }
              onHighlightStroke={(sourceRef) =>
                setSourceStrokeHighlight(
                  sourceRef && highlightedEdgeKey
                    ? { edgeKey: highlightedEdgeKey, sourceRef }
                    : undefined,
                )
              }
              onHighlightBlocker={(operationIndex) =>
                setSourceBlockerHighlight(
                  operationIndex !== undefined && highlightedEdgeKey
                    ? { edgeKey: highlightedEdgeKey, operationIndex }
                    : undefined,
                )
              }
            />
          ) : null}
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
                editingBoundary
                  ? editingBoundary === 'floor'
                    ? 'Добавить вершину границы пола на исходном листе'
                    : 'Добавить вершину внешней границы на исходном листе'
                  : !selectedVoid && target.kind === 'opening'
                    ? 'Отметить конец проёма на исходном листе'
                    : selectedVoid
                      ? 'Добавить вершину технической пустоты на исходном листе'
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
                {selectedPaintHint ? (
                  <path
                    d={sourceFloorReferencePath({ polygon: selectedPaintHint.polygon, holes: [] })}
                    fill="#2563eb"
                    fillOpacity={0.08}
                    stroke="#2563eb"
                    strokeWidth={2}
                    strokeDasharray="6 5"
                    vectorEffect="non-scaling-stroke"
                    pointerEvents="none"
                  >
                    <title>Нативная заливка PDF; физический контур пола не подтверждён.</title>
                  </path>
                ) : null}
                {sourceFloorsShown && selectedSourceFloor ? (
                  <path
                    d={sourceFloorReferencePath(selectedSourceFloor)}
                    fill="#b45309"
                    fillOpacity={0.08}
                    fillRule="evenodd"
                    stroke="#b45309"
                    strokeWidth={2}
                    strokeDasharray="5 4"
                    vectorEffect="non-scaling-stroke"
                    pointerEvents="none"
                  >
                    <title>
                      Выбранная область исходника № {selectedSourceFloor.sourceRoomKey}; не
                      подтверждённая граница пола.
                    </title>
                  </path>
                ) : null}
                {highlightedSourceSegment?.[0] && highlightedSourceSegment[1] ? (
                  <line
                    x1={highlightedSourceSegment[0].x}
                    y1={highlightedSourceSegment[0].y}
                    x2={highlightedSourceSegment[1].x}
                    y2={highlightedSourceSegment[1].y}
                    stroke="#7c3aed"
                    strokeWidth={5}
                    vectorEffect="non-scaling-stroke"
                    pointerEvents="none"
                  >
                    <title>
                      Выбранная грань исходной области; её физическая роль не подтверждена.
                    </title>
                  </line>
                ) : null}
                {selectedSourceBlocker ? (
                  <rect
                    x={Math.max(0, selectedSourceBlocker.bounds.left)}
                    y={Math.max(0, selectedSourceBlocker.bounds.top)}
                    width={
                      Math.min(1000, selectedSourceBlocker.bounds.right) -
                      Math.max(0, selectedSourceBlocker.bounds.left)
                    }
                    height={
                      Math.min(1000, selectedSourceBlocker.bounds.bottom) -
                      Math.max(0, selectedSourceBlocker.bounds.top)
                    }
                    fill="#f59e0b"
                    fillOpacity={0.2}
                    stroke="#b45309"
                    strokeWidth={3}
                    strokeDasharray="7 4"
                    vectorEffect="non-scaling-stroke"
                    pointerEvents="none"
                  >
                    <title>
                      Возможная область поздней операции PDF {selectedSourceBlocker.operationIndex}.
                      Видимая краска и физическая граница не подтверждены.
                    </title>
                  </rect>
                ) : null}
                {highlightedMaterialSpans.map((span, index) => (
                  <g key={`material-${index}`} pointerEvents="none">
                    <line
                      x1={span.start.x}
                      y1={span.start.y}
                      x2={span.end.x}
                      y2={span.end.y}
                      stroke="#0f766e"
                      strokeWidth={4}
                      vectorEffect="non-scaling-stroke"
                    >
                      <title>
                        Независимо обведённая грань соседнего материала; стена или косяк не
                        подтверждены.
                      </title>
                    </line>
                    {span.oppositeFace ? (
                      <line
                        x1={span.oppositeFace.start.x}
                        y1={span.oppositeFace.start.y}
                        x2={span.oppositeFace.end.x}
                        y2={span.oppositeFace.end.y}
                        stroke="#0f766e"
                        strokeWidth={3}
                        strokeDasharray="6 3"
                        vectorEffect="non-scaling-stroke"
                      >
                        <title>
                          Противоположная исходная грань, не подтверждённая толщина стены.
                        </title>
                      </line>
                    ) : null}
                  </g>
                ))}
                {selectedSourceStroke ? (
                  <line
                    x1={selectedSourceStroke.start.x}
                    y1={selectedSourceStroke.start.y}
                    x2={selectedSourceStroke.end.x}
                    y2={selectedSourceStroke.end.y}
                    stroke="#0284c7"
                    strokeWidth={3}
                    strokeDasharray="6 3"
                    vectorEffect="non-scaling-stroke"
                    pointerEvents="none"
                  >
                    <title>
                      Отдельный исходный штрих рядом с гранью. Его физическое назначение не
                      подтверждено.
                    </title>
                  </line>
                ) : null}
                {dimensionHighlight?.roomKey === selected &&
                target.kind === 'room' &&
                !selectedVoid &&
                !editingBoundary ? (
                  <g pointerEvents="none">
                    {dimensionHighlight.edge !== undefined &&
                    selectedDraft?.polygon[dimensionHighlight.edge] &&
                    selectedDraft.polygon[
                      (dimensionHighlight.edge + 1) % selectedDraft.polygon.length
                    ] ? (
                      <line
                        x1={selectedDraft.polygon[dimensionHighlight.edge]?.x}
                        y1={selectedDraft.polygon[dimensionHighlight.edge]?.y}
                        x2={
                          selectedDraft.polygon[
                            (dimensionHighlight.edge + 1) % selectedDraft.polygon.length
                          ]?.x
                        }
                        y2={
                          selectedDraft.polygon[
                            (dimensionHighlight.edge + 1) % selectedDraft.polygon.length
                          ]?.y
                        }
                        stroke="var(--color-accent)"
                        strokeWidth={5}
                        vectorEffect="non-scaling-stroke"
                      />
                    ) : null}
                    {dimensionLabels
                      .filter((label) => dimensionHighlight.indexes.includes(label.index))
                      .map((label) => (
                        <g key={label.index}>
                          <circle
                            cx={label.x}
                            cy={label.y}
                            r={10}
                            fill="var(--color-accent)"
                            fillOpacity={0.25}
                            stroke="var(--color-accent)"
                            vectorEffect="non-scaling-stroke"
                          />
                          <text x={label.x} y={label.y - 13} fontSize={12} fill="var(--color-ink)">
                            Метка {label.index + 1}
                          </text>
                        </g>
                      ))}
                  </g>
                ) : null}
                {exterior?.polygon.length ? (
                  <g pointerEvents="none">
                    {exterior.polygon.every(finiteContourPoint) && exteriorClosed ? (
                      <polygon
                        points={exterior.polygon.map((point) => `${point.x},${point.y}`).join(' ')}
                        fill="none"
                        stroke="#0f766e"
                        strokeWidth={editingBoundary === 'exterior' ? 4 : 2}
                        strokeDasharray="9 5"
                        vectorEffect="non-scaling-stroke"
                      />
                    ) : (
                      <polyline
                        points={exterior.polygon
                          .filter(finiteContourPoint)
                          .map((point) => `${point.x},${point.y}`)
                          .join(' ')}
                        fill="none"
                        stroke="#0f766e"
                        strokeWidth={3}
                        strokeDasharray="9 5"
                        vectorEffect="non-scaling-stroke"
                      />
                    )}
                    {exterior.polygon.filter(finiteContourPoint).map((point, index) => (
                      <circle
                        key={index}
                        cx={point.x}
                        cy={point.y}
                        r={4}
                        fill="#0f766e"
                        stroke="white"
                      />
                    ))}
                  </g>
                ) : null}
                {floor?.polygon.length ? (
                  <g pointerEvents="none" aria-label="Отдельная граница пола">
                    {floorClosed && floor.polygon.every(finiteContourPoint) ? (
                      <polygon
                        points={floor.polygon.map((point) => `${point.x},${point.y}`).join(' ')}
                        fill="#0369a1"
                        fillOpacity={0.06}
                        stroke="#0369a1"
                        strokeWidth={editingBoundary === 'floor' ? 4 : 2}
                        strokeDasharray="3 5"
                        vectorEffect="non-scaling-stroke"
                      />
                    ) : (
                      <polyline
                        points={floor.polygon
                          .filter(finiteContourPoint)
                          .map((point) => `${point.x},${point.y}`)
                          .join(' ')}
                        fill="none"
                        stroke="#0369a1"
                        strokeWidth={3}
                        strokeDasharray="3 5"
                        vectorEffect="non-scaling-stroke"
                      />
                    )}
                    {floor.polygon.filter(finiteContourPoint).map((point, index) => (
                      <circle
                        key={index}
                        cx={point.x}
                        cy={point.y}
                        r={4}
                        fill="#0369a1"
                        stroke="white"
                      />
                    ))}
                  </g>
                ) : null}
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
                {selectedTraceReference?.sourceTopology &&
                (!sourceFloorsShown ||
                  selectedSourceFloor?.id !== selectedTraceReference.sourceTopology.floorId) ? (
                  <path
                    d={sourceFloorReferencePath({
                      polygon: selectedTraceReference.polygon,
                      holes: selectedTraceReference.sourceTopology.holes,
                    })}
                    fill="none"
                    stroke="#b45309"
                    strokeWidth={2}
                    strokeDasharray="5 4"
                    vectorEffect="non-scaling-stroke"
                    pointerEvents="none"
                  >
                    <title>Исходная область для ручной обводки; не физическая граница.</title>
                  </path>
                ) : null}
                {drafts.map((draft) => {
                  const isSelected = pdfContourKey(draft) === selected
                  const valid = draft.polygon.every(finiteContourPoint)
                  const coordinates = draft.polygon
                    .map((point) => `${point.x},${point.y}`)
                    .join(' ')
                  return (
                    <g
                      key={pdfContourKey(draft)}
                      className={isSelected ? 'text-accent' : 'text-ink-2'}
                      pointerEvents="none"
                    >
                      {valid && draft.closed && draft.sourceTopology ? (
                        <path
                          d={sourceFloorReferencePath({
                            polygon: draft.polygon,
                            holes: draft.sourceTopology.holes,
                          })}
                          fill="#b45309"
                          fillOpacity={0.12}
                          fillRule="evenodd"
                          stroke="#b45309"
                          strokeWidth={2}
                          strokeDasharray="5 4"
                          vectorEffect="non-scaling-stroke"
                        >
                          <title>
                            Исходный контур № {pdfContourKey(draft)}; физические границы не
                            подтверждены.
                          </title>
                        </path>
                      ) : valid && draft.closed ? (
                        <polygon
                          points={coordinates}
                          fill="currentColor"
                          fillOpacity={0.16}
                          stroke="currentColor"
                          strokeWidth={2}
                          vectorEffect="non-scaling-stroke"
                        />
                      ) : null}
                      {valid && draft.closed
                        ? draft.conditionalEdges?.map(({ wallEdgeIndex }) => {
                            const start = draft.polygon[wallEdgeIndex]
                            const end = draft.polygon[(wallEdgeIndex + 1) % draft.polygon.length]
                            return start && end ? (
                              <line
                                key={wallEdgeIndex}
                                x1={start.x}
                                y1={start.y}
                                x2={end.x}
                                y2={end.y}
                                stroke="white"
                                strokeWidth={3}
                                strokeDasharray="6 5"
                                vectorEffect="non-scaling-stroke"
                              />
                            ) : null
                          })
                        : null}
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
                          № {pdfContourRoomNumbers(draft).join(' + ')}
                        </text>
                      ) : null}
                    </g>
                  )
                })}
                {voids.map((draft, index) => {
                  const valid = draft.polygon.every(finiteContourPoint)
                  const coordinates = draft.polygon
                    .map((point) => `${point.x},${point.y}`)
                    .join(' ')
                  const isSelectedVoid = draft.id === selectedVoidId
                  return (
                    <g key={draft.id} pointerEvents="none">
                      {valid && draft.closed ? (
                        <polygon
                          points={coordinates}
                          fill="#d97706"
                          fillOpacity={isSelectedVoid ? 0.3 : 0.18}
                          stroke="#b45309"
                          strokeWidth={isSelectedVoid ? 3 : 2}
                          strokeDasharray="7 4"
                          vectorEffect="non-scaling-stroke"
                        />
                      ) : null}
                      {valid && !draft.closed ? (
                        <polyline
                          points={coordinates}
                          fill="none"
                          stroke="#b45309"
                          strokeWidth={3}
                          strokeDasharray="7 4"
                          vectorEffect="non-scaling-stroke"
                        />
                      ) : null}
                      {draft.polygon.filter(finiteContourPoint).map((point, pointIndex) => (
                        <circle
                          key={pointIndex}
                          cx={point.x}
                          cy={point.y}
                          r={4}
                          fill="#b45309"
                          stroke="white"
                          strokeWidth={1}
                        />
                      ))}
                      {draft.polygon[0] && finiteContourPoint(draft.polygon[0]) ? (
                        <text
                          x={draft.polygon[0].x + 8}
                          y={draft.polygon[0].y - 8}
                          fill="#92400e"
                          stroke="white"
                          strokeWidth={3}
                          paintOrder="stroke"
                          fontSize={18}
                          fontWeight={600}
                        >
                          Пустота {index + 1}
                        </text>
                      ) : null}
                    </g>
                  )
                })}
                {!selectedVoid && !editingBoundary ? (
                  <PlanPageFeatureOverlay drafts={drafts} roomKey={selected} target={target} />
                ) : null}
              </svg>
            </button>
          </div>
        </div>
      ) : null}
      <p id="page-contour-coordinate-help" className="text-xs leading-relaxed text-ink-2">
        Лист можно прокручивать внутри окна и увеличивать. Нажмите возле угла выбранного контура,
        проверьте предложенный узел и нажмите «Принять узел PDF». Для клавиатуры используйте поля
        ниже: X — слева направо, Y — сверху вниз, от 0 до 1000. Это координаты листа, не размеры
        комнаты.
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
      {selected || selectedVoid || editingBoundary ? (
        <PlanPagePointControls
          key={
            editingBoundary
              ? editingBoundary
              : selectedVoid
                ? `void-${selectedVoid.id}`
                : `points-${selected}-${target.kind}-${target.kind === 'room' ? '' : target.id}`
          }
          points={points}
          closed={closed}
          opening={!editingBoundary && !selectedVoid && target.kind === 'opening'}
          locked={pointsLocked}
          canDraw={canDraw}
          nativePoints={nativePoints}
          onChange={changeSelected}
          onPropose={proposePoint}
          onError={setError}
        />
      ) : null}
      {!editingBoundary && !selectedVoid && target.kind === 'room' && roomHasFeatures ? (
        <p className="text-xs leading-relaxed text-ink-2">
          У комнаты уже размечены объекты или выбраны подписанные стороны. Чтобы изменить порядок
          вершин, сначала уберите эти привязки: иначе номера сторон станут неверными. Объект можно
          выбрать и поправить отдельно.
        </p>
      ) : null}
      {stale ? (
        <FormError message="Лист или версия плана изменились. Черновик не отправлен. Закройте разметку и откройте актуальный лист, чтобы начать новую сверку." />
      ) : null}
      <FormError message={error} />
      <div className="space-y-3 border-t border-line pt-4">
        <p className="text-xs text-ink-2">
          Размечено зон: {drafts.filter((draft) => draft.closed).length}; технических пустот:{' '}
          {voids.filter((draft) => draft.closed).length}. Другие комнаты можно добавить позже;
          отсутствующие размеры не вычисляются из площади.
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
            {drafts.some((draft) => draft.sourceTopology !== undefined)
              ? 'Сверил исходные снимки и обычную разметку с выбранным листом. Исходные снимки остаются неподтверждёнными физическими границами.'
              : 'Сверил контуры комнат и технических пустот, проёмы, неподвижные объекты, номера комнат, внешнюю границу, отдельный контур пола и состояние квартиры с исходным листом.'}
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
