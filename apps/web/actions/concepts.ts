'use server'

import { randomUUID } from 'node:crypto'
import { ApiError, tasks, auth as triggerAuth } from '@trigger.dev/sdk'
import { buildEditPlan, type DuoProposal, type EditPlan } from '@uyut/ai'
import { revalidatePath } from 'next/cache'
import { recordAudit } from '@/lib/audit'
import { bumpProjectVersion } from '@/lib/collaboration/live'
import { APARTMENT_COUNT, apartmentPlan } from '@/lib/concepts/apartment'
import { getDuoOffer } from '@/lib/concepts/duo'
import * as conceptsRepository from '@/lib/concepts/repository'
import {
  GenerationStatusUnknownError,
  generationRunTag,
  generationStillRunning,
} from '@/lib/concepts/resume-run'
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

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; checkStatus?: boolean }

const SESSION_EXPIRED = 'Сессия закончилась. Войдите снова.'
const GENERIC = 'Не получилось. Попробуйте ещё раз, а если повторится, напишите нам.'
const NO_KEYS = 'Генерация пока не подключена: в настройках сервиса нет ключей.'

export type ConceptRun = { runId: string; accessToken: string; batchId: string }

async function currentUserId(): Promise<string | null> {
  const session = await getSession()
  return session?.user.id ?? null
}

function failure(error: unknown): { ok: false; error: string; checkStatus?: boolean } {
  if (error instanceof GenerationStatusUnknownError) {
    return { ok: false, error: error.message, checkStatus: true }
  }
  if (error instanceof AccessError) {
    return { ok: false, error: error.message }
  }
  console.error(error)
  return { ok: false, error: GENERIC }
}

async function allowGeneration(userId: string, roomId: string, batchId: string): Promise<boolean> {
  try {
    const { success } = await getConceptsByUserLimiter().limit(userId)
    if (!success) await clearGenerationRun(roomId, `pending:${batchId}`)
    return success
  } catch (error) {
    // До обращения к очереди точно ничего не отправлено.
    await clearGenerationRun(roomId, `pending:${batchId}`)
    throw error
  }
}

async function enqueueConcepts(
  payload: { roomId: string; batchId: string; count: number } & Record<string, unknown>,
) {
  try {
    return await tasks.trigger(
      'generate-concept',
      payload,
      { idempotencyKey: payload.batchId, tags: [generationRunTag(payload.batchId)] },
      { retry: { maxAttempts: 1 } },
    )
  } catch (error) {
    // HTTP-отказ самого API однозначен. Timeout, сбой сети или 5xx не доказывают,
    // что очередь не приняла запрос: сохраняем бронь и восстанавливаем по метке.
    if (error instanceof ApiError && [400, 401, 403, 404, 422, 429].includes(error.status ?? 0)) {
      await clearGenerationRun(payload.roomId, `pending:${payload.batchId}`)
      throw error
    }
    console.error('ответ о запуске не подтверждён', payload.roomId, error)
    throw new GenerationStatusUnknownError()
  }
}

async function runForClient(
  roomId: string,
  batchId: string,
  handle: Awaited<ReturnType<typeof tasks.trigger>>,
): Promise<ConceptRun> {
  try {
    await attachGenerationRun(roomId, handle.id, batchId)
    const accessToken =
      handle.publicAccessToken ??
      (await triggerAuth.createPublicToken({ scopes: { read: { runs: [handle.id] } } }))
    return { runId: handle.id, accessToken, batchId }
  } catch (error) {
    console.error('не удалось восстановить ожидание принятого запуска', roomId, error)
    throw new GenerationStatusUnknownError()
  }
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
  editSteps?: Array<{ titleRu: string; prompt: string; needsObject?: boolean }>
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
    const batchId = randomUUID()
    // Занимаем комнату до лимитера и внешней очереди. Две вкладки или двойной клик иначе
    // успевают отправить две платные задачи до того, как первая запишет свой runId.
    if (!(await claimRoomForGeneration(room.id, batchId))) {
      return {
        ok: false,
        error: 'Эта комната уже считается. Дождитесь готовых вариантов.',
        checkStatus: true,
      }
    }
    if (!(await allowGeneration(userId, room.id, batchId))) {
      return { ok: false, error: 'Сегодня уже много генераций. Попробуйте через час.' }
    }
    const handle = await enqueueConcepts({
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
    const run = await runForClient(room.id, batchId, handle)
    await recordAudit({
      action: 'concepts.requested',
      actorId: userId,
      targetType: 'room',
      targetId: room.id,
      metadata: { batchId, runId: handle.id, ...(baseConceptId ? { baseConceptId } : {}) },
    }).catch((error) => console.error('аудит запуска', room.id, error))
    return { ok: true, data: run }
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
): Promise<ActionResult<{ started: number; asked: number; notice?: string }>> {
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
    let uncertain = false
    let rejected = false
    for (const room of ready) {
      const batchId = randomUUID()
      if (!(await claimRoomForGeneration(room.id, batchId))) continue
      // Счётчик тратим по комнате, а не по нажатию: пять комнат — это пять генераций,
      // и общий предел должен считать их пятью, иначе он ничего не ограничивает
      if (!(await allowGeneration(userId, room.id, batchId))) {
        throttled = true
        break
      }
      let handle: Awaited<ReturnType<typeof tasks.trigger>> | null = null
      try {
        handle = await enqueueConcepts({
          roomId: room.id,
          batchId,
          count: APARTMENT_COUNT,
        })
      } catch (error) {
        console.error('комната не запустилась', room.id, error)
        if (error instanceof GenerationStatusUnknownError) uncertain = true
        else rejected = true
        continue
      }
      started += 1
      // Задание уже в очереди, и с этого момента комнату отпускать нельзя ни при какой ошибке:
      // упавшая запись отметки — повод потерять ожидание, а не повод заплатить второй раз
      await attachGenerationRun(room.id, handle.id, batchId).catch((error) =>
        console.error('отметка запуска не записалась', room.id, error),
      )
    }
    if (started === 0) {
      if (uncertain) return failure(new GenerationStatusUnknownError())
      return {
        ok: false,
        error: throttled
          ? 'Сегодня уже много генераций. Попробуйте через час.'
          : rejected
            ? 'Очередь не приняла запуск. Попробуйте позже; готовые варианты сохранены.'
            : 'Все эти комнаты уже считаются. Дождитесь их.',
      }
    }
    await recordAudit({
      action: 'concepts.requested',
      actorId: userId,
      targetType: 'project',
      targetId: projectId,
      metadata: { apartment: true, rooms: started, asked: ready.length },
    }).catch((error) => console.error('аудит запуска квартиры', projectId, error))
    revalidatePath(`/projects/${projectId}`)
    return {
      ok: true,
      data: {
        started,
        asked: ready.length,
        ...(started < ready.length
          ? {
              notice: uncertain
                ? 'По части комнат ответ очереди не подтверждён. Откройте их и проверьте статус.'
                : throttled
                  ? 'Для остальных комнат пока достигнут лимит генераций.'
                  : rejected
                    ? 'Часть запусков очередь не приняла. Готовые варианты сохранены.'
                    : 'Остальные комнаты уже считаются.',
            }
          : {}),
      },
    }
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
    // Приложить можно только предмет с этой же картинки: чужой id сюда не проходит
    const objectId =
      parsed.data.objectId &&
      (await conceptsRepository.conceptHasObject(concept.id, parsed.data.objectId))
        ? parsed.data.objectId
        : ''
    const plan = await buildEditPlan(getEnv().FAL_KEY, parsed.data.request)
    if (plan.steps.length === 0) {
      return { ok: false, error: plan.warningRu || 'Такую правку сделать не получится.' }
    }
    return await requestConcepts(concept.roomId, {
      baseConceptId: concept.id,
      editRequest: parsed.data.request,
      editSteps: plan.steps.map((step) => ({
        titleRu: step.titleRu,
        prompt: step.prompt,
        needsObject: step.needsObject,
      })),
      ...(objectId ? { objectId } : {}),
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
    const batchId = randomUUID()
    if (!(await claimRoomForGeneration(room.id, batchId))) {
      return {
        ok: false,
        error: 'Эта комната уже считается. Дождитесь готовых вариантов.',
        checkStatus: true,
      }
    }
    if (!(await allowGeneration(userId, room.id, batchId))) {
      return { ok: false, error: 'Сегодня уже много генераций. Попробуйте через час.' }
    }
    const handle = await enqueueConcepts({
      roomId: room.id,
      batchId,
      count: offer.proposal.bridges.length,
      duo: { variations: offer.proposal.bridges },
    })
    const run = await runForClient(room.id, batchId, handle)
    await recordAudit({
      action: 'concepts.requested',
      actorId: userId,
      targetType: 'room',
      targetId: room.id,
      metadata: { batchId, runId: handle.id, kind: 'duo', hash: offer.hash },
    }).catch((error) => console.error('аудит запуска на двоих', room.id, error))
    await bumpProjectVersion(room.projectId).catch((error) => console.error('live version', error))
    return { ok: true, data: run }
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
    const running = await generationStillRunning(room)
    const pending = await conceptsRepository.countPending(userId, room.id)
    revalidatePath(`/projects/${room.projectId}/rooms/${room.id}`)
    // Пока очередь активна, первые концепты могут ещё не существовать.
    return { ok: true, data: { pending: running ? Math.max(1, pending) : pending } }
  } catch (error) {
    return failure(error)
  }
}
