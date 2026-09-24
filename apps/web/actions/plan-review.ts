'use server'

import {
  type ConceptPlanReview,
  conceptPlanReviews,
  concepts,
  type PlanReviewVerdict,
} from '@uyut/db'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { recordAudit } from '@/lib/audit'
import { planReviewSource } from '@/lib/concepts/plan-review'
import { getDb } from '@/lib/db'
import { AccessError, NotFoundError, requireOwner } from '@/lib/projects/access'
import { getRoom } from '@/lib/projects/repository'
import { getSession } from '@/lib/session'

const verdict = z.enum(['unrated', 'matches', 'conflicts', 'not_visible'])
const reviewSchema = z.object({
  shape: verdict,
  openings: z.array(verdict).max(50),
  extraOpenings: verdict,
})

export async function savePlanReview(
  conceptId: string,
  sourceHash: string,
  values: {
    shape: ConceptPlanReview['shape']
    openings: ConceptPlanReview['openings']
    extraOpenings: PlanReviewVerdict
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getSession()
  if (!session) return { ok: false, error: 'Сессия закончилась. Войдите снова.' }
  if (!z.uuid().safeParse(conceptId).success || !/^[a-f0-9]{64}$/.test(sourceHash)) {
    return { ok: false, error: 'Некорректные данные проверки.' }
  }
  const parsed = reviewSchema.safeParse(values)
  if (!parsed.success) return { ok: false, error: 'Выберите оценку для формы и проёмов.' }
  if (
    parsed.data.shape === 'unrated' &&
    parsed.data.openings.every((item) => item === 'unrated') &&
    parsed.data.extraOpenings === 'unrated'
  ) {
    return { ok: false, error: 'Отметьте хотя бы один пункт.' }
  }

  try {
    const db = getDb()
    const [concept] = await db.select().from(concepts).where(eq(concepts.id, conceptId)).limit(1)
    if (!concept) throw new NotFoundError('Концепт не найден')
    const room = await getRoom(session.user.id, concept.roomId)
    requireOwner(room.role)
    const planKey = room.planUrl ?? room.project.planUrl
    const source = planReviewSource(
      planKey,
      concept.editedRenderUrl ?? concept.renderUrl,
      room.project.planReading?.geometry,
      room.name,
    )
    if (!source || source.hash !== sourceHash) {
      return {
        ok: false,
        error: 'План или концепт изменились. Обновите страницу и проверьте снова.',
      }
    }
    if (parsed.data.openings.length !== source.architecture.openings.length) {
      return { ok: false, error: 'Список проёмов изменился. Обновите страницу.' }
    }
    const review: ConceptPlanReview = {
      version: 1,
      sourceHash,
      ...parsed.data,
      reviewedAt: new Date().toISOString(),
    }
    await db
      .insert(conceptPlanReviews)
      .values({ conceptId, review })
      .onConflictDoUpdate({
        target: conceptPlanReviews.conceptId,
        set: { review, updatedAt: new Date() },
      })
    await recordAudit({
      action: 'concepts.plan_reviewed',
      actorId: session.user.id,
      targetType: 'concept',
      targetId: conceptId,
      metadata: {
        conflicts:
          Number(review.shape === 'conflicts') +
          review.openings.filter((item) => item === 'conflicts').length +
          Number(review.extraOpenings === 'conflicts'),
      },
    })
    revalidatePath(`/projects/${room.projectId}/rooms/${room.id}/concepts/${conceptId}`)
    return { ok: true }
  } catch (error) {
    if (error instanceof AccessError) return { ok: false, error: error.message }
    console.error(error)
    return { ok: false, error: 'Не получилось сохранить проверку. Попробуйте ещё раз.' }
  }
}
