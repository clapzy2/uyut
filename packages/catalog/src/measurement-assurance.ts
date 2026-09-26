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
    return 'Подтвердите ширину и глубину замером, чтобы уточнить размещение мебели. Пока расстановка предварительная.'
  if (measurements?.finishStage === 'before')
    return 'Вы подтвердили замер до отделки. После отделки сделайте повторный замер: свободное пространство может уменьшиться.'
  return `Вы подтвердили ширину и глубину после отделки, погрешность ±${measurements?.toleranceCm} см. Проёмы, доставку и монтаж сверяйте отдельно.`
}
