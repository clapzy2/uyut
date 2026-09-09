'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { recordAudit } from '@/lib/audit'
import { canCreateProject, PROJECT_LIMIT } from '@/lib/billing/repository'
import { preparePhoto, UploadError } from '@/lib/files/uploads'
import * as onboarding from '@/lib/onboarding/repository'
import { AccessError } from '@/lib/projects/access'
import { getSession } from '@/lib/session'
import { deleteObject, putObject } from '@/lib/storage'
import {
  apartmentSchema,
  budgetSchema,
  householdSchema,
  referenceLinkSchema,
  styleVotesSchema,
} from '@/lib/validation/onboarding'
import { projectIdSchema } from '@/lib/validation/projects'

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

function firstIssue(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message ?? 'Проверьте поля формы'
}

export async function createApartment(
  input: unknown,
): Promise<ActionResult<{ projectId: string }>> {
  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  const parsed = apartmentSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error) }
  }
  try {
    if (!(await canCreateProject(userId))) {
      return { ok: false, error: PROJECT_LIMIT }
    }
    const { project } = await onboarding.createFromApartment(userId, parsed.data)
    await recordAudit({ action: 'project.created', actorId: userId, targetId: project.id })
    revalidatePath('/projects')
    return { ok: true, data: { projectId: project.id } }
  } catch (error) {
    return failure(error)
  }
}

export async function saveHousehold(projectId: string, input: unknown): Promise<ActionResult> {
  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  const id = projectIdSchema.safeParse(projectId)
  const parsed = householdSchema.safeParse(input)
  if (!id.success) {
    return { ok: false, error: 'Проект не найден' }
  }
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error) }
  }
  try {
    await onboarding.saveHousehold(userId, id.data, parsed.data)
    return { ok: true, data: undefined }
  } catch (error) {
    return failure(error)
  }
}

export async function saveBudget(projectId: string, input: unknown): Promise<ActionResult> {
  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  const id = projectIdSchema.safeParse(projectId)
  const parsed = budgetSchema.safeParse(input)
  if (!id.success) {
    return { ok: false, error: 'Проект не найден' }
  }
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error) }
  }
  try {
    await onboarding.saveBudget(userId, id.data, parsed.data)
    return { ok: true, data: undefined }
  } catch (error) {
    return failure(error)
  }
}

export async function saveStyleVotes(
  projectId: string,
  input: unknown,
): Promise<ActionResult<{ likedCount: number }>> {
  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  const id = projectIdSchema.safeParse(projectId)
  const parsed = styleVotesSchema.safeParse(input)
  if (!id.success) {
    return { ok: false, error: 'Проект не найден' }
  }
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error) }
  }
  try {
    const { likedCount } = await onboarding.saveStyleVotes(userId, id.data, parsed.data.votes)
    return { ok: true, data: { likedCount } }
  } catch (error) {
    return failure(error)
  }
}

export async function saveReferenceLink(
  projectId: string,
  input: unknown,
): Promise<ActionResult<{ saved: boolean }>> {
  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  const id = projectIdSchema.safeParse(projectId)
  const parsed = referenceLinkSchema.safeParse(input)
  if (!id.success) {
    return { ok: false, error: 'Проект не найден' }
  }
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error) }
  }
  if (parsed.data.url === '') {
    return { ok: true, data: { saved: false } }
  }
  try {
    const file = await fetchReferenceImage(parsed.data.url)
    if (!file) {
      return {
        ok: false,
        error: 'По ссылке не нашлась картинка. Скачайте её и загрузите файлом.',
      }
    }
    await storeReference(userId, id.data, file)
    return { ok: true, data: { saved: true } }
  } catch (error) {
    return failure(error)
  }
}

export async function uploadReference(
  projectId: string,
  formData: FormData,
): Promise<ActionResult> {
  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  const id = projectIdSchema.safeParse(projectId)
  if (!id.success) {
    return { ok: false, error: 'Проект не найден' }
  }
  const file = formData.get('reference')
  if (!(file instanceof File)) {
    return { ok: false, error: 'Выберите файл с картинкой.' }
  }
  try {
    await storeReference(userId, id.data, file)
    return { ok: true, data: undefined }
  } catch (error) {
    return failure(error)
  }
}

export async function finishOnboarding(projectId: string): Promise<ActionResult> {
  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  const id = projectIdSchema.safeParse(projectId)
  if (!id.success) {
    return { ok: false, error: 'Проект не найден' }
  }
  try {
    await onboarding.completeOnboarding(userId, id.data)
    await recordAudit({ action: 'onboarding.completed', actorId: userId, targetId: id.data })
    revalidatePath('/projects')
    revalidatePath(`/projects/${id.data}`)
    return { ok: true, data: undefined }
  } catch (error) {
    return failure(error)
  }
}

async function storeReference(userId: string, projectId: string, file: File): Promise<void> {
  const prepared = await preparePhoto(file)
  const key = `projects/${projectId}/reference/${randomUUID()}.${prepared.extension}`
  await putObject(key, prepared.body, prepared.contentType)
  const { previousKey } = await onboarding.saveReference(userId, projectId, key)
  if (previousKey) {
    await deleteObject(previousKey).catch(() => undefined)
  }
}

const REFERENCE_LIMIT_BYTES = 10 * 1024 * 1024

/**
 * Прямая ссылка на картинку скачивается как есть, страница Pinterest — через og:image.
 * Pinterest защищается от серверных запросов, поэтому неудача здесь ожидаема и не считается ошибкой.
 */
async function fetchReferenceImage(url: string): Promise<File | null> {
  const direct = await downloadImage(url)
  if (direct) {
    return direct
  }
  try {
    const page = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; DomitsaBot/1.0)' },
      signal: AbortSignal.timeout(8000),
    })
    if (!page.ok) {
      return null
    }
    const html = (await page.text()).slice(0, 200_000)
    const match =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
    const found = match?.[1]
    return found ? await downloadImage(found) : null
  } catch {
    return null
  }
}

async function downloadImage(url: string): Promise<File | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) })
    const type = response.headers.get('content-type') ?? ''
    if (!response.ok || !type.startsWith('image/')) {
      return null
    }
    const bytes = await response.arrayBuffer()
    if (bytes.byteLength === 0 || bytes.byteLength > REFERENCE_LIMIT_BYTES) {
      return null
    }
    return new File([bytes], 'reference', { type })
  } catch {
    return null
  }
}
