import { describe, expect, it } from 'vitest'
import { detectImageKind } from './avatar'

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values)
}

describe('detectImageKind', () => {
  it('recognises jpeg by its first three bytes', () => {
    expect(detectImageKind(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10))).toBe('jpeg')
  })

  it('recognises png by its signature', () => {
    expect(detectImageKind(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00))).toBe('png')
  })

  it('recognises webp inside a riff container', () => {
    const riff = [...'RIFF'].map((c) => c.charCodeAt(0))
    const webp = [...'WEBP'].map((c) => c.charCodeAt(0))
    expect(detectImageKind(bytes(...riff, 0x10, 0x00, 0x00, 0x00, ...webp, 0x56))).toBe('webp')
  })

  it('rejects an executable renamed to jpg', () => {
    expect(detectImageKind(bytes(0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00))).toBeNull()
  })

  it('rejects an empty file', () => {
    expect(detectImageKind(bytes())).toBeNull()
  })
})
