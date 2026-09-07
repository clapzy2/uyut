import { describe, expect, it } from 'vitest'
import { mergeVotes, splitVotes, voteCounts } from './votes'

const items = [
  { id: 'a', owner: true, partner: true },
  { id: 'b', owner: true, partner: null },
  { id: 'c', owner: null, partner: true },
  { id: 'd', owner: false, partner: true },
  { id: 'e', owner: null, partner: null },
]

describe('splitVotes', () => {
  it('splits by the role of the viewer', () => {
    const owner = splitVotes(items, 'owner')
    expect(owner.unseen.map((i) => i.id)).toEqual(['c', 'e'])
    expect(owner.mine.map((i) => i.id)).toEqual(['a', 'b'])
    expect(owner.theirs.map((i) => i.id)).toEqual(['a', 'c', 'd'])
    expect(owner.both.map((i) => i.id)).toEqual(['a'])

    const partner = splitVotes(items, 'partner')
    expect(partner.unseen.map((i) => i.id)).toEqual(['b', 'e'])
    expect(partner.mine.map((i) => i.id)).toEqual(['a', 'c', 'd'])
    expect(partner.theirs.map((i) => i.id)).toEqual(['a', 'b'])
    expect(partner.both.map((i) => i.id)).toEqual(['a'])
  })

  it('counts votes of each side', () => {
    expect(voteCounts(items)).toEqual({ owner: 3, partner: 3 })
  })
})

describe('mergeVotes', () => {
  it('applies server likes but keeps fresh local votes of the viewer', () => {
    const merged = mergeVotes(
      items,
      { b: { owner: true, partner: true }, e: { owner: null, partner: false } },
      'owner',
      { e: true },
    )
    expect(merged.find((i) => i.id === 'b')).toEqual({ id: 'b', owner: true, partner: true })
    expect(merged.find((i) => i.id === 'e')).toEqual({ id: 'e', owner: true, partner: false })
    expect(merged.find((i) => i.id === 'a')).toEqual(items[0])
  })
})
