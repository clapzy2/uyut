'use server'

import { randomUUID } from 'node:crypto'
import { createVoyageEmbedder, findSwatch, swatchAvailability } from '@uyut/ai'
import { type ConceptEdit, conceptObjects, concepts } from '@uyut/db'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import sharp from 'sharp'
import { recordAudit } from '@/lib/audit'
import { getDb } from '@/lib/db'
import { getEnv } from '@/lib/env'
import { NotFoundError } from '@/lib/projects/access'
import { getRoom } from '@/lib/projects/repository'
import { getSession } from '@/lib/session'
import { deleteObject, putObject } from '@/lib/storage'

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string }

const SESSION_EXPIRED = 'Сессия закончилась. Войдите снова.'
const GENERIC = 'Не получилось. Попробуйте ещё раз, а если повторится, напишите нам.'
const MAX_BYTES = 12 * 1024 * 1024

async function conceptForUser(userId: string, conceptId: string) {
  const [concept] = await getDb().select().from(concepts).where(eq(concepts.id, conceptId)).limit(1)
  if (!concept) {
    throw new NotFoundError('Концепт не найден')
  }
  const room = await getRoom(userId, concept.roomId)
  return { concept, room }
}

function revalidate(projectId: string, roomId: string, conceptId: string): void {
  revalidatePath(`/projects/${projectId}/rooms/${roomId}`)
  revalidatePath(`/projects/${projectId}/rooms/${roomId}/concepts/${conceptId}`)
}

/**
 * Сохранить перекрашенный рендер. Оригинал остаётся, отредактированная версия живёт рядом,
 * а вырезка предмета в новом цвете получает свой вектор, чтобы подбор показывал товары нужного цвета.
 */
export async function saveRecolor(
  conceptId: string,
  objectId: string,
  swatchId: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await getSession()
  if (!session) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  const file = formData.get('image')
  if (!(file instanceof File) || file.size === 0 || file.size > MAX_BYTES) {
    return { ok: false, error: 'Картинка не пришла или слишком большая.' }
  }
  const swatch = findSwatch(swatchId)
  if (!swatch) {
    return { ok: false, error: 'Такого материала нет.' }
  }
  try {
    const { concept, room } = await conceptForUser(session.user.id, conceptId)
    const db = getDb()
    const [object] = await db
      .select()
      .from(conceptObjects)
      .where(and(eq(conceptObjects.id, objectId), eq(conceptObjects.conceptId, concept.id)))
      .limit(1)
    if (!object) {
      return { ok: false, error: 'Предмет не найден.' }
    }
    if (swatchAvailability(object.category, swatch) !== 'ok') {
      return { ok: false, error: 'Этот материал появится во второй версии.' }
    }

    const image = sharp(Buffer.from(await file.arrayBuffer()))
    const meta = await image.metadata()
    const width = meta.width ?? 0
    const height = meta.height ?? 0
    if (!width || !height) {
      return { ok: false, error: 'Картинка повреждена.' }
    }
    const webp = await image.webp({ quality: 88 }).toBuffer()
    const key = `projects/${room.projectId}/rooms/${room.id}/concepts/${concept.id}/edited-${randomUUID()}.webp`
    await putObject(key, webp, 'image/webp')

    const edits: ConceptEdit[] = [
      ...(concept.edits ?? []).filter((edit) => edit.objectId !== object.id),
      { objectId: object.id, swatchId: swatch.id },
    ]
    await db
      .update(concepts)
      .set({ editedRenderUrl: key, edits })
      .where(eq(concepts.id, concept.id))
    if (concept.editedRenderUrl) {
      await deleteObject(concept.editedRenderUrl).catch(() => undefined)
    }

    // Вектор вырезки в новом цвете: подбор справа начинает искать товары этого цвета
    let editedEmbedding: number[] | null = null
    const voyageKey = getEnv().VOYAGE_API_KEY
    if (voyageKey) {
      try {
        const pad = 0.04
        const left = Math.max(0, Math.round((object.bbox.x - pad) * width))
        const top = Math.max(0, Math.round((object.bbox.y - pad) * height))
        const right = Math.min(width, Math.round((object.bbox.x + object.bbox.w + pad) * width))
        const bottom = Math.min(height, Math.round((object.bbox.y + object.bbox.h + pad) * height))
        const crop = await sharp(webp)
          .extract({
            left,
            top,
            width: Math.max(8, right - left),
            height: Math.max(8, bottom - top),
          })
          .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 88 })
          .toBuffer()
        const [vector] = await createVoyageEmbedder(voyageKey).embed([
          { image: { body: crop, contentType: 'image/jpeg' } },
        ])
        editedEmbedding = vector ?? null
      } catch (error) {
        console.error('edited embedding failed', error)
      }
    }
    await db
      .update(conceptObjects)
      .set({ swatchId: swatch.id, editedEmbedding })
      .where(eq(conceptObjects.id, object.id))

    await recordAudit({
      action: 'concept.recolored',
      actorId: session.user.id,
      targetType: 'concept',
      targetId: concept.id,
      metadata: { objectId: object.id, swatchId: swatch.id },
    })
    revalidate(room.projectId, room.id, concept.id)
    return { ok: true, data: undefined }
  } catch (error) {
    if (error instanceof NotFoundError) {
      return { ok: false, error: error.message }
    }
    console.error(error)
    return { ok: false, error: GENERIC }
  }
}

/** Вернуть исходный рендер и исходные векторы предметов. */
export async function resetRecolor(conceptId: string): Promise<ActionResult> {
  const session = await getSession()
  if (!session) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  try {
    const { concept, room } = await conceptForUser(session.user.id, conceptId)
    const db = getDb()
    await db
      .update(concepts)
      .set({ editedRenderUrl: null, edits: null })
      .where(eq(concepts.id, concept.id))
    await db
      .update(conceptObjects)
      .set({ swatchId: null, editedEmbedding: null })
      .where(eq(conceptObjects.conceptId, concept.id))
    if (concept.editedRenderUrl) {
      await deleteObject(concept.editedRenderUrl).catch(() => undefined)
    }
    revalidate(room.projectId, room.id, concept.id)
    return { ok: true, data: undefined }
  } catch (error) {
    if (error instanceof NotFoundError) {
      return { ok: false, error: error.message }
    }
    console.error(error)
    return { ok: false, error: GENERIC }
  }
}
