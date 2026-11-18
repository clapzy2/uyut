'use server'

import { randomUUID } from 'node:crypto'
import { signFurnitureReference } from '@/lib/concepts/furniture-reference-token'
import { getEnv } from '@/lib/env'
import { preparePhoto, UploadError } from '@/lib/files/uploads'
import { AccessError, requireOwner } from '@/lib/projects/access'
import { getRoom } from '@/lib/projects/repository'
import { getSession } from '@/lib/session'
import { deleteObject, presignedObjectUrl, putObject } from '@/lib/storage'

type UploadResult =
  | { ok: true; data: { token: string; previewUrl: string } }
  | { ok: false; error: string }

/** Отдельный образец исходной мебели для следующего переноса, не замена фото комнаты. */
export async function uploadFurnitureReference(
  roomId: string,
  formData: FormData,
): Promise<UploadResult> {
  const session = await getSession()
  if (!session) return { ok: false, error: 'Сессия закончилась. Войдите снова.' }
  const file = formData.get('photo')
  const rawRevision = formData.get('photoRevision')
  if (!(file instanceof File)) return { ok: false, error: 'Выберите фото предмета.' }
  if (typeof rawRevision !== 'string' || !/^\d+$/.test(rawRevision)) {
    return { ok: false, error: 'Обновите страницу и прикрепите фото предмета заново.' }
  }
  const photoRevision = Number(rawRevision)
  let uploadedKey: string | null = null
  try {
    const room = await getRoom(session.user.id, roomId)
    requireOwner(room.role)
    if (!room.photoUrl || room.condition !== 'keep' || room.photoRevision !== photoRevision) {
      return {
        ok: false,
        error: 'Добавьте актуальное фото комнаты и выберите «Оставить как есть».',
      }
    }
    if (room.generationRunId) {
      return {
        ok: false,
        error: 'Комната уже обрабатывается. Дождитесь результата перед загрузкой образца.',
      }
    }
    const prepared = await preparePhoto(file)
    const key = `projects/${room.projectId}/rooms/${room.id}/furniture-references/${randomUUID()}.webp`
    uploadedKey = key
    await putObject(key, prepared.body, prepared.contentType)
    const current = await getRoom(session.user.id, roomId)
    requireOwner(current.role)
    if (
      current.photoRevision !== photoRevision ||
      current.photoUrl !== room.photoUrl ||
      current.condition !== 'keep' ||
      current.generationRunId
    ) {
      throw new UploadError('Фото комнаты изменилось. Прикрепите образец к новому фото.')
    }
    const previewUrl = await presignedObjectUrl(key, 60 * 60)
    const token = signFurnitureReference(
      getEnv().BETTER_AUTH_SECRET,
      { userId: session.user.id, roomId, photoRevision },
      key,
    )
    return { ok: true, data: { token, previewUrl } }
  } catch (error) {
    if (uploadedKey) await deleteObject(uploadedKey).catch(() => undefined)
    if (error instanceof AccessError || error instanceof UploadError)
      return { ok: false, error: error.message }
    console.error('furniture reference upload failed', error)
    return { ok: false, error: 'Не удалось загрузить фото предмета. Попробуйте ещё раз.' }
  }
}
