import type { RoomMeasurements } from '@uyut/db'

export function hasCurrentVerification(measurements: RoomMeasurements | null): boolean {
  const saved = measurements?.verification
  return Boolean(
    saved &&
      measurements &&
      Number.isFinite(saved.widthCm) &&
      saved.widthCm > 0 &&
      Number.isFinite(saved.depthCm) &&
      saved.depthCm > 0 &&
      Number.isFinite(saved.toleranceCm) &&
      saved.toleranceCm > 0 &&
      saved.toleranceCm < Math.min(saved.widthCm, saved.depthCm) &&
      (saved.finishStage === 'before' || saved.finishStage === 'after') &&
      saved.widthCm === measurements.widthCm &&
      saved.depthCm === measurements.depthCm &&
      saved.finishStage === measurements.finishStage &&
      saved.toleranceCm === measurements.toleranceCm &&
      Number.isFinite(Date.parse(saved.confirmedAt)),
  )
}

export function measurementNotice(measurements: RoomMeasurements | null): string {
  if (!hasCurrentVerification(measurements))
    return 'Ширина и глубина не подтверждены замером. Расстановка предварительная.'
  if (measurements?.finishStage === 'before')
    return 'Замеры подтверждены пользователем до отделки. После отделки свободное пространство уменьшится — требуется повторный замер.'
  return `Ширина и глубина подтверждены пользователем после отделки, погрешность ±${measurements?.toleranceCm} см. Это не проверка проёмов, монтажа или всего проекта специалистом.`
}

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
