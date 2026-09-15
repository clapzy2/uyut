import type { PlanRoomReading, RoomMeasurements } from '@uyut/db'
import { hasCurrentVerification } from './measurement-assurance'

type Dimensions = { name: string; kind: string; widthCm: number | null; depthCm: number | null }

/** Не доверяем меткам от клиента. Неоднозначное соответствие остаётся неизвестным. */
export function planDimensionSources(
  input: Dimensions,
  originals: readonly PlanRoomReading[],
  previouslySaved = false,
): NonNullable<RoomMeasurements['dimensionSources']> {
  const matches = originals.filter((room) => room.name === input.name && room.kind === input.kind)
  const original = matches.length === 1 ? matches[0] : undefined
  const result: NonNullable<RoomMeasurements['dimensionSources']> = {}
  for (const key of ['widthCm', 'depthCm'] as const) {
    const value = input[key]
    if (value === null) continue
    const previous = original?.dimensionSources?.[key]
    const source = !original
      ? 'unknown'
      : original[key] !== value
        ? 'entered'
        : previous?.valueCm === value
          ? previous.source
          : original.estimated?.includes(key === 'widthCm' ? 'width' : 'depth')
            ? 'estimated'
            : previouslySaved
              ? 'unknown'
              : 'plan'
    result[key] = { valueCm: value, source }
  }
  return result
}

export function editedDimensionSources(
  input: { widthCm: number | null; depthCm: number | null },
  before: RoomMeasurements | null,
): NonNullable<RoomMeasurements['dimensionSources']> {
  const result: NonNullable<RoomMeasurements['dimensionSources']> = {}
  for (const key of ['widthCm', 'depthCm'] as const) {
    const value = input[key]
    if (value === null) continue
    const previous = before?.dimensionSources?.[key]
    result[key] =
      previous?.valueCm === value && before?.[key] === value
        ? previous
        : { valueCm: value, source: before?.[key] === value ? 'unknown' : 'entered' }
  }
  return result
}

export function dimensionSourceLabel(
  measurements: RoomMeasurements | null,
  key: 'widthCm' | 'depthCm',
  value: number,
): string {
  if (!Number.isFinite(value) || value <= 0) return 'Размер не указан'
  const saved = measurements?.dimensionSources?.[key]
  if (hasCurrentVerification(measurements) && measurements?.[key] === value) {
    return 'Сверено пользователем замером; параметры подтверждения указаны ниже'
  }
  if (!saved || saved.valueCm !== value) return 'Источник не подтверждён'
  return {
    plan: 'Распознано с плана — сверьте с оригиналом',
    estimated: 'Вычислено из площади — нужен замер',
    entered: 'Изменено вручную — замер не подтверждён',
    unknown: 'Источник не подтверждён',
  }[saved.source]
}
