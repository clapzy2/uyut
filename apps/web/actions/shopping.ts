'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { recordAudit } from '@/lib/audit'
import { AccessError } from '@/lib/projects/access'
import { updateRoom } from '@/lib/projects/repository'
import { getSession } from '@/lib/session'
import {
  addShoppingItem,
  getShoppingList,
  removeShoppingItem,
  type ShoppingListView,
  setShoppingItemOperationClearance,
  setShoppingItemPlacement,
  setShoppingItemQuantity,
  setShoppingItemSize,
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
  if (error instanceof AccessError) {
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

/** Одна сторона товара в сантиметрах: пустое поле стирает вписанное и возвращает карточку магазина */
const sideSchema = z
  .string()
  .trim()
  .transform((value, ctx): number | null => {
    const normalized = value.replace(',', '.')
    if (normalized === '') {
      return null
    }
    const number = Number(normalized)
    if (!Number.isFinite(number) || number < 5 || number > 500) {
      ctx.addIssue({ code: 'custom', message: 'От 5 до 500 см' })
      return null
    }
    return Math.round(number)
  })

const itemSizeSchema = z
  .object({
    width: sideSchema,
    depth: sideSchema,
    height: sideSchema,
  })
  // Пустая форма раньше отвечала «размеры записаны» и не меняла ничего: успех без результата
  .refine((size) => size.width !== null || size.depth !== null || size.height !== null, {
    error: 'Впишите хотя бы ширину: без неё считать нечего',
  })

/**
 * Размеры товара со слов человека.
 *
 * В фиде их часто нет: у диванов габариты нашлись у одного товара из четырёхсот шестидесяти двух.
 * Без них вид сверху молчит про самый крупный предмет комнаты, а переписать два числа с карточки
 * магазина — пять секунд.
 */
export async function setItemSize(itemId: string, input: unknown): Promise<ActionResult> {
  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  const parsed = itemSizeSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Проверьте размеры' }
  }
  try {
    const result = await setShoppingItemSize(userId, itemId, {
      ...(parsed.data.width === null ? {} : { width: parsed.data.width }),
      ...(parsed.data.depth === null ? {} : { depth: parsed.data.depth }),
      ...(parsed.data.height === null ? {} : { height: parsed.data.height }),
    })
    await recordAudit({
      action: 'shopping.item_updated',
      actorId: userId,
      targetType: 'shopping_list_item',
      targetId: itemId,
      metadata: { projectId: result.projectId, size: parsed.data },
    })
    revalidateProject(result.projectId)
    return { ok: true, data: undefined }
  } catch (error) {
    return failure(error)
  }
}

const operationClearanceSchema = z
  .object({
    front: sideSchema,
    side: sideSchema,
    around: sideSchema,
  })
  .refine(
    (clearance) => clearance.front !== null || clearance.side !== null || clearance.around !== null,
    { error: 'Впишите хотя бы один точный запас' },
  )

/** Сохраняет только измеренный запас; сервис не маскирует отсутствие данных типовым числом. */
export async function setItemOperationClearance(
  itemId: string,
  input: unknown,
): Promise<ActionResult> {
  const userId = await currentUserId()
  if (!userId) return { ok: false, error: SESSION_EXPIRED }
  const parsed = operationClearanceSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Проверьте рабочую зону' }
  }
  try {
    const result = await setShoppingItemOperationClearance(userId, itemId, {
      ...(parsed.data.front === null ? {} : { front: parsed.data.front }),
      ...(parsed.data.side === null ? {} : { side: parsed.data.side }),
      ...(parsed.data.around === null ? {} : { around: parsed.data.around }),
    })
    await recordAudit({
      action: 'shopping.item_updated',
      actorId: userId,
      targetType: 'shopping_list_item',
      targetId: itemId,
      metadata: { projectId: result.projectId, operationClearance: parsed.data },
    })
    revalidateProject(result.projectId)
    return { ok: true, data: undefined }
  } catch (error) {
    return failure(error)
  }
}

const coordinateSchema = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const number = Number(value.replace(',', '.'))
    if (!Number.isFinite(number) || number < 0 || number > 10000) {
      ctx.addIssue({ code: 'custom', message: 'Координата должна быть от 0 до 10 000 см' })
      return z.NEVER
    }
    return Math.round(number)
  })

const itemPlacementSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('auto') }),
  z.object({
    mode: z.literal('exact'),
    xCm: coordinateSchema,
    yCm: coordinateSchema,
    rotation: z.enum(['0', '90']).transform((value) => (value === '90' ? 90 : 0) as 0 | 90),
    frontDirection: z.enum(['auto', 'up', 'right', 'down', 'left']).optional(),
  }),
])

/** Закрепляет товар на плане или возвращает его автоматическому раскладчику. */
export async function setItemPlacement(itemId: string, input: unknown): Promise<ActionResult> {
  const userId = await currentUserId()
  if (!userId) return { ok: false, error: SESSION_EXPIRED }
  const parsed = itemPlacementSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Проверьте координаты' }
  }
  try {
    const placement =
      parsed.data.mode === 'auto'
        ? null
        : {
            xCm: parsed.data.xCm,
            yCm: parsed.data.yCm,
            rotation: parsed.data.rotation,
            ...(parsed.data.frontDirection && parsed.data.frontDirection !== 'auto'
              ? { frontDirection: parsed.data.frontDirection }
              : {}),
          }
    const result = await setShoppingItemPlacement(userId, itemId, placement)
    await recordAudit({
      action: 'shopping.item_updated',
      actorId: userId,
      targetType: 'shopping_list_item',
      targetId: itemId,
      metadata: { projectId: result.projectId, placement },
    })
    revalidateProject(result.projectId)
    return { ok: true, data: undefined }
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
