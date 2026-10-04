import { type ComponentProps, createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('@/actions/concepts', () => ({
  checkGeneration: vi.fn(),
  refreshConcepts: vi.fn(),
  requestConcepts: vi.fn(),
  setConceptLike: vi.fn(),
}))
vi.mock('@/lib/collaboration/live-client', () => ({
  useProjectLive: () => ({ likes: null, presence: null }),
}))
vi.mock('@/lib/queue/use-run-watch', () => ({ useRunWatch: vi.fn() }))
vi.mock('@/components/collaboration/presence-chip', () => ({ PresenceChip: () => null }))
vi.mock('@/components/concepts/duo-card', () => ({
  DuoCard: ({ canRun }: { canRun: boolean }) =>
    createElement('span', { 'data-duo-can-run': String(canRun) }),
}))
vi.mock('@/components/swipe-deck', () => ({ SwipeDeck: () => null }))

import { type ConceptItem, ConceptsPanel } from './concepts-panel'

function concept(id: string, overrides: Partial<ConceptItem> = {}): ConceptItem {
  return {
    id,
    batchId: 'batch',
    batchKind: 'regular',
    editRequest: null,
    title: null,
    status: 'ready',
    renderSrc: `/${id}.jpg`,
    owner: false,
    partner: null,
    orderIndex: 0,
    ...overrides,
  }
}

function render(
  items: ConceptItem[],
  overrides: Partial<ComponentProps<typeof ConceptsPanel>> = {},
) {
  return renderToStaticMarkup(
    createElement(ConceptsPanel, {
      roomId: 'room',
      projectId: 'project',
      hasPhoto: false,
      keepsFurniture: false,
      onboarded: true,
      role: 'owner',
      other: null,
      latestBatchId: 'batch',
      items,
      ...overrides,
    }),
  )
}

function conceptLinks(html: string): string[] {
  return [...html.matchAll(/<a href="\/projects\/project\/rooms\/room\/concepts\/([^"]+)"/g)].map(
    (match) => match[1] as string,
  )
}

describe('concept gallery access', () => {
  it('blocks the shared generation too while an earlier launch needs a status check', () => {
    const votes = Array.from({ length: 10 }, (_, index) =>
      concept(`rejected-${index}`, { partner: false }),
    )
    const html = render(votes, {
      other: { name: 'Анна' },
      initialNeedsStatusCheck: true,
    })

    expect(html).toContain('data-duo-can-run="false"')
    expect(html).toContain('Проверить статус генерации')
    expect(html).not.toContain('Сгенерировать концепты')
  })

  it('keeps every rejected concept accessible for an owner without a partner', () => {
    const html = render([concept('first'), concept('second')])

    expect(conceptLinks(html)).toEqual(['first', 'second'])
    expect(html).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>Все 2<\/button>/)
    expect(html).toContain('Понравились 0')
  })

  it('keeps old batches and unreviewed concepts accessible alongside favourites', () => {
    const html = render([
      concept('old-rejected', { batchId: 'old-batch' }),
      concept('favourite', { owner: true }),
      concept('unreviewed', { owner: null }),
    ])

    expect(conceptLinks(html)).toEqual(['old-rejected', 'favourite', 'unreviewed'])
    expect(html).toContain('Все 3')
    expect(html).toContain('Понравились 1')
  })

  it('excludes unfinished, failed and missing-image concepts from the gallery and counts', () => {
    const html = render([
      concept('ready'),
      concept('pending', { status: 'pending' }),
      concept('failed', { status: 'failed' }),
      concept('missing-image', { renderSrc: null }),
    ])

    expect(conceptLinks(html)).toEqual(['ready'])
    expect(html).toContain('Все 1')
  })

  it('preserves the owner favourites and shared voting tabs when a partner is present', () => {
    const html = render(
      [
        concept('owner-only', { owner: true, partner: false }),
        concept('partner-only', { owner: false, partner: true }),
        concept('shared', { owner: true, partner: true }),
      ],
      { other: { name: 'Анна' } },
    )

    expect(conceptLinks(html)).toEqual(['owner-only', 'shared'])
    expect(html).toContain('Все 3')
    expect(html).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>Мои 2<\/button>/)
    expect(html).toContain('Анна 2')
    expect(html).toContain('Общие 1')
  })

  it('uses the partner vote for their own favourites without offering generation', () => {
    const html = render(
      [
        concept('owner-only', { owner: true, partner: false }),
        concept('partner-only', { owner: false, partner: true }),
        concept('shared', { owner: true, partner: true }),
      ],
      { role: 'partner', other: { name: 'Павел' }, canGenerate: false },
    )

    expect(conceptLinks(html)).toEqual(['partner-only', 'shared'])
    expect(html).toContain('Павел 2')
    expect(html).not.toContain('Сгенерировать ещё')
  })

  it('does not show an empty gallery filter before any concept is ready', () => {
    const html = render([])

    expect(conceptLinks(html)).toEqual([])
    expect(html).not.toContain('role="tablist"')
    expect(html).toContain('Сгенерировать концепты')
  })
})
