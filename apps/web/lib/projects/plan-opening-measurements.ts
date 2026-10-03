import type { PlanGeometry, PlanOpening, PlanOpeningMeasurement, PlanWall } from '@uyut/db'
import { z } from 'zod'
import { currentOpeningWidthProofs } from './plan-opening-face-pairs'

const point = z.object({ xCm: z.number().finite(), yCm: z.number().finite() }).strict()
const openingSnapshotSchema = z
  .object({
    id: z.string().min(1).max(100),
    type: z.enum(['door', 'window', 'balcony']),
    wallId: z.string().min(1).max(100),
    widthCm: z.number().finite().min(30).max(1000),
    offsetCm: z.number().finite().min(0).max(10000),
  })
  .strict()
const wallSnapshotSchema = z
  .object({
    id: z.string().min(1).max(100),
    kind: z.enum(['outer', 'inner']),
    start: point,
    end: point,
    thicknessCm: z.number().finite().positive().max(100).optional(),
  })
  .strict()
const measurementRequestsSchema = z
  .array(
    z.discriminatedUnion('action', [
      z.object({ action: z.literal('remove'), openingId: z.string().min(1).max(100) }).strict(),
      z
        .object({
          action: z.literal('verify'),
          opening: openingSnapshotSchema,
          wall: wallSnapshotSchema,
          source: z
            .object({
              kind: z.enum(['site-measurement', 'dimensioned-drawing']),
              reference: z.string().trim().min(3).max(300),
            })
            .strict(),
          acknowledged: z.literal(true),
        })
        .strict(),
    ]),
  )
  .max(200)

export type OpeningMeasurementRequest = z.infer<typeof measurementRequestsSchema>[number]
export type VerifyOpeningMeasurementRequest = Extract<
  OpeningMeasurementRequest,
  { action: 'verify' }
>
type MeasurementGeometry = Pick<PlanGeometry, 'walls' | 'openings' | 'rooms' | 'pdfCalibration'>

export function openingMeasurementSnapshot(
  opening: PlanOpening,
): PlanOpeningMeasurement['opening'] {
  return {
    id: opening.id,
    type: opening.type,
    wallId: opening.wallId,
    widthCm: opening.widthCm,
    offsetCm: opening.offsetCm,
  }
}

export function openingMeasurementWallSnapshot(wall: PlanWall): PlanOpeningMeasurement['wall'] {
  return {
    id: wall.id,
    kind: wall.kind,
    start: { ...wall.start },
    end: { ...wall.end },
    ...(wall.thicknessCm === undefined ? {} : { thicknessCm: wall.thicknessCm }),
  }
}

export function openingMeasurementMatches(
  geometry: MeasurementGeometry,
  snapshot: Pick<PlanOpeningMeasurement, 'opening' | 'wall'>,
): boolean {
  const opening = geometry.openings.find((item) => item.id === snapshot.opening.id)
  const wall = geometry.walls.find((item) => item.id === snapshot.wall.id)
  return Boolean(
    opening &&
      wall &&
      opening.wallId === wall.id &&
      opening.type === snapshot.opening.type &&
      opening.wallId === snapshot.opening.wallId &&
      opening.widthCm === snapshot.opening.widthCm &&
      opening.offsetCm === snapshot.opening.offsetCm &&
      wall.kind === snapshot.wall.kind &&
      wall.thicknessCm === snapshot.wall.thicknessCm &&
      wall.start.xCm === snapshot.wall.start.xCm &&
      wall.start.yCm === snapshot.wall.start.yCm &&
      wall.end.xCm === snapshot.wall.end.xCm &&
      wall.end.yCm === snapshot.wall.end.yCm,
  )
}

export function currentOpeningMeasurements(
  geometry: MeasurementGeometry,
): PlanOpeningMeasurement[] {
  const calibration = geometry.pdfCalibration
  if (!calibration) return []
  return (calibration.openingMeasurements ?? []).filter(
    (measurement) =>
      measurement.sourceSha256 === calibration.sourceSha256 &&
      measurement.pdfPage === calibration.pdfPage &&
      measurement.cmPerPoint === calibration.cmPerPoint &&
      measurement.origin.x === calibration.origin.x &&
      measurement.origin.y === calibration.origin.y &&
      openingMeasurementMatches(geometry, measurement),
  )
}

/** Original required IDs remain intact, even when the last valid measurement clears the warning. */
function requiredOpeningMeasurementIds(geometry: MeasurementGeometry): string[] {
  const calibration = geometry.pdfCalibration
  if (!calibration) return []
  const currentProofs = new Set(currentOpeningWidthProofs(geometry))
  const lostProofIds = (calibration.openingWidthProofs ?? [])
    .filter((proof) => !currentProofs.has(proof))
    .map((proof) => proof.opening.id)
  return [
    ...new Set([
      ...(calibration.measurementRequiredOpeningIds ?? []),
      ...calibration.derivedOpeningIds,
      ...lostProofIds,
    ]),
  ]
}

export function unresolvedOpeningMeasurementIds(geometry: MeasurementGeometry): string[] {
  const calibration = geometry.pdfCalibration
  if (!calibration) return []
  const verified = new Set(currentOpeningMeasurements(geometry).map((item) => item.opening.id))
  return requiredOpeningMeasurementIds(geometry).filter((id) => !verified.has(id))
}

/** Only explicit requests produce records; author, date and source binding are server-owned. */
export function applyOpeningMeasurementRequests(
  geometry: MeasurementGeometry,
  input: unknown,
  actorId: string,
  verifiedAt: string,
): { ok: true; pdfCalibration: PlanGeometry['pdfCalibration'] } | { ok: false; error: string } {
  const parsed = measurementRequestsSchema.safeParse(input ?? [])
  if (!parsed.success)
    return {
      ok: false,
      error: 'Для сверки укажите обе мерки, источник и подтверждение существующего состояния.',
    }
  const calibration = geometry.pdfCalibration
  if (!calibration) {
    return parsed.data.length
      ? { ok: false, error: 'Сверка проёмов доступна после размерного переноса PDF.' }
      : { ok: true, pdfCalibration: undefined }
  }
  const required = new Set(requiredOpeningMeasurementIds(geometry))
  const measurements = new Map(
    currentOpeningMeasurements(geometry).map((item) => [item.opening.id, item]),
  )
  const requested = new Set<string>()
  for (const request of parsed.data) {
    const id = request.action === 'remove' ? request.openingId : request.opening.id
    if (requested.has(id)) return { ok: false, error: 'Один проём указан в сверке несколько раз.' }
    requested.add(id)
    if (request.action === 'remove') {
      measurements.delete(id)
      continue
    }
    if (!openingMeasurementMatches(geometry, request))
      return { ok: false, error: 'Проём или стена изменились после сверки. Сверьте мерки заново.' }
    const hostLength = Math.hypot(
      request.wall.end.xCm - request.wall.start.xCm,
      request.wall.end.yCm - request.wall.start.yCm,
    )
    if (request.opening.offsetCm + request.opening.widthCm > hostLength + 1e-7)
      return { ok: false, error: 'Сверенные мерки проёма должны помещаться на выбранной стене.' }
    measurements.set(id, {
      opening: request.opening,
      wall: request.wall,
      source: request.source,
      sourceSha256: calibration.sourceSha256,
      pdfPage: calibration.pdfPage,
      cmPerPoint: calibration.cmPerPoint,
      origin: { ...calibration.origin },
      verifiedAt,
      verifiedBy: actorId,
    })
  }
  // Preserve legacy shape for unchanged drafts that have never used the measurement workflow.
  if (
    !calibration.measurementRequiredOpeningIds &&
    !calibration.openingMeasurements &&
    !parsed.data.length &&
    required.size === calibration.derivedOpeningIds.length &&
    calibration.derivedOpeningIds.every((id) => required.has(id))
  )
    return { ok: true, pdfCalibration: calibration }
  return {
    ok: true,
    pdfCalibration: {
      ...calibration,
      measurementRequiredOpeningIds: [...required],
      openingMeasurements: [...measurements.values()],
      derivedOpeningIds: [...required].filter((id) => !measurements.has(id)),
    },
  }
}
