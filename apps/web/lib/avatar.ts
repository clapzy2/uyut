import sharp from 'sharp'
import { AVATAR_SIZE } from './avatar-rules'

// Квадрат 512, WebP, без EXIF: sharp не переносит метаданные, поворот применяем до их потери
export function normalizeAvatar(input: Buffer): Promise<Buffer> {
  return sharp(input)
    .rotate()
    .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'attention' })
    .webp({ quality: 82 })
    .toBuffer()
}
