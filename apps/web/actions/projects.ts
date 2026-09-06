'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { recordAudit } from '@/lib/audit'
import { preparePlan, UploadError } from '@/lib/files/uploads'
import { NotFoundError } from '@/lib/projects/access'
import * as repository from '@/lib/projects/repository'
import { getSession } from '@/lib/session'
import { deleteObject, putObject } from '@/lib/storage'
import {
  createProjectSchema,
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
  if (error instanceof NotFoundError || error instanceof UploadError) {
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
