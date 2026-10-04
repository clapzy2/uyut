import { styleLibrary } from '@uyut/ai'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StyleVoteInput } from '@/lib/validation/onboarding'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/actions/onboarding', () => ({ saveStyleVotes: vi.fn() }))
vi.mock('@/components/swipe-deck', () => ({
  SwipeDeck: ({ cards, likedCount }: { cards: { id: string }[]; likedCount: number }) =>
    createElement('div', {
      'data-cards': cards.map((card) => card.id).join(','),
      'data-liked': likedCount,
    }),
}))
vi.mock('@/components/onboarding/onboarding-shell', () => ({
  OnboardingShell: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('@/lib/onboarding/guard', () => ({ requireStepProject: vi.fn() }))

import Step4 from '@/app/onboarding/step-4/page'
import { requireStepProject } from '@/lib/onboarding/guard'
import { StyleSwipe } from './style-swipe'

function votes(count: number, liked = true): StyleVoteInput[] {
  return styleLibrary.slice(0, count).map((style, index) => ({
    styleId: style.id,
    liked: liked && index === 0,
  }))
}

function render(initialVotes: StyleVoteInput[]) {
  return renderToStaticMarkup(createElement(StyleSwipe, { projectId: 'project', initialVotes }))
}

function nextDisabled(html: string): boolean {
  const button = html.match(/<button[^>]*>Дальше<\/button>/)?.[0]
  expect(button).toBeDefined()
  return button?.includes(' disabled=""') ?? false
}

beforeEach(() => vi.clearAllMocks())

describe('возвращение к выбору стиля', () => {
  it('учитывает сохранённые лайки и отказы, оставляя только непросмотренные карточки', () => {
    const saved = votes(10)
    const html = render(saved)

    expect(html).toContain('Сохранённые оценки восстановлены: 10 из 20.')
    expect(html).toContain('data-liked="1"')
    expect(nextDisabled(html)).toBe(false)
    expect(html).toContain('data-cards="')
    for (const vote of saved) {
      expect(html).not.toContain(vote.styleId)
    }
    for (const style of styleLibrary.slice(10)) {
      expect(html).toContain(style.id)
    }
  })

  it('не считает первый визит сохранённым ответом', () => {
    const html = render([])

    expect(html).not.toContain('Сохранённые оценки восстановлены')
    expect(nextDisabled(html)).toBe(true)
  })

  it('не меняет порядок карточек между сервером и браузером из-за времени', () => {
    const clock = vi.spyOn(Date, 'now')
    try {
      clock.mockReturnValue(100)
      const server = render([])
      clock.mockReturnValue(900)
      expect(render([])).toBe(server)
    } finally {
      clock.mockRestore()
    }
  })

  it('сохраняет минимум десять оценок и хотя бы одну понравившуюся комнату', () => {
    expect(nextDisabled(render(votes(9)))).toBe(true)
    const disliked = render(votes(10, false))
    expect(nextDisabled(disliked)).toBe(true)
    expect(disliked).toContain('Выберите хотя бы одну комнату, которая вам нравится.')
    expect(disliked).not.toContain('Отметьте ещё 0')
  })

  it('позволяет перейти дальше или начать заново после двадцати сохранённых оценок', () => {
    const html = render(votes(20))

    expect(html).toContain('data-cards=""')
    expect(html).toContain('Пересмотреть все карточки')
    expect(nextDisabled(html)).toBe(false)
  })

  it('страница передаёт голоса из проверенного проекта, включая отрицательные', async () => {
    const saved = votes(10)
    vi.mocked(requireStepProject).mockResolvedValue({
      id: 'project',
      styleVotes: saved,
    } as Awaited<ReturnType<typeof requireStepProject>>)
    const searchParams = Promise.resolve({ project: 'project' })
    const page = await Step4({ searchParams })

    expect(renderToStaticMarkup(page)).toContain('Сохранённые оценки восстановлены: 10 из 20.')
    expect(requireStepProject).toHaveBeenCalledWith(searchParams, 4)
  })
})
