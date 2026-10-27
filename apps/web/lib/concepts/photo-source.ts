/** Старые записи без ревизии относятся к исходному фото комнаты (ревизия 0). */
export function isFromPreviousPhoto(
  currentRevision: number,
  sourceRevision: number | null,
): boolean {
  return currentRevision > 0 && (sourceRevision ?? 0) < currentRevision
}
