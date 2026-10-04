import { styleLibrary } from '@uyut/ai'
import { describe, expect, it } from 'vitest'
import { readStyleVoteDraft } from './style-vote-draft'

const votes = styleLibrary.slice(0, 10).map((style, index) => ({
  styleId: style.id,
  liked: index % 2 === 0,
}))

function draft(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({ version: 1, savedVotes: [], votes, restarted: false, ...overrides })
}

describe('черновик выбора интерьеров', () => {
  it('восстанавливает лайки и отказы до отправки в проект', () => {
    expect(readStyleVoteDraft(draft(), [])?.votes).toEqual(votes)
  })

  it('не заменяет новые серверные ответы старым черновиком', () => {
    expect(readStyleVoteDraft(draft(), votes.slice(0, 1))).toBeNull()
  })

  it('сравнивает серверные оценки независимо от порядка их получения', () => {
    expect(readStyleVoteDraft(draft({ savedVotes: votes }), [...votes].reverse())?.votes).toEqual(
      votes,
    )
  })

  it('восстанавливает начало пересмотра без возврата прежних оценок', () => {
    expect(
      readStyleVoteDraft(draft({ savedVotes: votes, votes: [], restarted: true }), votes),
    ).toMatchObject({
      votes: [],
      restarted: true,
    })
  })

  it('игнорирует повреждённые, чужие и повторяющиеся оценки', () => {
    for (const raw of [
      null,
      '{broken',
      'null',
      draft({ version: 2 }),
      draft({ votes: [{ styleId: 'unknown', liked: true }] }),
      draft({ votes: [{ ...votes[0], liked: 'yes' }] }),
      draft({ votes: [votes[0], votes[0]] }),
      draft({ votes: Array.from({ length: 21 }, () => votes[0]) }),
    ]) {
      expect(readStyleVoteDraft(raw, [])).toBeNull()
    }
  })
})
