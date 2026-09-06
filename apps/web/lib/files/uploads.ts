import sharp from 'sharp'
import { detectFileKind, type FileKind, isImageKind } from './detect'
import { PHOTO_MAX_BYTES, PLAN_MAX_BYTES, tooLargeMessage } from './rules'

const PLAN_MAX_SIDE = 4000
const PHOTO_MAX_SIDE = 2048

export class UploadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UploadError'
  }
}

export type PreparedUpload = {
  body: Buffer
  contentType: string
  extension: string
  kind: FileKind
}

async function readFile(file: File, limit: number, emptyMessage: string): Promise<Uint8Array> {
  if (file.size === 0) {
    throw new UploadError(emptyMessage)
  }
  if (file.size > limit) {
    throw new UploadError(tooLargeMessage(file.size, limit))
  }
  return new Uint8Array(await file.arrayBuffer())
}

// Изображение пересобирается заново: поворот по EXIF, ограничение стороны, WebP без метаданных
async function normalizeImage(
  bytes: Uint8Array,
  maxSide: number,
  quality: number,
): Promise<Buffer> {
  return sharp(Buffer.from(bytes))
    .rotate()
    .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
    .webp({ quality })
    .toBuffer()
}

export async function preparePlan(file: File): Promise<PreparedUpload> {
  const bytes = await readFile(file, PLAN_MAX_BYTES, 'Выберите файл с планом.')
  const kind = detectFileKind(bytes)
  if (!kind) {
    throw new UploadError('Это не похоже на PDF, JPG или PNG. Попробуйте другой файл.')
  }
  if (kind === 'pdf') {
    return { body: Buffer.from(bytes), contentType: 'application/pdf', extension: 'pdf', kind }
  }
  try {
    const body = await normalizeImage(bytes, PLAN_MAX_SIDE, 90)
    return { body, contentType: 'image/webp', extension: 'webp', kind }
  } catch {
    throw new UploadError('Не удалось прочитать план: похоже, файл повреждён. Попробуйте другой.')
  }
}

export async function preparePhoto(file: File): Promise<PreparedUpload> {
  const bytes = await readFile(file, PHOTO_MAX_BYTES, 'Выберите файл с фото.')
  const kind = detectFileKind(bytes)
  if (!isImageKind(kind)) {
    throw new UploadError('Это не похоже на JPG, PNG или WebP. Попробуйте другой файл.')
  }
  try {
    const body = await normalizeImage(bytes, PHOTO_MAX_SIDE, 85)
    return { body, contentType: 'image/webp', extension: 'webp', kind }
  } catch {
    throw new UploadError('Не удалось прочитать фото: похоже, файл повреждён. Попробуйте другой.')
  }
}
