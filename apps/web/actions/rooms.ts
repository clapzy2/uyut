'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { preparePhoto, UploadError } from '@/lib/files/uploads'
import { AccessError, requireOwner } from '@/lib/projects/access'
import * as repository from '@/lib/projects/repository'
import { getSession } from '@/lib/session'
import { deleteObject, putObject } from '@/lib/storage'
import { projectIdSchema, roomNotesSchema, roomSchema } from '@/lib/validation/projects'

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string }

const SESSION_EXPIRED = 'Сессия закончилась. Войдите снова.'
const GENERIC = 'Не получилось. Попробуйте ещё раз, а если повторится, напишите нам.'

async function currentUserId(): Promise<string | null> {
  const session = await getSession()
  return session?.user.id ?? null
}

function failure(error: unknown): { ok: false; error: string } {
  if (error instanceof AccessError || error instanceof UploadError) {
    return { ok: false, error: error.message }
  }
  console.error(error)
  return { ok: false, error: GENERIC }
}

function revalidateRoom(projectId: string, roomId?: string): void {
  revalidatePath('/projects')
  revalidatePath(`/projects/${projectId}`)
  if (roomId) {
    revalidatePath(`/projects/${projectId}/rooms/${roomId}`)
  }
}

export async function createRoom(
  projectId: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  const id = projectIdSchema.safeParse(projectId)
  const parsed = roomSchema.safeParse(input)
  if (!id.success) {
    return { ok: false, error: 'Проект не найден' }
  }
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Проверьте поля формы' }
  }
  try {
    const room = await repository.createRoom(userId, id.data, parsed.data)
    revalidateRoom(id.data)
    return { ok: true, data: { id: room.id } }
  } catch (error) {
    return failure(error)
  }
}

export async function updateRoom(roomId: string, input: unknown): Promise<ActionResult> {
  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  const parsed = roomSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Проверьте поля формы' }
  }
  try {
    const room = await repository.updateRoom(userId, roomId, parsed.data)
    revalidateRoom(room.projectId, room.id)
    return { ok: true, data: undefined }
  } catch (error) {
    return failure(error)
  }
}

export async function updateRoomNotes(roomId: string, input: unknown): Promise<ActionResult> {
  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  const parsed = roomNotesSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Проверьте заметки' }
  }
  try {
    const room = await repository.updateRoom(userId, roomId, {
      notes: parsed.data.notes === '' ? null : parsed.data.notes,
    })
    revalidateRoom(room.projectId, room.id)
    return { ok: true, data: undefined }
  } catch (error) {
    return failure(error)
  }
}

export async function deleteRoom(roomId: string): Promise<ActionResult<{ projectId: string }>> {
  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  try {
    const room = await repository.getRoom(userId, roomId)
    const { fileKeys } = await repository.deleteRoom(userId, roomId)
    await Promise.all(fileKeys.map((key) => deleteObject(key).catch(() => undefined)))
    revalidateRoom(room.projectId, room.id)
    return { ok: true, data: { projectId: room.projectId } }
  } catch (error) {
    return failure(error)
  }
}

export async function uploadRoomPhoto(roomId: string, formData: FormData): Promise<ActionResult> {
  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  const file = formData.get('photo')
  if (!(file instanceof File)) {
    return { ok: false, error: 'Выберите файл с фото.' }
  }
  try {
    const room = await repository.getRoom(userId, roomId)
    requireOwner(room.role)
    const prepared = await preparePhoto(file)
    const key = `projects/${room.projectId}/rooms/${room.id}/photo/${randomUUID()}.${prepared.extension}`
    await putObject(key, prepared.body, prepared.contentType)
    const { previousKey } = await repository.setRoomPhoto(userId, room.id, key)
    if (previousKey) {
      await deleteObject(previousKey).catch(() => undefined)
    }
    revalidateRoom(room.projectId, room.id)
    return { ok: true, data: undefined }
  } catch (error) {
    return failure(error)
  }
}
