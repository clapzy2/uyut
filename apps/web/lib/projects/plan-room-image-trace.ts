import type { PlanImageCalibration, PlanRoomShape } from '@uyut/db'
import { traceImageContour } from './plan-image-contour'
import { MAX_ROOM_CONTOUR_POINTS } from './room-contour'

type SourceFrame = {
  sha256: string
  page: number
  widthPx: number
  heightPx: number
}

/** A trace ties an edited room to source pixels; it does not prove what those pixels depict. */
export function verifiedRoomImageTrace(
  submittedRoom: unknown,
  room: PlanRoomShape,
  calibration: PlanImageCalibration,
  frame: SourceFrame,
  canvas: { widthCm: number; heightCm: number },
): PlanRoomShape['imageTrace'] | undefined {
  if (!submittedRoom || typeof submittedRoom !== 'object') return undefined
  const trace = (submittedRoom as { imageTrace?: unknown }).imageTrace
  if (!trace || typeof trace !== 'object') return undefined
  const sourceTrace = trace as {
    pointsPx?: unknown
    sourceSha256?: unknown
    page?: unknown
    imageWidthPx?: unknown
    imageHeightPx?: unknown
  }
  if (
    (sourceTrace.sourceSha256 !== undefined && sourceTrace.sourceSha256 !== frame.sha256) ||
    (sourceTrace.page !== undefined && sourceTrace.page !== frame.page) ||
    (sourceTrace.imageWidthPx !== undefined && sourceTrace.imageWidthPx !== frame.widthPx) ||
    (sourceTrace.imageHeightPx !== undefined && sourceTrace.imageHeightPx !== frame.heightPx)
  )
    return undefined
  const pointsPx = sourceTrace.pointsPx
  if (!Array.isArray(pointsPx) || pointsPx.length !== room.polygon.length) return undefined
  const vertices = (pointsPx as unknown[]).map((point) => {
    if (!point || typeof point !== 'object') return undefined
    const vertex = point as { x?: unknown; y?: unknown }
    return typeof vertex.x === 'number' && typeof vertex.y === 'number'
      ? { x: vertex.x, y: vertex.y }
      : undefined
  })
  if (vertices.some((point) => !point)) return undefined
  if (calibration.sourceSha256 && calibration.sourceSha256 !== frame.sha256) return undefined
  if (calibration.pdfPage && calibration.pdfPage !== frame.page) return undefined
  if (calibration.imageWidthPx !== frame.widthPx || calibration.imageHeightPx !== frame.heightPx)
    return undefined
  const metric = traceImageContour(
    vertices as { x: number; y: number }[],
    calibration,
    canvas.widthCm,
    canvas.heightCm,
    MAX_ROOM_CONTOUR_POINTS,
  )
  if (
    !metric ||
    metric.some((point, index) => {
      const saved = room.polygon[index]
      return (
        !saved || Math.abs(point.xCm - saved.xCm) > 0.11 || Math.abs(point.yCm - saved.yCm) > 0.11
      )
    })
  )
    return undefined
  return {
    pointsPx: vertices as { x: number; y: number }[],
    sourceSha256: frame.sha256,
    page: frame.page,
    imageWidthPx: frame.widthPx,
    imageHeightPx: frame.heightPx,
  }
}
