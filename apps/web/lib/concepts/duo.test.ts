import { buildDuoPrompt, type DuoInput, duoHash, parseDuoProposal } from '@uyut/ai'
import { describe, expect, it } from 'vitest'
import { duoEligibility } from './votes'

const input: DuoInput = {
  roomName: 'Гостиная',
  roomKind: 'living',
  styleTags: ['scandi', 'loft'],
  household: { adults: 2, kids: 0, pets: true, wfh: false },
  owner: {
    name: 'Аня',
    liked: [{ index: 1, title: null, note: 'Тёмные стены и лофт.', variation: 'dark walls' }],
    disliked: [{ index: 2, title: null, note: null, variation: 'light scandi' }],
  },
  partner: {
    name: 'Маша',
    liked: [{ index: 2, title: null, note: null, variation: 'light scandi' }],
    disliked: [{ index: 1, title: null, note: 'Тёмные стены и лофт.', variation: 'dark walls' }],
  },
}

describe('duo prompt', () => {
  it('lists likes and dislikes of both people with concept numbers', () => {
    const prompt = buildDuoPrompt(input)
    expect(prompt).toContain('Аня — нравится:')
    expect(prompt).toContain('концепт 1: Тёмные стены и лофт. Особенность рендера: dark walls')
    expect(prompt).toContain('Маша — не нравится:')
    expect(prompt).toContain('животные есть')
  })

  it('hashes the same votes to the same key', () => {
    expect(duoHash(input)).toBe(duoHash({ ...input, styleTags: [] }))
    expect(duoHash(input)).not.toBe(duoHash({ ...input, partner: { ...input.partner, liked: [] } }))
  })
})

describe('parseDuoProposal', () => {
  const bridge = (n: number) => ({
    title: `Вариант ${n}`,
    idea: `Идея ${n}. Почему подходит обоим.`,
    revision: `english revision ${n}`,
  })

  it('accepts fenced JSON and keeps exactly three bridges', () => {
    const text = `Вот ответ:\n\`\`\`json\n${JSON.stringify({ summary: 'Сходятся на дереве.', bridges: [bridge(1), bridge(2), bridge(3), bridge(4)] })}\n\`\`\``
    const parsed = parseDuoProposal(text)
    expect(parsed.summary).toBe('Сходятся на дереве.')
    expect(parsed.bridges.map((b) => b.title)).toEqual(['Вариант 1', 'Вариант 2', 'Вариант 3'])
  })

  it('rejects an answer with fewer than three usable bridges', () => {
    expect(() =>
      parseDuoProposal(
        JSON.stringify({ summary: 'x', bridges: [bridge(1), { title: 'без идеи' }] }),
      ),
    ).toThrow(/вариантов/)
  })
})

describe('duoEligibility', () => {
  const concept = (owner: boolean | null, partner: boolean | null, kind = 'regular') => ({
    owner,
    partner,
    status: 'ready' as const,
    batchKind: kind as 'regular' | 'duo',
  })

  it('needs ten votes from each side and no common like', () => {
    const disjoint = [
      ...Array.from({ length: 5 }, () => concept(true, false)),
      ...Array.from({ length: 5 }, () => concept(false, true)),
    ]
    expect(duoEligibility(disjoint)).toMatchObject({
      eligible: true,
      ownerVotes: 10,
      partnerVotes: 10,
      both: 0,
    })
    expect(duoEligibility(disjoint.slice(0, 9)).eligible).toBe(false)
    expect(duoEligibility([...disjoint, concept(true, true)]).eligible).toBe(false)
  })

  it('waits while a duo batch is still rendering', () => {
    const items = [
      ...Array.from({ length: 10 }, () => concept(true, false)),
      { ...concept(null, null, 'duo'), status: 'pending' as const },
    ]
    expect(duoEligibility(items)).toMatchObject({ eligible: false, pendingDuo: true })
  })
})
