import type { RoomMeasurements } from '@uyut/db'

export { hasCurrentVerification, measurementNotice } from '@uyut/catalog/measurement-assurance'

/** Импорт не переносит подтверждение старого замера на новые размеры с плана. */
export function mergePlanMeasurements(
  before: RoomMeasurements | null,
  read: RoomMeasurements | null,
): RoomMeasurements | null {
  const merged: RoomMeasurements = { ...(before ?? {}) }
  if (read?.layoutNotes !== undefined) merged.layoutNotes = read.layoutNotes
  if (read?.ceilingCm !== undefined) merged.ceilingCm = read.ceilingCm
  for (const key of ['widthCm', 'depthCm'] as const) {
    if (read?.[key] === undefined) continue
    merged[key] = read[key]
    const source = read.dimensionSources?.[key]
    merged.dimensionSources = {
      ...merged.dimensionSources,
      [key]: source?.valueCm === read[key] ? source : { valueCm: read[key], source: 'unknown' },
    }
    delete merged.verification
    delete merged.toleranceCm
    merged.finishStage = 'unknown'
  }
  return Object.keys(merged).length > 0 ? merged : null
}
