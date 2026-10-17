import type { PlanPageContours, PlanReading } from '@uyut/db'
import type { ComponentProps, ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hooks = vi.hoisted(() => ({
  cursor: 0,
  values: new Map<number, unknown>(),
  setters: new Map<number, ReturnType<typeof vi.fn>>(),
  effects: [] as (() => unknown)[],
  stateUpdates: vi.fn(),
}))
const { stateUpdates } = hooks
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useState: (initial: unknown) => {
    const index = hooks.cursor++
    const setter = vi.fn((value: unknown) => {
      stateUpdates(value)
    })
    hooks.setters.set(index, setter)
    return [hooks.values.has(index) ? hooks.values.get(index) : initial, setter]
  },
  useRef: (initial: unknown) => ({ current: initial }),
  useEffect: (effect: () => unknown) => hooks.effects.push(effect),
  useMemo: (compute: () => unknown) => compute(),
}))
vi.mock('@/actions/plan-page-review', () => ({ savePlanPageReview: vi.fn() }))

import { savePlanPageReview } from '@/actions/plan-page-review'
import { exactNativePointKey } from '@/lib/projects/plan-native-exact-intersections'
import type { SourceFloorReference } from '@/lib/projects/plan-page-source-floors'
import { PlanPageBoundaryControls } from './plan-page-boundary-controls'
import { PlanPageContourEditor } from './plan-page-contour-editor'
import { contourDraftsFromSaved, pageContourRoomsForSave } from './plan-page-contour-editor-model'
import { PlanPagePointControls } from './plan-page-point-controls'
import { PlanPageSourceFloorControls } from './plan-page-source-floor-controls'

beforeEach(() => {
  hooks.cursor = 0
  hooks.values.clear()
  hooks.setters.clear()
  hooks.effects.length = 0
  stateUpdates.mockClear()
  vi.mocked(savePlanPageReview).mockReset()
})
afterEach(() => vi.unstubAllGlobals())

// Slots follow the editor's hooks. Setters let these tests exercise the actual
// child callbacks without a DOM renderer or running the unrelated PDF fetch.
const slots = {
  drafts: 1,
  exterior: 4,
  exteriorClosed: 5,
  floor: 6,
  floorClosed: 7,
  boundary: 8,
  preview: 10,
  imageReady: 12,
  nativePoints: 13,
  nativeSegments: 14,
  proposal: 17,
  feedback: 18,
  loading: 19,
  checked: 23,
  state: 24,
  imageUrl: 11,
  sourceFloors: 26,
  sourceFloorsShown: 27,
  sourceFloorsLoading: 28,
  sourceFloorsError: 29,
  sourceEdgeHighlight: 30,
  sourceStrokeHighlight: 31,
  traceReferences: 32,
} as const

function sourceFixture() {
  const polygon = [
    { x: 10, y: 10 },
    { x: 30, y: 10 },
    { x: 30, y: 30 },
    { x: 10, y: 30 },
  ]
  const vertexProofs: NonNullable<PlanPageContours['floor']>['vertexProofs'] = [
    {
      vertexIndex: 1,
      kind: 'bounded-native-crossing',
      segments: [
        {
          operationIndex: 1,
          subpathIndex: 0,
          segmentIndex: 0,
          start: { x: 10, y: 10 },
          end: { x: 40, y: 10 },
        },
        {
          operationIndex: 2,
          subpathIndex: 0,
          segmentIndex: 0,
          start: { x: 30, y: 0 },
          end: { x: 30, y: 30 },
        },
      ],
    },
  ]
  const contours: PlanPageContours = {
    source: { sha256: 'a'.repeat(64), pdfPage: 2, state: 'existing' },
    coordinateSystem: 'page-0-1000',
    review: 'manual-source-review',
    pageWidth: 1000,
    pageHeight: 800,
    rooms: [{ roomSourceNumber: 1, polygon, vertexProofs }],
    exterior: { polygon, vertexProofs, boundaryRole: 'outer-wall-envelope' },
    floor: { polygon, vertexProofs },
  }
  const reading: PlanReading = {
    rooms: [{ name: 'Прихожая', sourceNumber: 1, areaM2: 10, kind: 'living' }],
    readAt: '2026-10-12',
    planState: 'existing',
    sourcePage: 2,
    pageReview: { version: 1, savedAt: '2026-10-12', contours },
  }
  return { polygon, vertexProofs, contours, reading }
}

function renderEditor(reading: PlanReading, sourceRevision = 'revision') {
  return PlanPageContourEditor({
    projectId: 'local-project',
    sourceRevision,
    reading,
    pageNumber: 2,
    onSaved: vi.fn(),
    onConflict: vi.fn(),
    onClose: vi.fn(),
  })
}

function childProps<T>(editor: ReactElement, component: unknown): T {
  const children = (editor.props as { children: ReactElement[] }).children
  const child = children.find((item) => item?.type === component)
  if (!child) throw new Error('Expected editor control is missing')
  return child.props as T
}

function updateFor(index: number, before: unknown): unknown {
  const update = hooks.setters.get(index)?.mock.calls.at(-1)?.[0]
  return typeof update === 'function' ? update(before) : update
}

describe('editor crossing proof wiring', () => {
  it.each(['room', 'floor', 'exterior'] as const)(
    'requires explicit acceptance of a diagonal %s vertex and carries its exact proof',
    (kind) => {
      const fixture = sourceFixture()
      const drafts = contourDraftsFromSaved(fixture.contours.rooms)
      const segments = [
        {
          operationIndex: 1,
          subpathIndex: 0,
          segmentIndex: 0,
          start: { x: 10, y: 10 },
          end: { x: 30, y: 30 },
        },
        {
          operationIndex: 2,
          subpathIndex: 0,
          segmentIndex: 0,
          start: { x: 10, y: 30 },
          end: { x: 30, y: 10 },
        },
      ]
      hooks.values.set(slots.drafts, drafts)
      hooks.values.set(slots.exterior, fixture.contours.exterior)
      hooks.values.set(slots.floor, fixture.contours.floor)
      hooks.values.set(slots.boundary, kind === 'room' ? undefined : kind)
      hooks.values.set(slots.preview, { width: 1000, height: 1000 })
      hooks.values.set(slots.nativePoints, fixture.polygon)
      hooks.values.set(slots.nativeSegments, segments)
      hooks.values.set(slots.imageReady, true)
      hooks.values.set(slots.loading, false)
      const editor = renderEditor(fixture.reading)
      childProps<ComponentProps<typeof PlanPagePointControls>>(
        editor,
        PlanPagePointControls,
      ).onPropose({ x: 20, y: 20 }, 1)
      const proposal = updateFor(slots.proposal, undefined)
      expect(proposal).toMatchObject({
        point: { x: 20, y: 20 },
        index: 1,
        vertexProof: {
          kind: 'bounded-native-rational-crossing',
          exactPointKey: '20/1:20/1',
          vertexIndex: 1,
        },
      })
      const slot = kind === 'room' ? slots.drafts : slots[kind]
      expect(hooks.setters.get(slot)).not.toHaveBeenCalled()
      hooks.values.set(slots.proposal, proposal)
      hooks.cursor = 0
      const acceptedEditor = renderEditor(fixture.reading)
      const section = (
        acceptedEditor.props.children as ReactElement<{ children: ReactElement[] }>[]
      ).find(
        (child) =>
          Array.isArray(child?.props?.children) &&
          child.props.children.some(
            (item) => (item?.props as { children?: unknown })?.children === 'Принять узел PDF',
          ),
      )
      const accept = section?.props.children.find(
        (item) => (item?.props as { children?: unknown })?.children === 'Принять узел PDF',
      ) as ReactElement<{ onClick: () => void }> | undefined
      if (!accept) throw new Error('Explicit acceptance control missing')
      accept.props.onClick()
      const result = updateFor(slot, kind === 'room' ? drafts : fixture.contours[kind])
      const contour = kind === 'room' ? (result as typeof drafts)[0] : result
      expect(contour).toMatchObject({
        vertexProofs: [
          { kind: 'bounded-native-rational-crossing', exactPointKey: '20/1:20/1', vertexIndex: 1 },
        ],
      })
      expect((contour as { polygon: { x: number; y: number }[] }).polygon[1]).toEqual({
        x: 20,
        y: 20,
      })
      expect(savePlanPageReview).not.toHaveBeenCalled()
    },
  )

  it.each(['room', 'floor', 'exterior'] as const)(
    'retains %s proofs when closing and discards only a moved vertex proof',
    (kind) => {
      const fixture = sourceFixture()
      const roomDrafts = contourDraftsFromSaved(fixture.contours.rooms)
      const boundary = kind === 'room' ? undefined : kind
      hooks.values.set(slots.drafts, roomDrafts)
      hooks.values.set(slots.exterior, fixture.contours.exterior)
      hooks.values.set(slots.floor, fixture.contours.floor)
      hooks.values.set(slots.boundary, boundary)
      hooks.values.set(slots.preview, { width: 1000, height: 800 })
      hooks.values.set(slots.imageReady, true)
      hooks.values.set(slots.nativePoints, fixture.polygon)
      hooks.values.set(slots.loading, false)
      const editor = renderEditor(fixture.reading)
      const points = childProps<ComponentProps<typeof PlanPagePointControls>>(
        editor,
        PlanPagePointControls,
      )
      expect(points.locked).toBe(false)
      const slot = kind === 'room' ? slots.drafts : slots[kind]
      const before = kind === 'room' ? roomDrafts : fixture.contours[kind]
      points.onChange(structuredClone(fixture.polygon), true)
      const closed = updateFor(slot, before)
      const closedContour = kind === 'room' ? (closed as typeof roomDrafts)[0] : closed
      expect(closedContour).toMatchObject({ vertexProofs: fixture.vertexProofs })
      const moved = fixture.polygon.map((point, index) =>
        index === 1 ? { ...point, x: point.x + 0.000001 } : { ...point },
      )
      points.onChange(moved, true)
      const changed = updateFor(slot, before)
      const changedContour = kind === 'room' ? (changed as typeof roomDrafts)[0] : changed
      expect(changedContour).toMatchObject({ vertexProofs: undefined })
      expect(fixture.contours[kind === 'room' ? 'floor' : kind]?.vertexProofs).toEqual(
        fixture.vertexProofs,
      )
    },
  )

  it('retains exterior evidence when changing the boundary role', () => {
    const fixture = sourceFixture()
    hooks.values.set(slots.exterior, fixture.contours.exterior)
    const editor = renderEditor(fixture.reading)
    const boundary = childProps<ComponentProps<typeof PlanPageBoundaryControls>>(
      editor,
      PlanPageBoundaryControls,
    )
    boundary.onRole('floor')
    expect(updateFor(slots.exterior, fixture.contours.exterior)).toEqual({
      polygon: fixture.polygon,
      vertexProofs: fixture.vertexProofs,
      boundaryRole: 'floor',
    })
  })

  it('hydrates room, exterior and floor proofs from the current source page', async () => {
    const fixture = sourceFixture()
    const headers = {
      'X-Plan-Sha256': fixture.contours.source.sha256,
      'X-Plan-Page': '2',
      'X-Plan-Page-Count': '3',
      'X-Plan-Page-Width': '1000',
      'X-Plan-Page-Height': '800',
    }
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(new Blob(['preview']), {
            headers: { ...headers, 'Content-Type': 'image/jpeg' },
          }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ points: fixture.polygon, segments: [], dimensionLabels: [] }),
            { headers: { ...headers, 'Content-Type': 'application/json' } },
          ),
        ),
    )
    renderEditor(fixture.reading)
    const cleanup = hooks.effects[0]?.() as (() => void) | undefined
    try {
      await vi.waitFor(() => {
        expect(hooks.setters.get(slots.floor)?.mock.calls.at(-1)?.[0]).toEqual(
          fixture.contours.floor,
        )
      })
      const exterior = updateFor(slots.exterior, undefined)
      const drafts = updateFor(slots.drafts, []) as ReturnType<typeof contourDraftsFromSaved>
      expect(exterior).toEqual(fixture.contours.exterior)
      expect(exterior).not.toBe(fixture.contours.exterior)
      expect(drafts[0]?.vertexProofs).toEqual(fixture.vertexProofs)
      expect(drafts[0]?.vertexProofs).not.toBe(fixture.vertexProofs)
    } finally {
      cleanup?.()
    }
  })

  it('submits fresh room, exterior and floor crossing evidence together without promoting it', async () => {
    const fixture = sourceFixture()
    const proof = fixture.vertexProofs?.[0]
    if (!proof) throw new Error('Crossing fixture is missing')
    hooks.values.set(slots.drafts, contourDraftsFromSaved(fixture.contours.rooms))
    hooks.values.set(slots.exterior, fixture.contours.exterior)
    hooks.values.set(slots.exteriorClosed, true)
    hooks.values.set(slots.floor, fixture.contours.floor)
    hooks.values.set(slots.floorClosed, true)
    hooks.values.set(slots.preview, {
      sha256: fixture.contours.source.sha256,
      page: 2,
      pageCount: 3,
      width: 1000,
      height: 800,
    })
    hooks.values.set(slots.nativeSegments, proof.segments)
    hooks.values.set(
      slots.nativePoints,
      fixture.polygon.filter((_, index) => index !== 1),
    )
    hooks.values.set(slots.imageReady, true)
    hooks.values.set(slots.loading, false)
    hooks.values.set(slots.checked, true)
    hooks.values.set(slots.state, 'existing')
    vi.mocked(savePlanPageReview).mockResolvedValue({ ok: false, error: 'Test server refusal' })
    const editor = renderEditor(fixture.reading)
    const sections = (editor.props.children as ReactElement<{ children: ReactElement[] }>[]).filter(
      (child) => child?.type === 'div',
    )
    const saveButton = sections
      .flatMap((section) => section.props.children)
      .find(
        (child) =>
          (child?.props as { children?: unknown } | undefined)?.children ===
          'Сохранить разметку листа',
      ) as ReactElement<{ onClick: () => Promise<void>; disabled: boolean }> | undefined
    if (!saveButton) throw new Error('Save button is missing')
    expect(saveButton.props.disabled).toBe(false)
    await saveButton.props.onClick()
    expect(savePlanPageReview).toHaveBeenCalledExactlyOnceWith(
      'local-project',
      fixture.contours,
      'revision',
    )
    expect(fixture.reading.geometry).toBeUndefined()
  })
})

describe('starting a source boundary', () => {
  beforeEach(() => stateUpdates.mockClear())

  it.each(['floor', 'exterior'] as const)(
    'retains an empty %s draft so saving cannot silently skip it',
    (kind) => {
      const editor = PlanPageContourEditor({
        projectId: 'local-project',
        sourceRevision: 'revision',
        reading: { rooms: [], readAt: '2026-10-03', planState: 'existing' },
        pageNumber: 2,
        onSaved: vi.fn(),
        onConflict: vi.fn(),
        onClose: vi.fn(),
      })
      const children = editor.props.children as ReactElement<{
        onEdit: (kind: 'floor' | 'exterior') => void
      }>[]
      const boundary = children.find((child) => child?.type === PlanPageBoundaryControls)
      if (!boundary) throw new Error('Boundary controls are missing')
      boundary.props.onEdit(kind)

      const startBoundary = stateUpdates.mock.calls[0]?.[0] as (current: unknown) => unknown
      expect(startBoundary(undefined)).toEqual({ polygon: [] })
      const savedBoundary = { polygon: [{ x: 10, y: 20 }] }
      expect(startBoundary(savedBoundary)).toBe(savedBoundary)
    },
  )
})

function nestedProps<T>(node: unknown, component: unknown): T | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = nestedProps<T>(child, component)
      if (found) return found
    }
  } else if (node && typeof node === 'object' && 'props' in node) {
    const element = node as ReactElement<{ children?: unknown }>
    if (element.type === component) return element.props as T
    return nestedProps<T>(element.props.children, component)
  }
  return undefined
}

function nestedElements(node: unknown, type: string): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap((child) => nestedElements(child, type))
  if (!node || typeof node !== 'object' || !('props' in node)) return []
  const element = node as ReactElement<{ children?: unknown }>
  return [
    ...(element.type === type ? [element] : []),
    ...nestedElements(element.props.children, type),
  ]
}

function buttonWithText(editor: ReactElement, label: string) {
  const find = (node: unknown): ReactElement<{ onClick: () => void }> | undefined => {
    if (Array.isArray(node)) return node.map(find).find(Boolean)
    if (!node || typeof node !== 'object' || !('props' in node)) return undefined
    const element = node as ReactElement<{ onClick: () => void; children?: unknown }>
    if (element.props.children === label) return element
    return find(element.props.children)
  }
  return find(editor)
}

describe('source-floor bridge in the existing editor', () => {
  const revision = 'b'.repeat(64)
  function setup() {
    const fixture = sourceFixture()
    const preview = { sha256: 'a'.repeat(64), page: 2, pageCount: 5, width: 1000, height: 800 }
    const reference: SourceFloorReference = {
      version: 1,
      coordinateSystem: 'page-0-1000',
      source: fixture.contours.source,
      sourceRevision: revision,
      pageWidth: 1000,
      pageHeight: 800,
      status: 'checked',
      reason: null,
      readOnly: true,
      physicalBoundariesAccepted: false,
      floors: [
        {
          id: 'source-floor-1',
          sourceRoomKey: '1',
          name: 'Прихожая',
          polygon: structuredClone(fixture.polygon),
          holes: [],
          exactPointKeys: fixture.polygon.map((p) => exactNativePointKey(p) as string),
          holeExactPointKeys: [],
          nonDecimalVertices: 0,
          omittedStrokeCount: 0,
          boundaryInkComplete: true,
        },
      ],
    }
    hooks.values.set(slots.preview, preview)
    hooks.values.set(slots.imageUrl, 'blob:test-source')
    hooks.values.set(slots.imageReady, true)
    hooks.values.set(slots.nativePoints, fixture.polygon)
    hooks.values.set(slots.nativeSegments, [])
    hooks.values.set(slots.loading, false)
    hooks.values.set(slots.state, 'existing')
    hooks.values.set(slots.sourceFloors, reference)
    hooks.values.set(slots.sourceFloorsShown, true)
    hooks.values.set(slots.checked, true)
    return { fixture, preview, reference }
  }
  function controls(editor: ReactElement) {
    const result = nestedProps<ComponentProps<typeof PlanPageSourceFloorControls>>(
      editor,
      PlanPageSourceFloorControls,
    )
    if (!result) throw new Error('Missing source-reference controls')
    return result
  }
  it('copies only after an explicit action and resets review without saving or creating voids', () => {
    const { fixture } = setup()
    const editor = renderEditor(fixture.reading, revision)
    expect(hooks.setters.get(slots.drafts)).not.toHaveBeenCalled()
    controls(editor).onCopy()
    expect(updateFor(slots.drafts, [])).toEqual([
      {
        roomSourceNumber: 1,
        polygon: fixture.polygon,
        closed: true,
        sourceTopology: {
          kind: 'unclassified-source-paint',
          floorId: 'source-floor-1',
          exactPointKeys: fixture.polygon.map((point) => exactNativePointKey(point) as string),
          holes: [],
          holeExactPointKeys: [],
        },
      },
    ])
    expect(updateFor(slots.checked, true)).toBe(false)
    expect(hooks.setters.get(2)).not.toHaveBeenCalled()
    expect(savePlanPageReview).not.toHaveBeenCalled()
  })
  it('highlights only the selected source edge on the matching page and revision', () => {
    const { fixture } = setup()
    const editor = renderEditor(fixture.reading, revision)
    controls(editor).onHighlightEdge?.({ ringIndex: 0, edgeIndex: 1 })
    const highlight = updateFor(slots.sourceEdgeHighlight, undefined)
    expect(highlight).toMatchObject({
      revision,
      page: 2,
      floorId: 'source-floor-1',
      ringIndex: 0,
      edgeIndex: 1,
    })
    hooks.values.set(slots.sourceEdgeHighlight, highlight)
    hooks.cursor = 0
    const matching = renderEditor(fixture.reading, revision)
    const lines = nestedElements(matching, 'line').filter(
      (line) => (line.props as { stroke?: string }).stroke === '#7c3aed',
    )
    expect(lines).toHaveLength(1)
    expect(lines[0]?.props).toMatchObject({ x1: 30, y1: 10, x2: 30, y2: 30 })
    hooks.cursor = 0
    expect(
      nestedElements(renderEditor(fixture.reading, 'changed'), 'line').some(
        (line) => (line.props as { stroke?: string }).stroke === '#7c3aed',
      ),
    ).toBe(false)
    expect(savePlanPageReview).not.toHaveBeenCalled()
  })
  it('highlights a nearby source stroke only for the chosen edge without editing the draft', () => {
    const { fixture } = setup()
    hooks.values.set(slots.nativeSegments, [
      {
        operationIndex: 6685,
        subpathIndex: 0,
        segmentIndex: 1,
        start: { x: 30.001, y: 10 },
        end: { x: 30.001, y: 30 },
      },
    ])
    const first = renderEditor(fixture.reading, revision)
    controls(first).onHighlightEdge?.({ ringIndex: 0, edgeIndex: 1 })
    hooks.values.set(slots.sourceEdgeHighlight, updateFor(slots.sourceEdgeHighlight, undefined))
    hooks.cursor = 0
    const second = renderEditor(fixture.reading, revision)
    expect(controls(second).nearbySourceEdges?.status).toBe('checked')
    controls(second).onHighlightStroke?.('6685:0:1')
    hooks.values.set(slots.sourceStrokeHighlight, updateFor(slots.sourceStrokeHighlight, undefined))
    hooks.cursor = 0
    const third = renderEditor(fixture.reading, revision)
    const stroke = nestedElements(third, 'line').find(
      (line) => (line.props as { stroke?: string }).stroke === '#0284c7',
    )
    expect(stroke?.props).toMatchObject({ x1: 30.001, y1: 10, x2: 30.001, y2: 30 })
    expect(hooks.setters.get(slots.drafts)).not.toHaveBeenCalled()
    expect(savePlanPageReview).not.toHaveBeenCalled()
  })
  it('keeps rational crossings and holes in a source-only draft, locks vertex editing and allows whole removal', () => {
    const { fixture, reference } = setup()
    const floor = reference.floors[0]
    if (!floor) throw new Error('Missing selected source')
    floor.exactPointKeys[0] = '31/3:10/1'
    floor.holes = [
      [
        { x: 15, y: 15 },
        { x: 20, y: 15 },
        { x: 20, y: 20 },
      ],
    ]
    floor.holeExactPointKeys = [['15/1:15/1', '20/1:15/1', '20/1:20/1']]
    controls(renderEditor(fixture.reading, revision)).onCopy()
    const drafts = updateFor(slots.drafts, []) as ReturnType<typeof contourDraftsFromSaved>
    expect(drafts[0]?.sourceTopology).toMatchObject({
      exactPointKeys: floor.exactPointKeys,
      holes: floor.holes,
      holeExactPointKeys: floor.holeExactPointKeys,
    })
    hooks.values.set(slots.drafts, drafts)
    hooks.cursor = 0
    const editor = renderEditor(fixture.reading, revision)
    const points = nestedProps<ComponentProps<typeof PlanPagePointControls>>(
      editor,
      PlanPagePointControls,
    )
    expect(points?.locked).toBe(true)
    const findRemoval = (node: unknown): ReactElement<{ onClick: () => void }> | undefined => {
      if (Array.isArray(node)) return node.map(findRemoval).find(Boolean)
      if (!node || typeof node !== 'object' || !('props' in node)) return undefined
      const element = node as ReactElement<{ onClick: () => void; children?: unknown }>
      if (element.props.children === 'Удалить исходный черновик') return element
      return findRemoval(element.props.children)
    }
    const remove = findRemoval(editor)
    if (!remove) throw new Error('Whole source removal missing')
    remove.props.onClick()
    expect(updateFor(slots.drafts, drafts)).toEqual([])
    expect(savePlanPageReview).not.toHaveBeenCalled()
  })
  it('keeps a source-only outline as a temporary guide while physical tracing starts empty', () => {
    const { fixture } = setup()
    const firstRoom = fixture.reading.rooms[0]
    if (!firstRoom) throw new Error('First room missing')
    fixture.reading.rooms.push({
      ...firstRoom,
      sourceNumber: 2,
      name: 'Кухня',
    })
    controls(renderEditor(fixture.reading, revision)).onCopy()
    const sourceDrafts = updateFor(slots.drafts, []) as ReturnType<typeof contourDraftsFromSaved>
    hooks.values.set(slots.drafts, sourceDrafts)
    hooks.cursor = 0

    const start = buttonWithText(
      renderEditor(fixture.reading, revision),
      'Начать физическую обводку',
    )
    if (!start) throw new Error('Physical tracing action missing')
    start.props.onClick()

    const physicalDrafts = updateFor(slots.drafts, sourceDrafts) as typeof sourceDrafts
    const references = updateFor(slots.traceReferences, {}) as Record<string, unknown>
    expect(physicalDrafts).toEqual([
      {
        roomSourceNumber: 1,
        polygon: [],
        closed: false,
        sourceTrace: {
          polygon: sourceDrafts[0]?.polygon,
          sourceTopology: sourceDrafts[0]?.sourceTopology,
        },
      },
    ])
    expect(references['1']).toMatchObject({ draft: sourceDrafts[0], revision, page: 2 })
    expect(pageContourRoomsForSave(physicalDrafts, fixture.polygon)).toBeNull()
    expect(savePlanPageReview).not.toHaveBeenCalled()

    hooks.values.set(slots.drafts, physicalDrafts)
    hooks.values.set(slots.traceReferences, references)
    hooks.cursor = 0
    const tracing = renderEditor(fixture.reading, revision)
    expect(
      nestedElements(tracing, 'option').some(
        (element) =>
          (element.props as { children?: unknown }).children === 'Добавить второй номер…',
      ),
    ).toBe(false)
    const points = nestedProps<ComponentProps<typeof PlanPagePointControls>>(
      tracing,
      PlanPagePointControls,
    )
    expect(points?.locked).toBe(false)
    hooks.values.set(slots.sourceFloorsShown, false)
    hooks.cursor = 0
    const hiddenReference = renderEditor(fixture.reading, revision)
    expect(
      nestedElements(hiddenReference, 'path').some(
        (element) =>
          (element.props as { stroke?: string; strokeDasharray?: string }).stroke === '#b45309' &&
          (element.props as { fill?: string; strokeDasharray?: string }).fill === 'none' &&
          (element.props as { strokeDasharray?: string }).strokeDasharray === '5 4',
      ),
    ).toBe(true)

    const restore = buttonWithText(hiddenReference, 'Вернуть исходный черновик')
    if (!restore) throw new Error('Source-draft restore action missing')
    restore.props.onClick()
    expect(updateFor(slots.drafts, physicalDrafts)).toEqual(sourceDrafts)
    expect(updateFor(slots.traceReferences, references)).toEqual({})
    expect(savePlanPageReview).not.toHaveBeenCalled()
  })
  it('shows a saved source guide again after reopening a physical trace', () => {
    const { fixture } = setup()
    controls(renderEditor(fixture.reading, revision)).onCopy()
    const sourceDrafts = updateFor(slots.drafts, []) as ReturnType<typeof contourDraftsFromSaved>
    const source = sourceDrafts[0]
    if (!source?.sourceTopology) throw new Error('Source guide is missing')
    const physicalRoom: PlanPageContours['rooms'][number] = {
      roomSourceNumber: 1,
      polygon: structuredClone(fixture.polygon),
      sourceTrace: {
        polygon: structuredClone(source.polygon),
        sourceTopology: structuredClone(source.sourceTopology),
      },
    }
    const reopened = contourDraftsFromSaved([physicalRoom])
    hooks.values.set(slots.drafts, reopened)
    hooks.values.set(slots.traceReferences, {})
    hooks.values.set(slots.sourceFloorsShown, false)
    hooks.cursor = 0

    const editor = renderEditor(fixture.reading, revision)
    expect(
      nestedElements(editor, 'path').some(
        (element) =>
          (element.props as { stroke?: string; strokeDasharray?: string }).stroke === '#b45309' &&
          (element.props as { strokeDasharray?: string }).strokeDasharray === '5 4',
      ),
    ).toBe(true)
    const restore = buttonWithText(editor, 'Вернуть исходный черновик')
    expect(restore).toBeDefined()
  })
  it('keeps independent temporary references for two source-only rooms', () => {
    const { fixture } = setup()
    const firstRoom = fixture.reading.rooms[0]
    if (!firstRoom) throw new Error('First room missing')
    fixture.reading.rooms.push({
      ...firstRoom,
      sourceNumber: 2,
      name: 'Кухня',
    })
    controls(renderEditor(fixture.reading, revision)).onCopy()
    const sourceOne = updateFor(slots.drafts, []) as ReturnType<typeof contourDraftsFromSaved>
    const firstSource = sourceOne[0]
    if (!firstSource) throw new Error('First source draft missing')
    const sourceTwo = structuredClone(firstSource)
    sourceTwo.roomSourceNumber = 2
    if (!sourceTwo.sourceTopology) throw new Error('Source topology missing')
    sourceTwo.sourceTopology.floorId = 'source-floor-2'
    const drafts = [...sourceOne, sourceTwo]
    hooks.values.set(slots.drafts, drafts)
    hooks.cursor = 0
    buttonWithText(
      renderEditor(fixture.reading, revision),
      'Начать физическую обводку',
    )?.props.onClick()
    const referencesOne = updateFor(slots.traceReferences, {}) as Record<string, unknown>
    const physicalOne = updateFor(slots.drafts, drafts)

    hooks.values.set(0, '2')
    hooks.values.set(slots.drafts, physicalOne)
    hooks.values.set(slots.traceReferences, referencesOne)
    hooks.cursor = 0
    buttonWithText(
      renderEditor(fixture.reading, revision),
      'Начать физическую обводку',
    )?.props.onClick()
    const referencesBoth = updateFor(slots.traceReferences, referencesOne) as Record<
      string,
      unknown
    >
    expect(Object.keys(referencesBoth).sort()).toEqual(['1', '2'])

    hooks.values.set(0, '1')
    hooks.values.set(slots.traceReferences, referencesBoth)
    hooks.cursor = 0
    expect(
      buttonWithText(renderEditor(fixture.reading, revision), 'Вернуть исходный черновик'),
    ).toBeDefined()
  })
  it('asks before replacing a physical trace that already has vertices', () => {
    const { fixture } = setup()
    controls(renderEditor(fixture.reading, revision)).onCopy()
    const sourceDrafts = updateFor(slots.drafts, []) as ReturnType<typeof contourDraftsFromSaved>
    hooks.values.set(slots.drafts, sourceDrafts)
    hooks.cursor = 0
    buttonWithText(
      renderEditor(fixture.reading, revision),
      'Начать физическую обводку',
    )?.props.onClick()
    const references = updateFor(slots.traceReferences, {})
    const physicalDrafts = [{ roomSourceNumber: 1, polygon: [{ x: 10, y: 10 }], closed: false }]
    hooks.values.set(slots.drafts, physicalDrafts)
    hooks.values.set(slots.traceReferences, references)
    const confirm = vi.fn(() => false)
    vi.stubGlobal('window', { confirm })
    hooks.cursor = 0
    buttonWithText(
      renderEditor(fixture.reading, revision),
      'Вернуть исходный черновик',
    )?.props.onClick()
    expect(confirm).toHaveBeenCalledOnce()
    expect(hooks.setters.get(slots.drafts)).not.toHaveBeenCalled()
  })
  it.each(['existing-draft', 'hidden', 'loading', 'revision'])(
    'refuses copy when %s without replacing any working geometry',
    (fault) => {
      const { fixture, reference } = setup()
      if (fault === 'existing-draft')
        hooks.values.set(slots.drafts, contourDraftsFromSaved(fixture.contours.rooms))
      if (fault === 'hidden') hooks.values.set(slots.sourceFloorsShown, false)
      if (fault === 'loading') hooks.values.set(slots.sourceFloorsLoading, true)
      if (fault === 'revision') reference.sourceRevision = 'c'.repeat(64)
      const floor = reference.floors[0]
      if (!floor) throw new Error('Missing reference')
      controls(renderEditor(fixture.reading, revision)).onCopy()
      expect(hooks.setters.get(slots.drafts)).not.toHaveBeenCalled()
      expect(savePlanPageReview).not.toHaveBeenCalled()
    },
  )
  it('keeps concurrent membership rather than overwriting an existing room in a state updater', () => {
    const { fixture } = setup()
    controls(renderEditor(fixture.reading, revision)).onCopy()
    const concurrent = contourDraftsFromSaved(fixture.contours.rooms)
    expect(updateFor(slots.drafts, concurrent)).toBe(concurrent)
  })
  it('holds a 409 source change without touching the working draft or retaining the old reference', async () => {
    const { fixture } = setup()
    hooks.values.set(slots.sourceFloors, undefined)
    const fetcher = vi.fn().mockResolvedValue(new Response('changed', { status: 409 }))
    vi.stubGlobal('fetch', fetcher)
    const editor = renderEditor(fixture.reading, revision)
    await controls(editor).onToggle()
    expect(hooks.setters.get(slots.drafts)).not.toHaveBeenCalled()
    expect(updateFor(slots.sourceFloors, undefined)).toBeUndefined()
    expect(updateFor(slots.sourceFloorsShown, true)).toBe(false)
    expect(updateFor(slots.sourceFloorsError, undefined)).toMatch(/План изменился/)
    expect(savePlanPageReview).not.toHaveBeenCalled()
  })
  it('ignores a late reference response after the editor load effect is cleaned up', async () => {
    const { fixture } = setup()
    hooks.values.set(slots.sourceFloors, undefined)
    let resolveReference: (response: Response) => void = () => {
      throw new Error('Reference not requested')
    }
    const deferred = new Promise<Response>((resolve) => {
      resolveReference = resolve
    })
    const fetcher = vi.fn().mockReturnValue(deferred)
    vi.stubGlobal('fetch', fetcher)
    const editor = renderEditor(fixture.reading, revision)
    const pending = controls(editor).onToggle()
    const cleanup = hooks.effects[0]?.() as (() => void) | undefined
    cleanup?.()
    const before = hooks.setters.get(slots.sourceFloors)?.mock.calls.length
    resolveReference(new Response('{}', { headers: { 'Content-Type': 'application/json' } }))
    await pending
    expect(hooks.setters.get(slots.sourceFloors)?.mock.calls.length).toBe(before)
    expect(hooks.setters.get(slots.drafts)).not.toHaveBeenCalled()
    expect(savePlanPageReview).not.toHaveBeenCalled()
  })
})
