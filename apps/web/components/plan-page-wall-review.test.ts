import type { PlanReading } from '@uyut/db'
import type { ComponentProps, ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hooks = vi.hoisted(() => ({
  cursor: 0,
  values: new Map<number, unknown>(),
}))
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useState: (initial: unknown) => {
    const index = hooks.cursor++
    return [
      hooks.values.has(index) ? hooks.values.get(index) : initial,
      (value: unknown) => hooks.values.set(index, value),
    ]
  },
}))
vi.mock('@/actions/plan-wall-review', () => ({
  getPlanWallReviewCandidates: vi.fn(),
  savePlanWallReview: vi.fn(),
  revokePlanWallReview: vi.fn(),
}))

import {
  getPlanWallReviewCandidates,
  revokePlanWallReview,
  savePlanWallReview,
} from '@/actions/plan-wall-review'
import type { HumanWallReviewOption } from '@/lib/projects/plan-human-wall-review'
import { FormError } from './form-error'
import { PlanPageWallReview } from './plan-page-wall-review'

const candidate: HumanWallReviewOption = {
  id: 'a'.repeat(64),
  pair: {
    faces: [
      {
        contourKey: '5',
        wallEdgeIndex: 1,
        start: { x: 100, y: 100 },
        end: { x: 100, y: 300 },
        nativeSegment: { operationIndex: 1, subpathIndex: 0, segmentIndex: 0 },
      },
      {
        contourKey: 'exterior',
        wallEdgeIndex: 2,
        start: { x: 120, y: 100 },
        end: { x: 120, y: 300 },
        nativeSegment: { operationIndex: 1, subpathIndex: 0, segmentIndex: 2 },
      },
    ],
  },
  visibilityIssues: ['later-paint-near-face'],
}
const another: HumanWallReviewOption = { ...candidate, id: 'b'.repeat(64) }
const savedReading: PlanReading = { rooms: [], readAt: '2026-10-24' }

function elements(node: unknown): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!node || typeof node !== 'object' || !('props' in node)) return []
  const element = node as ReactElement<{ children?: unknown }>
  return [element, ...elements(element.props.children)]
}

function control(tree: ReactElement, label: string) {
  const found = elements(tree).find(
    (element) => (element.props as { children?: unknown }).children === label,
  )
  if (!found) throw new Error(`Missing control: ${label}`)
  return found as ReactElement<{ disabled?: boolean; onClick: () => Promise<void> | void }>
}

function errorMessage(tree: ReactElement) {
  return elements(tree).find((element) => element.type === FormError)?.props as
    | { message?: string }
    | undefined
}

function fixture() {
  const props: ComponentProps<typeof PlanPageWallReview> = {
    projectId: 'qa-project',
    sourceRevision: 'source-revision',
    disabled: false,
    onHighlight: vi.fn(),
    onSaved: vi.fn(),
    onConflict: vi.fn(),
  }
  const render = () => {
    hooks.cursor = 0
    return PlanPageWallReview(props)
  }
  const choose = (index = 0) => {
    const buttons = elements(render()).filter((element) => element.type === 'button')
    const button = buttons[index] as ReactElement<{ onClick: () => void }> | undefined
    if (!button) throw new Error('Missing candidate button')
    button.props.onClick()
  }
  const acknowledge = () => {
    const checkbox = elements(render()).find((element) => element.type === 'input') as
      | ReactElement<{ onChange: (event: { target: { checked: boolean } }) => void }>
      | undefined
    if (!checkbox) throw new Error('Missing acknowledgment checkbox')
    checkbox.props.onChange({ target: { checked: true } })
  }
  const load = async () => control(render(), 'Показать пары для сверки').props.onClick()
  const save = async () => control(render(), 'Сохранить как сверенное человеком').props.onClick()
  return { props, render, choose, acknowledge, load, save }
}

beforeEach(() => {
  hooks.cursor = 0
  hooks.values.clear()
  vi.mocked(getPlanWallReviewCandidates).mockReset()
  vi.mocked(savePlanWallReview).mockReset()
  vi.mocked(revokePlanWallReview).mockReset()
  vi.mocked(getPlanWallReviewCandidates).mockResolvedValue({
    ok: true,
    data: { candidates: [candidate, another] },
  })
})

describe('explicit human wall pair review control', () => {
  it('highlights only an explicitly selected pair and requires acknowledgment before saving', async () => {
    const test = fixture()
    await test.load()
    expect(getPlanWallReviewCandidates).toHaveBeenCalledWith('qa-project', 'source-revision')
    expect(test.props.onHighlight).toHaveBeenLastCalledWith(undefined)
    test.choose()
    expect(test.props.onHighlight).toHaveBeenLastCalledWith(candidate)
    expect(control(test.render(), 'Сохранить как сверенное человеком').props.disabled).toBe(true)
    await test.save()
    expect(savePlanWallReview).not.toHaveBeenCalled()
  })

  it('sends the server candidate ID and current revision, then delivers the saved reading', async () => {
    const test = fixture()
    vi.mocked(savePlanWallReview).mockResolvedValue({
      ok: true,
      data: { reading: savedReading, revision: 'saved-revision' },
    })
    await test.load()
    test.choose()
    test.acknowledge()
    expect(control(test.render(), 'Сохранить как сверенное человеком').props.disabled).toBe(false)
    await test.save()
    expect(savePlanWallReview).toHaveBeenCalledWith(
      'qa-project',
      { candidateId: candidate.id, acknowledged: true },
      'source-revision',
    )
    expect(test.props.onSaved).toHaveBeenCalledWith({
      reading: savedReading,
      revision: 'saved-revision',
    })
    expect(test.props.onHighlight).toHaveBeenLastCalledWith(undefined)
  })

  it('resets acknowledgment when another pair is selected', async () => {
    const test = fixture()
    await test.load()
    test.choose()
    test.acknowledge()
    test.choose(1)
    expect(test.props.onHighlight).toHaveBeenLastCalledWith(another)
    expect(control(test.render(), 'Сохранить как сверенное человеком').props.disabled).toBe(true)
    await test.save()
    expect(savePlanWallReview).not.toHaveBeenCalled()
  })

  it.each(['conflict', 'server-error', 'network-error'] as const)(
    'keeps %s visible without reporting a saved review',
    async (kind) => {
      const test = fixture()
      if (kind === 'network-error')
        vi.mocked(savePlanWallReview).mockRejectedValue(new Error('connection lost'))
      else
        vi.mocked(savePlanWallReview).mockResolvedValue({
          ok: false,
          error: 'Проверяемая ошибка',
          ...(kind === 'conflict' ? { code: 'plan-conflict' as const } : {}),
        })
      await test.load()
      test.choose()
      test.acknowledge()
      await test.save()
      expect(test.props.onSaved).not.toHaveBeenCalled()
      expect(test.props.onConflict).toHaveBeenCalledTimes(kind === 'conflict' ? 1 : 0)
      expect(errorMessage(test.render())?.message).toContain(
        kind === 'network-error' ? 'Ответ сервера не получен' : 'Проверяемая ошибка',
      )
    },
  )

  it('clears a prior selection before reloading so a cleared overlay is not described as selected', async () => {
    const test = fixture()
    await test.load()
    test.choose()
    test.acknowledge()
    vi.mocked(getPlanWallReviewCandidates).mockResolvedValue({
      ok: false,
      error: 'План изменился',
      code: 'plan-conflict',
    })
    await test.load()
    expect(test.props.onConflict).toHaveBeenCalledOnce()
    expect(test.props.onHighlight).toHaveBeenLastCalledWith(undefined)
    expect(errorMessage(test.render())?.message).toBe('План изменился')
    expect(
      elements(test.render()).some(
        (element) =>
          (element.props as { children?: unknown }).children ===
          'Сохранить как сверенное человеком',
      ),
    ).toBe(false)
  })

  it.each([true, false])(
    'revokes a saved review with current=%s using its server ID and revision',
    async (current) => {
      const test = fixture()
      const reviewId = 'c'.repeat(64)
      vi.mocked(getPlanWallReviewCandidates).mockResolvedValue({
        ok: true,
        data: {
          candidates: [],
          reviews: [{ id: reviewId, reviewedAt: '2026-10-24T10:00:00.000Z', current }],
        },
      })
      vi.mocked(revokePlanWallReview).mockResolvedValue({
        ok: true,
        data: { reading: savedReading, revision: 'revoked-revision' },
      })
      await test.load()
      await control(test.render(), 'Снять сверку').props.onClick()
      expect(revokePlanWallReview).toHaveBeenCalledWith(
        'qa-project',
        { reviewId },
        'source-revision',
      )
      expect(test.props.onSaved).toHaveBeenCalledWith({
        reading: savedReading,
        revision: 'revoked-revision',
      })
      expect(test.props.onHighlight).toHaveBeenLastCalledWith(undefined)
      expect(savePlanWallReview).not.toHaveBeenCalled()
    },
  )

  it.each(['conflict', 'network-error'] as const)(
    'keeps a review visible after revoke %s',
    async (kind) => {
      const test = fixture()
      vi.mocked(getPlanWallReviewCandidates).mockResolvedValue({
        ok: true,
        data: {
          candidates: [],
          reviews: [{ id: 'c'.repeat(64), reviewedAt: '2026-10-24T10:00:00.000Z', current: true }],
        },
      })
      if (kind === 'conflict')
        vi.mocked(revokePlanWallReview).mockResolvedValue({
          ok: false,
          error: 'Схема изменилась',
          code: 'plan-conflict',
        })
      else vi.mocked(revokePlanWallReview).mockRejectedValue(new Error('connection lost'))
      await test.load()
      await control(test.render(), 'Снять сверку').props.onClick()
      expect(test.props.onSaved).not.toHaveBeenCalled()
      expect(test.props.onConflict).toHaveBeenCalledTimes(kind === 'conflict' ? 1 : 0)
      expect(errorMessage(test.render())?.message).toContain(
        kind === 'conflict' ? 'Схема изменилась' : 'Не удалось снять сверку',
      )
      expect(control(test.render(), 'Снять сверку')).toBeDefined()
    },
  )
})
