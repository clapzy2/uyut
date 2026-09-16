import { type LayoutItem, type LayoutRoomKind, layoutRoom, type RoomLayout } from '@uyut/catalog'
import type { PlanGeometry, RoomMeasurements } from '@uyut/db'
import { hasCurrentVerification, measurementNotice } from './measurement-assurance'
import { roomLayoutInputFromGeometry } from './room-geometry-layout'

/** Нижняя граница только для прямоугольной коробки, не масштабирование неизвестных ниш. */
export function layoutWithMeasurements(
  name: string,
  measurements: RoomMeasurements | null,
  geometry: PlanGeometry | undefined,
  items: readonly LayoutItem[],
  roomKind?: LayoutRoomKind,
): RoomLayout | null {
  const geometryInput = roomLayoutInputFromGeometry(geometry, name, measurements)
  let measurementNote = measurementNotice(measurements)
  if (geometryInput) {
    return {
      ...layoutRoom({ ...geometryInput, roomKind }, items),
      measurementNote: `${measurementNote} Погрешность контура, ниш и проёмов ещё не учтена в расчёте. Схема предварительная.`,
    }
  }
  const width = measurements?.widthCm
  const depth = measurements?.depthCm
  if (
    !width ||
    !depth ||
    !Number.isFinite(width) ||
    !Number.isFinite(depth) ||
    width <= 0 ||
    depth <= 0
  )
    return null
  const tolerance =
    hasCurrentVerification(measurements) && measurements?.finishStage === 'after'
      ? (measurements.toleranceCm ?? 0)
      : 0
  if (tolerance > 0) {
    measurementNote += ` Расчётная коробка: ${width - tolerance} × ${depth - tolerance} см вместо ${width} × ${depth} см — по нижней границе замера. Форма принята прямоугольной; погрешность проёмов и монтажные зазоры отдельно не проверены.`
  } else {
    measurementNote +=
      ' Размеры не уменьшены: для учёта погрешности подтвердите замер после отделки. Форма принята прямоугольной.'
  }
  return {
    ...layoutRoom(
      {
        widthCm: width - tolerance,
        depthCm: depth - tolerance,
        layoutNotes: measurements?.layoutNotes,
        roomKind,
      },
      items,
    ),
    measurementNote,
  }
}
