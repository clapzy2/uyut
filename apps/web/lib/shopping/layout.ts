import 'server-only'

import { type LayoutItem, layoutRoom, type RoomLayout, subcategoryFromText } from '@uyut/catalog'
import type { RoomMeasurements } from '@uyut/db'
import { getShoppingList } from './repository'

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
  measurements: RoomMeasurements | null,
): Promise<RoomLayout | null> {
  if (!measurements?.widthCm || !measurements.depthCm) {
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
  return layoutRoom({ widthCm: measurements.widthCm, depthCm: measurements.depthCm }, items)
}
