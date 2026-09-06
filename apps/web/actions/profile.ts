'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { recordAudit } from '@/lib/audit'
import { getAuth } from '@/lib/auth'
import { normalizeAvatar } from '@/lib/avatar'
import { AVATAR_MAX_BYTES } from '@/lib/avatar-rules'
import { detectFileKind, isImageKind } from '@/lib/files/detect'
import { getSession } from '@/lib/session'
import { deleteObject, putObject } from '@/lib/storage'
import { profileSchema } from '@/lib/validation/auth'

export type ActionResult = { ok: true } | { ok: false; error: string }

const SESSION_EXPIRED = 'Сессия закончилась. Войдите снова.'

export async function updateProfile(input: unknown): Promise<ActionResult> {
  const session = await getSession()
  if (!session) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  const parsed = profileSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Проверьте поля формы' }
  }

  const requestHeaders = await headers()
  // Через Better Auth, а не напрямую в базу: так обновится и кэш сессии
  await getAuth().api.updateUser({ body: { name: parsed.data.name }, headers: requestHeaders })
  await recordAudit({
    action: 'profile.updated',
    actorId: session.user.id,
    headers: requestHeaders,
  })
  revalidatePath('/', 'layout')
  return { ok: true }
}

export async function uploadAvatar(formData: FormData): Promise<ActionResult> {
  const session = await getSession()
  if (!session) {
    return { ok: false, error: SESSION_EXPIRED }
  }

  const file = formData.get('avatar')
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'Выберите файл с фото.' }
  }
  if (file.size > AVATAR_MAX_BYTES) {
    return { ok: false, error: 'Подойдёт фото до 5 МБ.' }
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  if (!isImageKind(detectFileKind(bytes))) {
    return { ok: false, error: 'Это не похоже на JPG, PNG или WebP. Попробуйте другой файл.' }
  }

  let normalized: Buffer
  try {
    normalized = await normalizeAvatar(Buffer.from(bytes))
  } catch {
    return { ok: false, error: 'Не удалось прочитать фото: похоже, файл повреждён.' }
  }

  const key = `avatars/${session.user.id}/${randomUUID()}.webp`
  await putObject(key, normalized, 'image/webp')

  const requestHeaders = await headers()
  await getAuth().api.updateUser({ body: { image: key }, headers: requestHeaders })

  const previous = session.user.image
  if (previous) {
    await deleteObject(previous).catch(() => undefined)
  }

  await recordAudit({
    action: 'profile.avatar_changed',
    actorId: session.user.id,
    headers: requestHeaders,
  })
  revalidatePath('/profile')
  return { ok: true }
}
