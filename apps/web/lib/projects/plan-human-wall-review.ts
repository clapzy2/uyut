import { createHash } from 'node:crypto'
import type { PlanPoint, PlanReading, PlanWallFacePair } from '@uyut/db'
import { currentWallFacePairs } from './plan-opening-face-pairs'
import { planPageGeometryElementId } from './plan-page-metric-draft'
import type { PdfLinework } from './plan-pdf-linework'
import { pdfContourKey } from './plan-pdf-room-binding'
import {
  inspectPlanPageWallFaceCandidates,
  type PdfWallFaceReviewCandidate,
} from './plan-pdf-wall-faces'

export type HumanWallReviewOption = PdfWallFaceReviewCandidate & { id: string }
export type HumanWallReviewCandidate = HumanWallReviewOption & { metricPair: PlanWallFacePair }

export function wallPairReviewKey(pair: PlanWallFacePair): string {
  const ref = (
    value: { operationIndex: number; subpathIndex: number; segmentIndex: number } | undefined,
  ) => (value ? [value.operationIndex, value.subpathIndex, value.segmentIndex] : null)
  return JSON.stringify(
    pair.faces.map((face) => [
      face.wall.id,
      face.start.xCm,
      face.start.yCm,
      face.end.xCm,
      face.end.yCm,
      ref(face.nativeSegment),
      ref(face.strokeSegment),
    ]),
  )
}

/** Exact source candidates remain suggestions until the owner explicitly reviews both faces. */
export function humanWallReviewCandidates(
  reading: PlanReading,
  work: PdfLinework,
): HumanWallReviewCandidate[] {
  const geometry = reading.geometry
  const contours = reading.pageReview?.contours
  const calibration = geometry?.pdfCalibration
  if (
    !geometry ||
    !contours ||
    !calibration ||
    geometry.status !== 'draft' ||
    geometry.requiresSourceReviewReimport ||
    contours.source.state !== 'existing' ||
    calibration.sourceSha256 !== contours.source.sha256 ||
    calibration.pdfPage !== contours.source.pdfPage ||
    ![calibration.cmPerPoint, calibration.origin.x, calibration.origin.y].every(Number.isFinite) ||
    calibration.cmPerPoint <= 0
  )
    return []
  const snapshots = calibration.wallFaceRoomPolygons
  if (!snapshots || snapshots.length !== geometry.rooms.length) return []
  const remainingRooms = [...geometry.rooms]
  for (const snapshot of snapshots) {
    const index = remainingRooms.findIndex(
      (room) =>
        snapshot.length === room.polygon.length &&
        snapshot.every(
          (point, index) =>
            point.xCm === room.polygon[index]?.xCm && point.yCm === room.polygon[index]?.yCm,
        ),
    )
    if (index < 0) return []
    remainingRooms.splice(index, 1)
  }
  const convert = (point: { x: number; y: number }): PlanPoint => ({
    xCm:
      Math.round(
        ((point.x - calibration.origin.x) * work.pageWidth * calibration.cmPerPoint) / 100,
      ) / 10,
    yCm:
      Math.round(
        ((point.y - calibration.origin.y) * work.pageHeight * calibration.cmPerPoint) / 100,
      ) / 10,
  })
  const samePoint = (a: PlanPoint, b: PlanPoint) => a.xCm === b.xCm && a.yCm === b.yCm
  // Metric IDs use the importer's source-key order; JSONB may return another order.
  const source = {
    sha256: contours.source.sha256,
    pdfPage: contours.source.pdfPage,
    state: contours.source.state,
  }
  const sourcePairs = calibration.sourceWallFacePairs ?? calibration.wallFacePairs ?? []
  const existing = [
    ...sourcePairs.filter((pair) => pair.verification?.kind !== 'human-source-review'),
    ...currentWallFacePairs(geometry).filter(
      (pair) => pair.verification?.kind === 'human-source-review',
    ),
  ]
  const result: HumanWallReviewCandidate[] = []
  for (const candidate of inspectPlanPageWallFaceCandidates(work, contours.source, contours)) {
    const [first, second] = candidate.pair.faces
    const dx = ((first.end.x - first.start.x) * work.pageWidth) / 1000
    const dy = ((first.end.y - first.start.y) * work.pageHeight) / 1000
    const length = Math.hypot(dx, dy)
    const separation =
      Math.abs(
        dx * (((second.start.y - first.start.y) * work.pageHeight) / 1000) -
          dy * (((second.start.x - first.start.x) * work.pageWidth) / 1000),
      ) / length
    // Tiny corner fragments cannot establish the relationship of two wall faces.
    if (!Number.isFinite(separation) || length < separation || length === 0) continue
    const faces = candidate.pair.faces.flatMap((face) => {
      const contour =
        face.contourKey === 'exterior'
          ? contours.exterior
          : contours.rooms.find((room) => pdfContourKey(room) === face.contourKey)
      const start = contour?.polygon[face.wallEdgeIndex]
      const end = contour?.polygon[(face.wallEdgeIndex + 1) % contour.polygon.length]
      const wallId = planPageGeometryElementId(source, face.contourKey, 'wall', face.wallEdgeIndex)
      const wall = geometry.walls.find((wall) => wall.id === wallId)
      if (
        !wall ||
        wall.kind !== (face.contourKey === 'exterior' ? 'outer' : 'inner') ||
        !start ||
        !end ||
        !samePoint(wall.start, convert(start)) ||
        !samePoint(wall.end, convert(end))
      )
        return []
      return [
        {
          wall: structuredClone(wall),
          start: convert(face.start),
          end: convert(face.end),
          nativeSegment: face.nativeSegment,
          ...(face.strokeSegment ? { strokeSegment: face.strokeSegment } : {}),
        },
      ]
    })
    if (!faces[0] || !faces[1] || faces.length !== 2) continue
    const hostIds = new Set(faces.map((face) => face.wall.id))
    const openings = geometry.openings.filter((opening) => hostIds.has(opening.wallId))
    const crossesOpening = faces.some((face) => {
      const dx = face.wall.end.xCm - face.wall.start.xCm,
        dy = face.wall.end.yCm - face.wall.start.yCm
      const length = Math.hypot(dx, dy)
      const offset = (point: PlanPoint) =>
        ((point.xCm - face.wall.start.xCm) * dx + (point.yCm - face.wall.start.yCm) * dy) / length
      const low = Math.min(offset(face.start), offset(face.end)),
        high = Math.max(offset(face.start), offset(face.end))
      return openings.some(
        (opening) =>
          opening.wallId === face.wall.id &&
          opening.offsetCm < high - 0.1 &&
          opening.offsetCm + opening.widthCm > low + 0.1,
      )
    })
    if (crossesOpening) continue
    const metricPair: PlanWallFacePair = {
      faces: [faces[0], faces[1]],
      openings: structuredClone(openings),
    }
    if (existing.some((pair) => wallPairReviewKey(pair) === wallPairReviewKey(metricPair))) continue
    result.push({
      ...candidate,
      id: createHash('sha256')
        .update(JSON.stringify([source, candidate.pair]))
        .digest('hex'),
      metricPair,
    })
  }
  return result
}
