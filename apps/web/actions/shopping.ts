'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { recordAudit } from '@/lib/audit'
import { NotFoundError } from '@/lib/projects/access'
import { updateRoom } from '@/lib/projects/repository'
import { getSession } from '@/lib/session'
import {
  addShoppingItem,
  getShoppingList,
  removeShoppingItem,
  type ShoppingListView,
  setShoppingItemQuantity,
} from '@/lib/shopping/repository'

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string }

const SESSION_EXPIRED = 'Сессия закончилась. Войдите снова.'
const GENERIC = 'Не получилось. Попробуйте ещё раз, а если повторится, напишите нам.'

const addItemSchema = z.object({
  projectId: z.uuid(),
  catalogItemId: z.uuid(),
  roomId: z.uuid().nullish(),
  conceptObjectId: z.uuid().nullish(),
  quantity: z.number().int().min(1).max(99).default(1),
  variant: z
    .object({
      color: z.string().max(80).optional(),
      priceKopecks: z.number().int().nonnegative().optional(),
      affiliateUrl: z.url().optional(),
      swatchId: z.string().max(40).optional(),
    })
    .nullish(),
})

export type AddItemInput = z.input<typeof addItemSchema>

async function currentUserId(): Promise<string | null> {
  const session = await getSession()
  return session?.user.id ?? null
}

function failure(error: unknown): { ok: false; error: string } {
  if (error instanceof NotFoundError) {
    return { ok: false, error: error.message }
  }
  console.error(error)
  return { ok: false, error: GENERIC }
}

function revalidateProject(projectId: string): void {
  revalidatePath(`/projects/${projectId}`)
  revalidatePath(`/projects/${projectId}/summary`)
}

export async function loadShoppingList(projectId: string): Promise<ActionResult<ShoppingListView>> {
  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  try {
    return { ok: true, data: await getShoppingList(userId, projectId) }
  } catch (error) {
    return failure(error)
  }
}

export async function addItem(
  input: AddItemInput,
): Promise<ActionResult<{ itemId: string; quantity: number }>> {
  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  const parsed = addItemSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: 'Не удалось добавить товар: данные не прошли проверку.' }
  }
  try {
    const result = await addShoppingItem(userId, parsed.data)
    await recordAudit({
      action: 'shopping.item_added',
      actorId: userId,
      targetType: 'shopping_list_item',
      targetId: result.itemId,
      metadata: {
        projectId: parsed.data.projectId,
        catalogItemId: parsed.data.catalogItemId,
        quantity: result.quantity,
      },
    })
    revalidateProject(parsed.data.projectId)
    return { ok: true, data: result }
  } catch (error) {
    return failure(error)
  }
}

export async function setItemQuantity(
  itemId: string,
  quantity: number,
): Promise<ActionResult<{ quantity: number }>> {
  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  if (!Number.isFinite(quantity)) {
    return { ok: false, error: 'Количество должно быть числом.' }
  }
  try {
    const result = await setShoppingItemQuantity(userId, itemId, quantity)
    await recordAudit({
      action: result.quantity === 0 ? 'shopping.item_removed' : 'shopping.item_updated',
      actorId: userId,
      targetType: 'shopping_list_item',
      targetId: itemId,
      metadata: { projectId: result.projectId, quantity: result.quantity },
    })
    revalidateProject(result.projectId)
    return { ok: true, data: { quantity: result.quantity } }
  } catch (error) {
    return failure(error)
  }
}

export async function removeItem(itemId: string): Promise<ActionResult> {
  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  try {
    const result = await removeShoppingItem(userId, itemId)
    await recordAudit({
      action: 'shopping.item_removed',
      actorId: userId,
      targetType: 'shopping_list_item',
      targetId: itemId,
      metadata: { projectId: result.projectId, catalogItemId: result.catalogItemId },
    })
    revalidateProject(result.projectId)
    return { ok: true, data: undefined }
  } catch (error) {
    return failure(error)
  }
}

/** Переключатель «обновить отделку» в смете для комнаты с готовым ремонтом */
export async function setRoomRefreshFinish(roomId: string, value: boolean): Promise<ActionResult> {
  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  try {
    const room = await updateRoom(userId, roomId, { refreshFinish: value })
    revalidateProject(room.projectId)
    return { ok: true, data: undefined }
  } catch (error) {
    return failure(error)
  }
}
