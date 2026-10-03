import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { stateUpdates } = vi.hoisted(() => ({ stateUpdates: vi.fn() }))
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useState: (initial: unknown) => [initial, stateUpdates],
  useRef: (initial: unknown) => ({ current: initial }),
  useEffect: vi.fn(),
}))
vi.mock('@/actions/plan-page-review', () => ({ savePlanPageReview: vi.fn() }))

import { PlanPageBoundaryControls } from './plan-page-boundary-controls'
import { PlanPageContourEditor } from './plan-page-contour-editor'

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
