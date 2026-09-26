import type { PlanGeometry, RoomMeasurements } from '@uyut/db'
import { type LayoutItem, type LayoutRoomKind, layoutRoom, type RoomLayout } from './layout'
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
      ...layoutRoom({ ...geometryInput, roomKind, roomName: name }, items),
      measurementNote: `${measurementNote} Расстановка рассчитана по контуру. Погрешность контура, ниш и проёмов ещё не учтена; для финальной сверки уточните эти размеры. Схема предварительная.`,
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
    measurementNote += ` Расчётный габарит: ${width - tolerance} × ${depth - tolerance} см вместо ${width} × ${depth} см — по нижней границе замера. Форма принята прямоугольной; погрешность проёмов и монтажные зазоры уточните отдельно.`
  } else {
    measurementNote +=
      ' Для учёта погрешности подтвердите замер после отделки. Сейчас расчёт использует указанные размеры без уменьшения; форма принята прямоугольной.'
  }
  return {
    ...layoutRoom(
      {
        widthCm: width - tolerance,
        depthCm: depth - tolerance,
        layoutNotes: measurements?.layoutNotes,
        roomName: name,
        roomKind,
      },
      items,
    ),
    measurementNote,
  }
}
