import type { PlanGeometry, RoomMeasurements } from '@uyut/db'
import { type LayoutItem, type LayoutRoomKind, layoutRoom } from './layout'
import { layoutPromptContract } from './layout-prompt'
import { roomLayoutInputFromGeometry } from './room-geometry-layout'

/** Only a confirmed room contour and a fully checked placement may constrain a render. */
export function conceptLayoutContract(
  roomName: string,
  roomKind: LayoutRoomKind,
  measurements: RoomMeasurements | null | undefined,
  geometry: PlanGeometry | undefined,
  items: readonly LayoutItem[],
): string | undefined {
  if (items.length === 0) return undefined
  const input = roomLayoutInputFromGeometry(geometry, roomName, measurements)
  if (!input) return undefined

  const layout = layoutRoom({ ...input, roomName, roomKind }, items)
  if (
    layout.safetySummary.status !== 'checked' ||
    layout.problems.length > 0 ||
    layout.unmeasured.length > 0 ||
    layout.placed.length === 0
  ) {
    return undefined
  }
  return layoutPromptContract(layout) || undefined
}
