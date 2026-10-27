import { describe, expect, it } from 'vitest'
import { isFromPreviousPhoto, shoppingItemsFromPreviousPhoto } from './photo-source'

describe('isFromPreviousPhoto', () => {
  it('does not label legacy concepts while the original photo remains', () => {
    expect(isFromPreviousPhoto(0, null)).toBe(false)
  })

  it('labels earlier concepts after a photo replacement', () => {
    expect(isFromPreviousPhoto(1, null)).toBe(true)
    expect(isFromPreviousPhoto(2, 1)).toBe(true)
  })

  it('keeps concepts from the current photo unmarked', () => {
    expect(isFromPreviousPhoto(1, 1)).toBe(false)
    expect(isFromPreviousPhoto(2, 2)).toBe(false)
  })
})

describe('shoppingItemsFromPreviousPhoto', () => {
  it('marks only products selected from concepts built before this room photo', () => {
    const items = [
      { id: 'old', conceptObjectId: 'old-object' },
      { id: 'current', conceptObjectId: 'current-object' },
      { id: 'manual', conceptObjectId: null },
      { id: 'unresolved', conceptObjectId: 'missing-object' },
    ]
    const objectConcepts = [
      { id: 'old-object', conceptId: 'old-concept' },
      { id: 'current-object', conceptId: 'current-concept' },
    ]
    const concepts = [
      { id: 'old-concept', roomId: 'living', sourcePhotoRevision: null },
      { id: 'current-concept', roomId: 'living', sourcePhotoRevision: 1 },
    ]

    expect(
      shoppingItemsFromPreviousPhoto(items, objectConcepts, concepts, [
        { id: 'living', photoRevision: 1 },
      ]),
    ).toEqual(['old'])
    expect(
      shoppingItemsFromPreviousPhoto(items, objectConcepts, concepts, [
        { id: 'living', photoRevision: 0 },
      ]),
    ).toEqual([])
  })
})
