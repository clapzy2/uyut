/** Старые записи без ревизии относятся к исходному фото комнаты (ревизия 0). */
export function isFromPreviousPhoto(
  currentRevision: number,
  sourceRevision: number | null,
): boolean {
  return currentRevision > 0 && (sourceRevision ?? 0) < currentRevision
}

/** Связь товара с вариантом позволяет заметить смену фото уже после выбора товара. */
export function shoppingItemsFromPreviousPhoto(
  items: readonly { id: string; conceptObjectId: string | null }[],
  objectConcepts: readonly { id: string; conceptId: string }[],
  concepts: readonly {
    id: string
    roomId: string
    sourcePhotoRevision: number | null
  }[],
  rooms: readonly { id: string; photoRevision: number }[],
): string[] {
  const conceptByObject = new Map(objectConcepts.map((object) => [object.id, object.conceptId]))
  const conceptsById = new Map(concepts.map((concept) => [concept.id, concept]))
  const roomsById = new Map(rooms.map((room) => [room.id, room]))

  return items.flatMap((item) => {
    const conceptId = item.conceptObjectId && conceptByObject.get(item.conceptObjectId)
    const concept = conceptId ? conceptsById.get(conceptId) : undefined
    const room = concept ? roomsById.get(concept.roomId) : undefined
    return room && concept && isFromPreviousPhoto(room.photoRevision, concept.sourcePhotoRevision)
      ? [item.id]
      : []
  })
}
