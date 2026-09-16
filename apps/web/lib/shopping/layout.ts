import 'server-only'

import { type LayoutItem, type RoomLayout, subcategoryFromText } from '@uyut/catalog'
import type { PlanGeometry, Room, RoomMeasurements } from '@uyut/db'
import { layoutWithMeasurements } from '@/lib/projects/layout-with-measurements'
import { getShoppingList, type ShoppingItemView } from './repository'

/**
 * Вид сверху для одной комнаты: что человек уже выбрал, разложенное по её настоящим размерам.
 *
 * Считается на лету из списка покупок, а не хранится. Список меняется чаще, чем на него смотрят,
 * и сохранённая расстановка устаревала бы молча — а молча устаревший ответ «влезет» хуже,
 * чем никакого.
 */
export async function roomLayout(
  userId: string,
  projectId: string,
  roomId: string,
  roomName: string,
  measurements: RoomMeasurements | null,
  geometry?: PlanGeometry,
  roomKind?: Room['kind'],
): Promise<RoomLayout | null> {
  const list = await getShoppingList(userId, projectId)
  const items: LayoutItem[] = list.items
    .filter((item) => item.roomId === roomId)
    .map((item) => ({
      id: item.id,
      title: item.title,
      category: item.category,
      subcategory: subcategoryFromText(item.category, item.title),
      dimensions: item.dimensionsCm,
      operationClearance: item.operationClearanceCm,
      placement: item.placementCm,
      quantity: item.quantity,
    }))
  if (items.length === 0) {
    return null
  }
  return layoutWithMeasurements(roomName, measurements, geometry, items, roomKind)
}

/**
 * Раскладки всех комнат проекта по уже прочитанному списку покупок.
 *
 * Список принимается аргументом, а не читается здесь: страница итогов и так его загружает,
 * и второе чтение стоило бы ещё сотни подписанных ссылок на картинки товаров.
 */
export function projectLayouts(
  rooms: readonly Room[],
  list: { items: readonly ShoppingItemView[] },
  geometry?: PlanGeometry,
): Array<{ roomId: string; roomName: string; layout: RoomLayout }> {
  const result: Array<{ roomId: string; roomName: string; layout: RoomLayout }> = []
  for (const room of rooms) {
    const items: LayoutItem[] = list.items
      .filter((item) => item.roomId === room.id)
      .map((item) => ({
        id: item.id,
        title: item.title,
        category: item.category,
        subcategory: subcategoryFromText(item.category, item.title),
        dimensions: item.dimensionsCm,
        operationClearance: item.operationClearanceCm,
        placement: item.placementCm,
        quantity: item.quantity,
      }))
    if (items.length === 0) {
      continue
    }
    const layout = layoutWithMeasurements(room.name, room.measurements, geometry, items, room.kind)
    if (!layout) continue
    result.push({
      roomId: room.id,
      roomName: room.name,
      layout,
    })
  }
  return result
}
