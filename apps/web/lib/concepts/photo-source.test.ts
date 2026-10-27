import { describe, expect, it } from 'vitest'
import { isFromPreviousPhoto } from './photo-source'

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
