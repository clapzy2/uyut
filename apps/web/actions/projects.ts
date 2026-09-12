'use server'

import { randomUUID } from 'node:crypto'
import type { PlanReading, RoomMeasurements } from '@uyut/db'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { recordAudit } from '@/lib/audit'
import { canCreateProject, PROJECT_LIMIT } from '@/lib/billing/repository'
import { preparePlan, UploadError } from '@/lib/files/uploads'
import { AccessError, assertOwner } from '@/lib/projects/access'
import { roomKindLabels } from '@/lib/projects/format'
import { PlanReadError, readPlanFromStorage } from '@/lib/projects/plan-reading'
import * as repository from '@/lib/projects/repository'
import { getSession } from '@/lib/session'
import { deleteObject, putObject } from '@/lib/storage'
import {
  createProjectSchema,
  planRoomsSchema,
  projectIdSchema,
  projectSettingsSchema,
} from '@/lib/validation/projects'

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string }

const SESSION_EXPIRED = 'Сессия закончилась. Войдите снова.'
const GENERIC = 'Не получилось. Попробуйте ещё раз, а если повторится, напишите нам.'

async function currentUserId(): Promise<string | null> {
  const session = await getSession()
  return session?.user.id ?? null
}

function failure(error: unknown): { ok: false; error: string } {
  if (
    error instanceof AccessError ||
    error instanceof UploadError ||
    error instanceof PlanReadError
  ) {
    return { ok: false, error: error.message }
  }
  console.error(error)
  return { ok: false, error: GENERIC }
}

export async function createProject(input: unknown): Promise<ActionResult<{ id: string }>> {
  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  const parsed = createProjectSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Проверьте поля формы' }
  }
  try {
    if (!(await canCreateProject(userId))) {
      return { ok: false, error: PROJECT_LIMIT }
    }
    const project = await repository.createProject(userId, parsed.data)
    await recordAudit({
      action: 'project.created',
      actorId: userId,
      targetType: 'project',
      targetId: project.id,
      headers: await headers(),
    })
    revalidatePath('/projects')
    return { ok: true, data: { id: project.id } }
  } catch (error) {
    return failure(error)
  }
}

export async function updateProject(projectId: string, input: unknown): Promise<ActionResult> {
  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  const id = projectIdSchema.safeParse(projectId)
  const parsed = projectSettingsSchema.safeParse(input)
  if (!id.success) {
    return { ok: false, error: 'Проект не найден' }
  }
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Проверьте поля формы' }
  }
  try {
    await repository.updateProject(userId, id.data, parsed.data)
    revalidatePath('/projects')
    revalidatePath(`/projects/${id.data}`)
    return { ok: true, data: undefined }
  } catch (error) {
    return failure(error)
  }
}

export async function deleteProject(projectId: string): Promise<ActionResult> {
  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  try {
    const { fileKeys } = await repository.deleteProject(userId, projectId)
    await Promise.all(fileKeys.map((key) => deleteObject(key).catch(() => undefined)))
    await recordAudit({
      action: 'project.deleted',
      actorId: userId,
      targetType: 'project',
      targetId: projectId,
      headers: await headers(),
    })
    revalidatePath('/projects')
    return { ok: true, data: undefined }
  } catch (error) {
    return failure(error)
  }
}

export async function uploadPlan(projectId: string, formData: FormData): Promise<ActionResult> {
  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  const file = formData.get('plan')
  if (!(file instanceof File)) {
    return { ok: false, error: 'Выберите файл с планом.' }
  }
  try {
    await assertOwner(userId, projectId)
    // Проверяем и пересобираем файл до записи в хранилище, чтобы туда не попало ничего сырого
    const prepared = await preparePlan(file)
    const key = `projects/${projectId}/plan/${randomUUID()}.${prepared.extension}`
    await putObject(key, prepared.body, prepared.contentType)
    const { previousKey } = await repository.setProjectPlan(userId, projectId, key)
    if (previousKey) {
      await deleteObject(previousKey).catch(() => undefined)
    }
    revalidatePath('/projects')
    revalidatePath(`/projects/${projectId}`)
    return { ok: true, data: undefined }
  } catch (error) {
    return failure(error)
  }
}

/**
 * Прочитать размеры с загруженного плана.
 *
 * Ничего не создаёт: прочитанное ложится в проект и ждёт правки. Модель читает чертёж хорошо,
 * но «хорошо» — не «всегда», а ошибка в размере тихо испортит и расстановку, и смету.
 * Поэтому между чтением и комнатами стоит человек.
 */
export async function readPlan(projectId: string): Promise<ActionResult<PlanReading>> {
  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  try {
    const project = await assertOwner(userId, projectId)
    if (!project.planUrl) {
      return { ok: false, error: 'Сначала загрузите план квартиры.' }
    }
    const parsed = await readPlanFromStorage(project.planUrl)
    const reading: PlanReading = { ...parsed, readAt: new Date().toISOString() }
    await repository.setPlanReading(userId, projectId, reading)
    await recordAudit({
      action: 'project.plan_read',
      actorId: userId,
      targetType: 'project',
      targetId: projectId,
      headers: await headers(),
      metadata: { rooms: reading.rooms.length },
    })
    revalidatePath(`/projects/${projectId}`)
    return { ok: true, data: reading }
  } catch (error) {
    return failure(error)
  }
}

/** Забыть прочитанное: человек посмотрел и решил вписать всё сам. */
export async function forgetPlanReading(projectId: string): Promise<ActionResult> {
  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  try {
    await repository.setPlanReading(userId, projectId, null)
    revalidatePath(`/projects/${projectId}`)
    return { ok: true, data: undefined }
  } catch (error) {
    return failure(error)
  }
}

/**
 * Подтвердить прочитанное: отмеченные строки становятся комнатами с размерами.
 *
 * Правку человека сохраняем вместе с комнатами: по разнице между прочитанным и подтверждённым
 * видно, где чтение промахивается, а спросить об этом больше некого.
 */
export async function confirmPlanRooms(
  projectId: string,
  input: unknown,
): Promise<ActionResult<{ created: number }>> {
  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  const parsed = planRoomsSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Проверьте размеры' }
  }
  const { ceilingCm, rooms } = parsed.data
  const chosen = rooms.filter((room) => room.include)
  if (chosen.length === 0) {
    return { ok: false, error: 'Отметьте хотя бы одну комнату.' }
  }
  try {
    const project = await assertOwner(userId, projectId)
    const reading: PlanReading = {
      ...(ceilingCm === null ? {} : { ceilingCm }),
      rooms: rooms.map((room) => ({
        name: room.name || roomKindLabels[room.kind],
        kind: room.kind,
        ...(room.widthCm === null ? {} : { widthCm: room.widthCm }),
        ...(room.depthCm === null ? {} : { depthCm: room.depthCm }),
        ...(room.areaM2 === null ? {} : { areaM2: room.areaM2 }),
      })),
      readAt: project.planReading?.readAt ?? new Date().toISOString(),
      confirmedAt: new Date().toISOString(),
    }
    const created = await repository.createRoomsFromPlan(userId, projectId, {
      reading,
      rooms: chosen.map((room) => {
        const measurements: RoomMeasurements = {
          ...(ceilingCm === null ? {} : { ceilingCm }),
          ...(room.widthCm === null ? {} : { widthCm: room.widthCm }),
          ...(room.depthCm === null ? {} : { depthCm: room.depthCm }),
        }
        return {
          kind: room.kind,
          name: room.name || roomKindLabels[room.kind],
          areaM2: room.areaM2,
          measurements: Object.keys(measurements).length > 0 ? measurements : null,
        }
      }),
    })
    await recordAudit({
      action: 'project.plan_rooms',
      actorId: userId,
      targetType: 'project',
      targetId: projectId,
      headers: await headers(),
      metadata: { created: created.length },
    })
    revalidatePath('/projects')
    revalidatePath(`/projects/${projectId}`)
    return { ok: true, data: { created: created.length } }
  } catch (error) {
    return failure(error)
  }
}
