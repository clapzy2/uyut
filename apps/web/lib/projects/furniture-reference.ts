import { type RoomFurnitureReference, rooms } from '@uyut/db'
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { AccessError, requireOwner } from './access'
import { getRoom } from './repository'

/** Смена образца не должна затирать одновременную загрузку в другой вкладке. */
export async function saveFurnitureReference(
  userId: string,
  roomId: string,
  expectedPhotoRevision: number,
  reference: RoomFurnitureReference | null,
  expectedKey: string | null,
): Promise<{ previousKey: string | null }> {
  const room = await getRoom(userId, roomId)
  requireOwner(room.role)
  if (
    !Number.isSafeInteger(expectedPhotoRevision) ||
    expectedPhotoRevision < 0 ||
    (reference &&
      (reference.photoRevision !== expectedPhotoRevision ||
        !reference.key.startsWith(
          `projects/${room.projectId}/rooms/${room.id}/furniture-references/`,
        ) ||
        !/^[a-zA-Z0-9-]+\.webp$/.test(reference.key.split('/').at(-1) ?? '') ||
        reference.key.split('/').length !== 6))
  ) {
    throw new AccessError('Образец не относится к текущему фото комнаты.')
  }
  const updated = await getDb()
    .update(rooms)
    .set({ furnitureReference: reference })
    .where(
      and(
        eq(rooms.id, room.id),
        eq(rooms.projectId, room.projectId),
        eq(rooms.photoRevision, expectedPhotoRevision),
        isNotNull(rooms.photoUrl),
        eq(rooms.condition, 'keep'),
        isNull(rooms.generationRunId),
        sql`${rooms.furnitureReference}->>'key' is not distinct from ${expectedKey}`,
      ),
    )
    .returning({ id: rooms.id })
  if (updated.length === 0) {
    throw new AccessError(
      'Образец не изменён: фото или предмет уже обновлены либо идёт генерация. Обновите страницу.',
    )
  }
  return { previousKey: expectedKey }
}
