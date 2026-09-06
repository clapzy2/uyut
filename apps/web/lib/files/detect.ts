export type FileKind = 'jpeg' | 'png' | 'webp' | 'pdf'
export type ImageKind = Exclude<FileKind, 'pdf'>

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function ascii(bytes: Uint8Array, from: number, to: number): string {
  return String.fromCharCode(...bytes.subarray(from, to))
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
