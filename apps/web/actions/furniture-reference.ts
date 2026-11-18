'use server'

import { randomUUID } from 'node:crypto'
import {
  readFurnitureReference,
  signFurnitureReference,
} from '@/lib/concepts/furniture-reference-token'
import { getEnv } from '@/lib/env'
import { preparePhoto, UploadError } from '@/lib/files/uploads'
import { AccessError, requireOwner } from '@/lib/projects/access'
import { saveFurnitureReference } from '@/lib/projects/furniture-reference'
import { getRoom } from '@/lib/projects/repository'
import { getSession } from '@/lib/session'
import { deleteObject, presignedObjectUrl, putObject } from '@/lib/storage'

type UploadResult = { ok: true; data: FurnitureReferenceView } | { ok: false; error: string }

export type FurnitureReferenceView = { token: string; previewUrl: string }

/** Восстанавливаем образец только владельцу и только для текущего фото комнаты. */
export async function loadSavedFurnitureReference(
  roomId: string,
): Promise<FurnitureReferenceView | null> {
  const session = await getSession()
  if (!session) return null
  const room = await getRoom(session.user.id, roomId)
  requireOwner(room.role)
  const saved = room.furnitureReference
  if (
    !saved ||
    !room.photoUrl ||
    room.condition !== 'keep' ||
    saved.photoRevision !== room.photoRevision
  )
    return null
  const token = signFurnitureReference(
    getEnv().BETTER_AUTH_SECRET,
    { userId: session.user.id, roomId, photoRevision: room.photoRevision },
    saved.key,
  )
  return { token, previewUrl: await presignedObjectUrl(saved.key, 60 * 60) }
}

export async function detachFurnitureReference(
  roomId: string,
  token: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getSession()
  if (!session) return { ok: false, error: 'Сессия закончилась. Войдите снова.' }
  try {
    const room = await getRoom(session.user.id, roomId)
    requireOwner(room.role)
    const reference = readFurnitureReference(
      getEnv().BETTER_AUTH_SECRET,
      { userId: session.user.id, roomId, photoRevision: room.photoRevision },
      token,
    )
    if (!reference) return { ok: false, error: 'Образец устарел. Обновите страницу.' }
    await saveFurnitureReference(session.user.id, roomId, room.photoRevision, null, reference.key)
    return { ok: true }
  } catch (error) {
    if (error instanceof AccessError || error instanceof UploadError)
      return { ok: false, error: error.message }
    console.error('furniture reference detach failed', error)
    return { ok: false, error: 'Не удалось отключить образец. Повторите попытку.' }
  }
}

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
    await saveFurnitureReference(
      session.user.id,
      roomId,
      photoRevision,
      { key, photoRevision },
      room.furnitureReference?.key ?? null,
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
