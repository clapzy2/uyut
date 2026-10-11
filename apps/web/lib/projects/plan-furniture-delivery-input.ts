import { verticalReferenceReviewKey } from '@uyut/catalog/plan-vertical-floor-geometry'
import type { PlanGeometry } from '@uyut/db'
import type {
  FurnitureDeliveryDraftFields,
  FurnitureDeliveryProfileFields,
} from './plan-furniture-delivery-archive'
import type { FurnitureDeliveryReportRequest } from './plan-furniture-delivery-report'
import { furnitureStairGeometryKey } from './plan-furniture-stair-transfer'

function decimal(value: string): number {
  const text = value.trim()
  return /^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/u.test(text)
    ? Number(text.replace(',', '.'))
    : Number.NaN
}

/** One conversion for browser and server; metadata always comes from the current context. */
export function createFurnitureDeliveryRequest(
  geometry: PlanGeometry,
  profileFields: FurnitureDeliveryProfileFields,
  fields: FurnitureDeliveryDraftFields,
  acknowledged: boolean,
  includeAccess = true,
): FurnitureDeliveryReportRequest {
  const reference = geometry.verticalReference
  const ceiling = (floorId: string) =>
    reference?.ceilings?.find((item) => item.floorId === floorId)?.elevationCm
  const survey = {
    geometryKey: furnitureStairGeometryKey(geometry),
    referenceKey: reference ? verticalReferenceReviewKey(reference) : '',
    source: { kind: 'site-measurement', reference: fields.sourceReference.trim() },
    lowerFloorId: fields.lowerFloorId,
    upperFloorId: fields.upperFloorId,
    ...(fields.polygonMode === true
      ? {
          version: 3,
          layout: (() => {
            const layout: unknown = JSON.parse(fields.polygonLayoutJson ?? '')
            if (!Array.isArray(layout)) throw new Error('Нужен массив участков')
            return layout
          })(),
        }
      : fields.turning
        ? {
            version: 2,
            layout: (fields.layout ?? []).map((section) => ({
              kind: section.kind,
              polygon: [
                { xCm: decimal(section.leftCm), yCm: decimal(section.topCm) },
                { xCm: decimal(section.rightCm), yCm: decimal(section.topCm) },
                { xCm: decimal(section.rightCm), yCm: decimal(section.bottomCm) },
                { xCm: decimal(section.leftCm), yCm: decimal(section.bottomCm) },
              ],
              elevationCm: decimal(section.elevationCm),
              ceilingElevationCm: decimal(section.ceilingElevationCm),
            })),
          }
        : {
            version: 1,
            direction: fields.direction,
            startCm: decimal(fields.startCm),
            crossStartCm: decimal(fields.crossStartCm),
            widthCm: decimal(fields.widthCm),
            lowerLandingLengthCm: decimal(fields.lowerLandingLengthCm),
            upperLandingLengthCm: decimal(fields.upperLandingLengthCm),
            lowerLandingCeilingCm: ceiling(fields.lowerFloorId),
            upperLandingCeilingCm: ceiling(fields.upperFloorId),
            treads: fields.steps.map((step) => ({
              runCm: decimal(step.runCm),
              elevationCm: decimal(step.elevationCm),
              ceilingElevationCm: decimal(step.ceilingElevationCm),
            })),
          }),
    travelDirection: fields.travelDirection,
    carryClearanceCm: decimal(fields.carryClearanceCm),
    tilt: fields.tilt,
    ...(fields.tilt === 'none' ? {} : { angleDeg: decimal(fields.angleDeg) }),
    acknowledged,
    ...(fields.allowQuarterTurns ? { allowQuarterTurns: true } : {}),
  }
  const request: FurnitureDeliveryReportRequest = {
    survey,
    profile: {
      widthCm: decimal(profileFields.widthCm),
      depthCm: decimal(profileFields.depthCm),
      heightCm: decimal(profileFields.heightCm),
      clearanceCm: decimal(profileFields.clearanceCm),
      orientation: profileFields.orientation === '90' ? 90 : 0,
    },
    targetRoomId: fields.targetRoomId ?? '',
  }
  if (includeAccess && (fields.exteriorEnabled === true || fields.doorLeavesEnabled === true)) {
    const access: NonNullable<FurnitureDeliveryReportRequest['accessInput']> = {}
    const metadata = {
      geometryKey: survey.geometryKey,
      referenceKey: survey.referenceKey,
      source: survey.source,
      acknowledged,
    }
    if (fields.exteriorEnabled === true) {
      const exterior: unknown = JSON.parse(fields.exteriorJson ?? '')
      if (!exterior || typeof exterior !== 'object' || Array.isArray(exterior))
        throw new Error('Нужен объект наружных обмеров')
      access.exterior = { ...exterior, ...metadata, version: 1 }
    }
    if (fields.doorLeavesEnabled === true) {
      const leaves: unknown = JSON.parse(fields.doorLeavesJson ?? '')
      if (!Array.isArray(leaves)) throw new Error('Нужен массив створок')
      access.doorLeaves = { ...metadata, leaves }
    }
    request.accessInput = access
  }
  return request
}
