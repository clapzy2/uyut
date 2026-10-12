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
}))
vi.mock('@/actions/plan-page-review', () => ({ savePlanPageReview: vi.fn() }))

import { savePlanPageReview } from '@/actions/plan-page-review'
import { PlanPageBoundaryControls } from './plan-page-boundary-controls'
import { PlanPageContourEditor } from './plan-page-contour-editor'
import { contourDraftsFromSaved } from './plan-page-contour-editor-model'
import { PlanPagePointControls } from './plan-page-point-controls'

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
  loading: 19,
  checked: 23,
  state: 24,
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

function renderEditor(reading: PlanReading) {
  return PlanPageContourEditor({
    projectId: 'local-project',
    sourceRevision: 'revision',
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
