export type FileKind = 'jpeg' | 'png' | 'webp' | 'pdf'
export type ImageKind = Exclude<FileKind, 'pdf'>

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function ascii(bytes: Uint8Array, from: number, to: number): string {
  return String.fromCharCode(...bytes.subarray(from, to))
}

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs'])

// HEIC хранится в контейнере ISO BMFF. Проверка нужна для понятной ошибки загрузки.
export function isHeicFile(bytes: Uint8Array): boolean {
  if (bytes.length < 12 || ascii(bytes, 4, 8) !== 'ftyp') {
    return false
  }
  for (let offset = 8; offset + 4 <= Math.min(bytes.length, 64); offset += 4) {
    if (HEIC_BRANDS.has(ascii(bytes, offset, offset + 4))) {
      return true
    }
  }
  return false
}

// Тип файла определяем по содержимому, а не по расширению или Content-Type
export function detectFileKind(bytes: Uint8Array): FileKind | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg'
  }
  if (bytes.length >= 8 && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    return 'png'
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') {
    return 'webp'
  }
  if (bytes.length >= 5 && ascii(bytes, 0, 5) === '%PDF-') {
    return 'pdf'
  }
  return null
}

export function isImageKind(kind: FileKind | null): kind is ImageKind {
  return kind === 'jpeg' || kind === 'png' || kind === 'webp'
}
