import { describe, expect, it } from 'vitest'
import { detectFileKind, isImageKind } from './detect'

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values)
}

function text(value: string): number[] {
  return [...value].map((c) => c.charCodeAt(0))
}

describe('detectFileKind', () => {
  it('recognises jpeg by its first three bytes', () => {
    expect(detectFileKind(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10))).toBe('jpeg')
  })

  it('recognises png by its signature', () => {
    expect(detectFileKind(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00))).toBe('png')
  })

  it('recognises webp inside a riff container', () => {
    expect(detectFileKind(bytes(...text('RIFF'), 0x10, 0, 0, 0, ...text('WEBP'), 0x56))).toBe(
      'webp',
    )
  })

  it('recognises pdf by its header', () => {
    expect(detectFileKind(bytes(...text('%PDF-1.7'), 0x0a))).toBe('pdf')
  })

  it('rejects an executable renamed to jpg', () => {
    expect(detectFileKind(bytes(0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00))).toBeNull()
  })

  it('rejects an empty file', () => {
    expect(detectFileKind(bytes())).toBeNull()
  })

  it('separates images from documents', () => {
    expect(isImageKind('pdf')).toBe(false)
    expect(isImageKind('webp')).toBe(true)
    expect(isImageKind(null)).toBe(false)
  })
})
