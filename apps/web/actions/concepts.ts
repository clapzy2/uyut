'use server'

import { randomUUID } from 'node:crypto'
import { tasks, auth as triggerAuth } from '@trigger.dev/sdk'
import { buildEditPlan, type DuoProposal, type EditPlan } from '@uyut/ai'
import { revalidatePath } from 'next/cache'
import { recordAudit } from '@/lib/audit'
import { bumpProjectVersion } from '@/lib/collaboration/live'
import { APARTMENT_COUNT, apartmentPlan } from '@/lib/concepts/apartment'
import { getDuoOffer } from '@/lib/concepts/duo'
import * as conceptsRepository from '@/lib/concepts/repository'
import { generationStillRunning } from '@/lib/concepts/resume-run'
import { getEnv } from '@/lib/env'
import { AccessError, requireOwner } from '@/lib/projects/access'
import {
  attachGenerationRun,
  claimRoomForGeneration,
  clearGenerationRun,
  getProject,
  getRoom,
} from '@/lib/projects/repository'
import { getConceptsByUserLimiter } from '@/lib/redis'
import { getSession } from '@/lib/session'
import { conceptEditSchema } from '@/lib/validation/projects'

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string }

const SESSION_EXPIRED = 'Сессия закончилась. Войдите снова.'
const GENERIC = 'Не получилось. Попробуйте ещё раз, а если повторится, напишите нам.'
const NO_KEYS = 'Генерация пока не подключена: в настройках сервиса нет ключей.'

export type ConceptRun = { runId: string; accessToken: string; batchId: string }

async function currentUserId(): Promise<string | null> {
  const session = await getSession()
  return session?.user.id ?? null
}

function failure(error: unknown): { ok: false; error: string } {
  if (error instanceof AccessError) {
    return { ok: false, error: error.message }
  }
  console.error(error)
  return { ok: false, error: GENERIC }
}

/** Сколько рендеров делать: с нуля нужен выбор, для правки достаточно трёх прочтений одной просьбы. */
const FRESH_COUNT = 5
const EDIT_COUNT = 3

export type ConceptRequest = {
  /** Правка из чата, по-английски */
  revision?: string
  /** Рендер-основа: правим его, а не фотографию комнаты */
  baseConceptId?: string
  /** Просьба словами человека к этой правке */
  editRequest?: string
  /** Разобранный на шаги план, показанный человеку до запуска */
  editSteps?: Array<{ titleRu: string; prompt: string }>
  /** Предмет с рендера: его вырезка уйдёт в модель вторым кадром */
  objectId?: string
}

export async function requestConcepts(
  roomId: string,
  request: ConceptRequest = {},
): Promise<ActionResult<ConceptRun>> {
  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  const env = getEnv()
  if (!env.FAL_KEY || !env.TRIGGER_SECRET_KEY) {
    return { ok: false, error: NO_KEYS }
  }
  const { revision, baseConceptId, editRequest, editSteps, objectId } = request
  try {
    const room = await getRoom(userId, roomId)
    requireOwner(room.role)
    // «Оставить как есть» без единого пожелания даёт пять копий фотографии: менять нечего.
    if (!baseConceptId && room.condition === 'keep' && !room.notes?.trim() && !revision?.trim()) {
      return {
        ok: false,
        error: 'Напишите в заметках, что поменять. Комната остаётся как есть, менять пока нечего.',
      }
    }
    const { success } = await getConceptsByUserLimiter().limit(userId)
    if (!success) {
      return { ok: false, error: 'Сегодня уже много генераций. Попробуйте через час.' }
    }
    const batchId = randomUUID()
    const handle = await tasks.trigger('generate-concept', {
      roomId: room.id,
      batchId,
      // В режиме «оставить как есть» пять вариантов одной и той же комнаты почти не отличаются: платить за пять незачем
      count: baseConceptId || room.condition === 'keep' ? EDIT_COUNT : FRESH_COUNT,
      ...(revision ? { revision: revision.slice(0, 500) } : {}),
      ...(baseConceptId ? { baseConceptId } : {}),
      ...(editRequest ? { editRequest: editRequest.slice(0, 500) } : {}),
      ...(editSteps && editSteps.length > 0 ? { editSteps } : {}),
      ...(objectId ? { objectId } : {}),
    })
    await attachGenerationRun(room.id, handle.id, batchId)
    await recordAudit({
      action: 'concepts.requested',
      actorId: userId,
      targetType: 'room',
      targetId: room.id,
      metadata: { batchId, runId: handle.id, ...(baseConceptId ? { baseConceptId } : {}) },
    })
    const accessToken =
      handle.publicAccessToken ??
      (await triggerAuth.createPublicToken({ scopes: { read: { runs: [handle.id] } } }))
    return { ok: true, data: { runId: handle.id, accessToken, batchId } }
  } catch (error) {
    return failure(error)
  }
}

/**
 * Обставить квартиру целиком: по одному запуску на каждую комнату, где ещё нет концептов.
 *
 * Стиль у комнат общий и так: он живёт у проекта, а не у комнаты. Ценность этой кнопки
 * в другом — человеку не нужно заходить в каждую комнату и ждать пять раз подряд. Рендеров
 * на комнату берём три, а не пять: при четырёх комнатах пять вариантов в каждой — это двадцать
 * картинок и деньги, которых человек не ждал.
 */
export async function requestApartmentConcepts(
  projectId: string,
): Promise<ActionResult<{ started: number; asked: number }>> {
  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  const env = getEnv()
  if (!env.FAL_KEY || !env.TRIGGER_SECRET_KEY) {
    return { ok: false, error: NO_KEYS }
  }
  try {
    const project = await getProject(userId, projectId)
    requireOwner(project.role)
    const { ready } = apartmentPlan(project.rooms)
    if (ready.length === 0) {
      return { ok: false, error: 'Обставлять нечего: во всех комнатах уже что-то есть.' }
    }
    let started = 0
    let throttled = false
    for (const room of ready) {
      // Счётчик тратим по комнате, а не по нажатию: пять комнат — это пять генераций,
      // и общий предел должен считать их пятью, иначе он ничего не ограничивает
      const { success } = await getConceptsByUserLimiter().limit(userId)
      if (!success) {
        throttled = true
        break
      }
      const batchId = randomUUID()
      // Занимаем комнату до запуска: два нажатия подряд иначе оплатят одну комнату дважды
      if (!(await claimRoomForGeneration(room.id, batchId))) {
        continue
      }
      // Падение одной комнаты не отменяет остальные, но занятую комнату надо освободить
      try {
        const handle = await tasks.trigger('generate-concept', {
          roomId: room.id,
          batchId,
          count: APARTMENT_COUNT,
        })
        await attachGenerationRun(room.id, handle.id, batchId)
        started += 1
      } catch (error) {
        console.error('комната не запустилась', room.id, error)
        await clearGenerationRun(room.id).catch(() => undefined)
      }
    }
    if (started === 0) {
      return {
        ok: false,
        error: throttled
          ? 'Сегодня уже много генераций. Попробуйте через час.'
          : 'Все эти комнаты уже считаются. Дождитесь их.',
      }
    }
    await recordAudit({
      action: 'concepts.requested',
      actorId: userId,
      targetType: 'project',
      targetId: projectId,
      metadata: { apartment: true, rooms: started, asked: ready.length },
    })
    revalidatePath(`/projects/${projectId}`)
    return { ok: true, data: { started, asked: ready.length } }
  } catch (error) {
    return failure(error)
  }
}

/**
 * План правки словами, без единого потраченного цента.
 *
 * Рисующая модель не переносит предметы и не додумывает намерений, поэтому одну фразу человека
 * надо разложить на однозначные команды. Человек видит их до запуска и понимает, за что платит.
 */
export async function planConceptEdit(
  conceptId: string,
  input: unknown,
): Promise<ActionResult<EditPlan>> {
  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  const parsed = conceptEditSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Проверьте текст правки' }
  }
  try {
    await conceptsRepository.getConceptForEdit(userId, conceptId)
    const plan = await buildEditPlan(getEnv().FAL_KEY, parsed.data.request)
    return { ok: true, data: plan }
  } catch (error) {
    return failure(error)
  }
}

/**
 * Правка одного варианта: «вот этот, но шкаф под окном».
 *
 * Основой берётся готовый рендер, а не фотография комнаты. Раньше любая правка уходила
 * на фото, и вместо понравившегося варианта с одним изменением человек получал пять других комнат.
 */
export async function reviseConcept(
  conceptId: string,
  input: unknown,
): Promise<ActionResult<ConceptRun>> {
  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  const parsed = conceptEditSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Проверьте текст правки' }
  }
  try {
    const concept = await conceptsRepository.getConceptForEdit(userId, conceptId)
    const plan = await buildEditPlan(getEnv().FAL_KEY, parsed.data.request)
    if (plan.steps.length === 0) {
      return { ok: false, error: plan.warningRu || 'Такую правку сделать не получится.' }
    }
    return await requestConcepts(concept.roomId, {
      baseConceptId: concept.id,
      editRequest: parsed.data.request,
      editSteps: plan.steps.map((step) => ({ titleRu: step.titleRu, prompt: step.prompt })),
      ...(parsed.data.objectId ? { objectId: parsed.data.objectId } : {}),
    })
  } catch (error) {
    return failure(error)
  }
}

export async function setConceptLike(conceptId: string, liked: boolean): Promise<ActionResult> {
  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  try {
    const { roomId, projectId } = await conceptsRepository.setConceptLike(userId, conceptId, liked)
    await bumpProjectVersion(projectId).catch((error) => console.error('live version', error))
    revalidatePath(`/projects/${projectId}/rooms/${roomId}`)
    return { ok: true, data: undefined }
  } catch (error) {
    return failure(error)
  }
}

/** Предложение вариантов на двоих: видят оба, считается один раз на набор отметок */
export async function loadDuoProposal(roomId: string): Promise<ActionResult<DuoProposal>> {
  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  try {
    const offer = await getDuoOffer(userId, roomId)
    if (!offer.proposal) {
      return {
        ok: false,
        error: 'Пока рано: нужны отметки обоих по десяти концептам без совпадений.',
      }
    }
    return { ok: true, data: offer.proposal }
  } catch (error) {
    return failure(error)
  }
}

/** Три рендера на пересечении вкусов: запускает только владелец, платит он же */
export async function requestDuoConcepts(roomId: string): Promise<ActionResult<ConceptRun>> {
  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  const env = getEnv()
  if (!env.FAL_KEY || !env.TRIGGER_SECRET_KEY) {
    return { ok: false, error: NO_KEYS }
  }
  try {
    const room = await getRoom(userId, roomId)
    requireOwner(room.role)
    const offer = await getDuoOffer(userId, room.id)
    if (!offer.proposal) {
      return { ok: false, error: 'Предложение устарело: отметки изменились. Обновите страницу.' }
    }
    const { success } = await getConceptsByUserLimiter().limit(userId)
    if (!success) {
      return { ok: false, error: 'Сегодня уже много генераций. Попробуйте через час.' }
    }
    const batchId = randomUUID()
    const handle = await tasks.trigger('generate-concept', {
      roomId: room.id,
      batchId,
      count: offer.proposal.bridges.length,
      duo: { variations: offer.proposal.bridges },
    })
    await recordAudit({
      action: 'concepts.requested',
      actorId: userId,
      targetType: 'room',
      targetId: room.id,
      metadata: { batchId, runId: handle.id, kind: 'duo', hash: offer.hash },
    })
    await bumpProjectVersion(room.projectId).catch((error) => console.error('live version', error))
    const accessToken =
      handle.publicAccessToken ??
      (await triggerAuth.createPublicToken({ scopes: { read: { runs: [handle.id] } } }))
    return { ok: true, data: { runId: handle.id, accessToken, batchId } }
  } catch (error) {
    return failure(error)
  }
}

/**
 * Идёт ли генерация по мнению сервера. Панель спрашивает это, пока ждёт: поток событий из
 * очереди умеет замолчать без единой ошибки, и тогда экран ожидания висел бы поверх
 * готовых концептов.
 */
export async function checkGeneration(roomId: string): Promise<ActionResult<{ running: boolean }>> {
  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  try {
    const room = await getRoom(userId, roomId)
    return { ok: true, data: { running: await generationStillRunning(room) } }
  } catch (error) {
    return failure(error)
  }
}

export async function refreshConcepts(roomId: string): Promise<ActionResult<{ pending: number }>> {
  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  try {
    const room = await getRoom(userId, roomId)
    const pending = await conceptsRepository.countPending(userId, room.id)
    // Зовётся, когда ожидание кончилось: снимаем отметку, иначе обновление страницы
    // показало бы экран ожидания заново
    await clearGenerationRun(room.id)
    revalidatePath(`/projects/${room.projectId}/rooms/${room.id}`)
    return { ok: true, data: { pending } }
  } catch (error) {
    return failure(error)
  }
}
