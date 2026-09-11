import { nearestStyles } from '@uyut/ai'
import { catalogItems, conceptObjects, concepts, rooms } from '@uyut/db'
import { and, asc, desc, eq } from 'drizzle-orm'
import { categoryLabels, formatPrice } from '@/lib/concepts/format'
import { getDb } from '@/lib/db'
import { assertOwnerOrCollaborator } from '@/lib/projects/access'
import { formatArea, roomConditionShort, roomKindLabels } from '@/lib/projects/format'

export type ChatScope = { projectId: string; roomId?: string | null; conceptId?: string | null }

function shorten(text: string | null | undefined, max = 280): string {
  if (!text) {
    return ''
  }
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/**
 * Данные проекта для инструкции помощника: только то, что есть в базе, по-русски, компактно.
 * Если чат открыт со страницы комнаты или концепта, они описаны подробнее и помечены как текущие.
 */
export async function buildProjectContext(userId: string, scope: ChatScope): Promise<string> {
  const db = getDb()
  const project = await assertOwnerOrCollaborator(userId, scope.projectId)
  const roomList = await db
    .select()
    .from(rooms)
    .where(eq(rooms.projectId, project.id))
    .orderBy(asc(rooms.orderIndex))

  const styles = nearestStyles(project.styleReferenceEmbedding ?? [], 3)
  const household = project.household
  const lines: string[] = [
    `Проект «${project.title}» (id ${project.id}).`,
    project.totalAreaM2 ? `Площадь квартиры ${formatArea(project.totalAreaM2)}.` : '',
    styles.length > 0
      ? `Стиль по лайкам: ${styles.map((style) => style.ru).join(', ')} (ведущий первый).`
      : 'Стиль ещё не выбран: онбординг не пройден.',
    household
      ? `Семья: взрослых ${household.adults ?? '?'}, детей ${household.kids ?? 0}, животные ${household.pets ? 'есть' : 'нет'}; готовят дома: ${household.cookHome ? 'да' : 'нет'}; гости: ${household.receiveGuests ? 'часто' : 'редко'}; работа из дома: ${household.wfh ? 'да' : 'нет'}.`
      : 'Про семью данных нет.',
    project.budgetKopecks
      ? `Бюджет на всю квартиру: ${formatPrice(project.budgetKopecks)}.`
      : 'Бюджет не указан.',
    '',
    'Комнаты:',
    ...roomList.map(
      (room) =>
        `- ${room.name} (id ${room.id}, ${roomKindLabels[room.kind].toLowerCase()}${room.areaM2 ? `, ${formatArea(room.areaM2)}` : ', площадь не указана'}, ${roomConditionShort[room.condition]}${room.photoUrl ? ', фото есть' : ', без фото'})${room.notes ? `. Заметки: ${shorten(room.notes, 200)}` : ''}${room.id === scope.roomId ? ' — ТЕКУЩАЯ КОМНАТА' : ''}`,
    ),
  ]

  const liked = await db
    .select({ concept: concepts, room: rooms })
    .from(concepts)
    .innerJoin(rooms, eq(rooms.id, concepts.roomId))
    .where(and(eq(rooms.projectId, project.id), eq(concepts.likedByOwner, true)))
    .orderBy(desc(concepts.createdAt))
    .limit(8)
  if (liked.length > 0) {
    lines.push('', 'Понравившиеся концепты:')
    for (const { concept, room } of liked) {
      lines.push(
        `- ${room.name}, концепт ${concept.orderIndex + 1} (id ${concept.id})${concept.note ? `: ${concept.note}` : ''}`,
      )
    }
  }

  if (scope.conceptId) {
    const [current] = await db
      .select({ concept: concepts, room: rooms })
      .from(concepts)
      .innerJoin(rooms, eq(rooms.id, concepts.roomId))
      .where(and(eq(concepts.id, scope.conceptId), eq(rooms.projectId, project.id)))
      .limit(1)
    if (current) {
      lines.push(
        '',
        `ТЕКУЩИЙ КОНЦЕПТ: ${current.room.name}, концепт ${current.concept.orderIndex + 1} (id ${current.concept.id}). Человек смотрит на него прямо сейчас.`,
        `Задание, по которому он нарисован: ${shorten(current.concept.prompt, 600)}`,
      )
      const objects = await db
        .select({ object: conceptObjects, item: catalogItems })
        .from(conceptObjects)
        .leftJoin(catalogItems, eq(catalogItems.id, conceptObjects.matchedCatalogItemId))
        .where(eq(conceptObjects.conceptId, current.concept.id))
        .orderBy(asc(conceptObjects.orderIndex))
      if (objects.length > 0) {
        lines.push('Предметы на рендере и лучшие совпадения в каталоге:')
        for (const { object, item } of objects) {
          lines.push(
            `- №${object.orderIndex + 1} ${categoryLabels[object.category]} (objectId ${object.id})${item ? `: ${item.title}, ${formatPrice(item.priceKopecks)}` : ': в каталоге пока ничего'}`,
          )
        }
      }
    }
  }

  return lines.filter((line) => line !== undefined).join('\n')
}
