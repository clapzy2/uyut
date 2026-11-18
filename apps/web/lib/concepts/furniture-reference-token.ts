import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

type ReferenceContext = { userId: string; roomId: string; photoRevision: number }
export type FurnitureReference = { key: string; photoRevision: number }

const receiptSchema = z.object({
  userId: z.string().min(1),
  roomId: z.uuid(),
  photoRevision: z.number().int().nonnegative(),
  key: z.string().max(500),
  expiresAt: z.number().int().nonnegative(),
})

function signature(secret: string, payload: string): Buffer {
  return createHmac('sha256', secret).update(`furniture-reference:${payload}`).digest()
}

function keyBelongsToRoom(key: string, roomId: string): boolean {
  const parts = key.split('/')
  return (
    parts.length === 6 &&
    parts[0] === 'projects' &&
    z.uuid().safeParse(parts[1]).success &&
    parts[2] === 'rooms' &&
    parts[3] === roomId &&
    parts[4] === 'furniture-references' &&
    /^[0-9a-f-]{36}\.webp$/i.test(parts[5] ?? '')
  )
}

/** Подпись не заменяет текущую проверку владельца комнаты перед запуском. */
export function signFurnitureReference(
  secret: string,
  context: ReferenceContext,
  key: string,
  now = Date.now(),
): string {
  const receipt = receiptSchema.parse({ ...context, key, expiresAt: now + 60 * 60_000 })
  if (!keyBelongsToRoom(key, context.roomId)) throw new Error('Предмет не относится к комнате')
  const payload = Buffer.from(JSON.stringify(receipt)).toString('base64url')
  return `${payload}.${signature(secret, payload).toString('base64url')}`
}

export function readFurnitureReference(
  secret: string,
  context: ReferenceContext,
  token: string,
  now = Date.now(),
): FurnitureReference | null {
  if (typeof token !== 'string' || token.length > 4096) return null
  const [payload, mac, extra] = token.split('.')
  if (!payload || !mac || extra !== undefined || !/^[A-Za-z0-9_-]{43}$/.test(mac)) return null
  const actual = Buffer.from(mac, 'base64url')
  const expected = signature(secret, payload)
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
  try {
    const receipt = receiptSchema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString()))
    if (
      receipt.expiresAt <= now ||
      receipt.userId !== context.userId ||
      receipt.roomId !== context.roomId ||
      receipt.photoRevision !== context.photoRevision ||
      !keyBelongsToRoom(receipt.key, context.roomId)
    )
      return null
    return { key: receipt.key, photoRevision: receipt.photoRevision }
  } catch {
    return null
  }
}
