import 'server-only'

import { type LayoutItem, layoutRoom, type RoomLayout, subcategoryFromText } from '@uyut/catalog'
import type { PlanGeometry, Room, RoomMeasurements } from '@uyut/db'
import { roomLayoutInputFromGeometry } from '@/lib/projects/room-geometry-layout'
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
): Promise<RoomLayout | null> {
  const geometryInput = roomLayoutInputFromGeometry(geometry, roomName, measurements)
  const layoutInput =
    geometryInput ??
    (measurements?.widthCm && measurements.depthCm
      ? {
          widthCm: measurements.widthCm,
          depthCm: measurements.depthCm,
          layoutNotes: measurements.layoutNotes,
        }
      : null)
  if (!layoutInput) {
    return null
  }
  const list = await getShoppingList(userId, projectId)
  const items: LayoutItem[] = list.items
    .filter((item) => item.roomId === roomId)
    .map((item) => ({
      id: item.id,
      title: item.title,
      category: item.category,
      subcategory: subcategoryFromText(item.category, item.title),
      dimensions: item.dimensionsCm,
      quantity: item.quantity,
    }))
  if (items.length === 0) {
    return null
  }
  return layoutRoom(layoutInput, items)
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
        quantity: item.quantity,
      }))
    if (items.length === 0) {
      continue
    }
    const geometryInput = roomLayoutInputFromGeometry(geometry, room.name, room.measurements)
    const measurements = room.measurements
    const layoutInput =
      geometryInput ??
      (measurements?.widthCm && measurements.depthCm
        ? {
            widthCm: measurements.widthCm,
            depthCm: measurements.depthCm,
            layoutNotes: measurements.layoutNotes,
          }
        : null)
    if (!layoutInput) continue
    result.push({
      roomId: room.id,
      roomName: room.name,
      layout: layoutRoom(layoutInput, items),
    })
  }
  return result
}
