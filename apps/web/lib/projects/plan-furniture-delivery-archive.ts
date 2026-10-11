import { verticalReferenceReviewKey } from '@uyut/catalog/plan-vertical-floor-geometry'
import type { PlanGeometry } from '@uyut/db'
import { z } from 'zod'
import { furnitureStairGeometryKey } from './plan-furniture-stair-transfer'

export const MAX_FURNITURE_DELIVERY_DRAFT_BYTES = 2 * 1024 * 1024
const fieldText = z.string().max(200)
const jsonText = z.string().max(200000)
const fieldId = fieldText.min(1)
const snapshotKey = z.string().max(1000000)

export const furnitureDeliveryProfileFieldsSchema = z
  .object({
    widthCm: fieldText,
    depthCm: fieldText,
    heightCm: fieldText,
    clearanceCm: fieldText,
    orientation: z.enum(['0', '90']),
  })
  .strict()

const stepFieldsSchema = z
  .object({
    id: fieldId,
    runCm: fieldText,
    elevationCm: fieldText,
    ceilingElevationCm: fieldText,
  })
  .strict()
const layoutFieldsSchema = z
  .object({
    id: fieldId,
    kind: z.enum(['landing', 'tread']),
    leftCm: fieldText,
    topCm: fieldText,
    rightCm: fieldText,
    bottomCm: fieldText,
    elevationCm: fieldText,
    ceilingElevationCm: fieldText,
  })
  .strict()

/** Raw form text may be incomplete; importing it never confirms the measurements. */
export const furnitureDeliveryDraftFieldsSchema = z
  .object({
    polygonMode: z.boolean().optional(),
    polygonLayoutJson: jsonText.optional(),
    exteriorEnabled: z.boolean().optional(),
    exteriorJson: jsonText.optional(),
    doorLeavesEnabled: z.boolean().optional(),
    doorLeavesJson: jsonText.optional(),
    turning: z.boolean().optional(),
    layout: z
      .array(layoutFieldsSchema)
      .max(128)
      .refine(
        (items) => new Set(items.map((item) => item.id)).size === items.length,
        'Duplicate section identifiers',
      )
      .optional(),
    targetRoomId: fieldText.optional(),
    allowQuarterTurns: z.boolean().optional(),
    lowerFloorId: fieldText,
    upperFloorId: fieldText,
    direction: z.enum(['x', 'y']),
    travelDirection: z.enum(['up', 'down']),
    startCm: fieldText,
    crossStartCm: fieldText,
    widthCm: fieldText,
    lowerLandingLengthCm: fieldText,
    upperLandingLengthCm: fieldText,
    carryClearanceCm: fieldText,
    sourceReference: z.string().max(1000),
    tilt: z.enum(['none', 'width', 'depth']),
    angleDeg: fieldText,
    steps: z
      .array(stepFieldsSchema)
      .max(64)
      .refine(
        (items) => new Set(items.map((item) => item.id)).size === items.length,
        'Duplicate step identifiers',
      ),
  })
  .strict()
  .refine(
    (fields) => !(fields.turning === true && fields.polygonMode === true),
    'Choose one stair layout mode',
  )

export const furnitureDeliveryDraftSchema = z
  .object({
    kind: z.literal('domitsa-furniture-delivery'),
    version: z.literal(1),
    geometryKey: snapshotKey.min(1),
    referenceKey: snapshotKey,
    profileFields: furnitureDeliveryProfileFieldsSchema,
    fields: furnitureDeliveryDraftFieldsSchema,
  })
  .strict()

export type FurnitureDeliveryProfileFields = z.infer<typeof furnitureDeliveryProfileFieldsSchema>
export type FurnitureDeliveryDraftFields = z.infer<typeof furnitureDeliveryDraftFieldsSchema>
export type FurnitureDeliveryDraft = z.infer<typeof furnitureDeliveryDraftSchema>

const referenceKey = (geometry: PlanGeometry) =>
  geometry.verticalReference ? verticalReferenceReviewKey(geometry.verticalReference) : ''

export function buildFurnitureDeliveryDraft(
  geometry: PlanGeometry,
  profileFields: FurnitureDeliveryProfileFields,
  fields: FurnitureDeliveryDraftFields,
): FurnitureDeliveryDraft {
  return furnitureDeliveryDraftSchema.parse({
    kind: 'domitsa-furniture-delivery',
    version: 1,
    geometryKey: furnitureStairGeometryKey(geometry),
    referenceKey: referenceKey(geometry),
    profileFields,
    fields,
  })
}

export function serializeFurnitureDeliveryDraft(
  geometry: PlanGeometry,
  profileFields: FurnitureDeliveryProfileFields,
  fields: FurnitureDeliveryDraftFields,
): string {
  const text = JSON.stringify(buildFurnitureDeliveryDraft(geometry, profileFields, fields), null, 2)
  if (new TextEncoder().encode(text).byteLength > MAX_FURNITURE_DELIVERY_DRAFT_BYTES) {
    throw new Error('Черновик переноса превышает 2 МиБ.')
  }
  return text
}

/** Only form fields are returned: a saved result or acknowledgement cannot become trusted. */
export function parseFurnitureDeliveryDraft(
  text: string,
  geometry: PlanGeometry,
  profileFields: FurnitureDeliveryProfileFields,
): { fields?: FurnitureDeliveryDraftFields; error?: string } {
  if (
    text.length > MAX_FURNITURE_DELIVERY_DRAFT_BYTES ||
    new TextEncoder().encode(text).byteLength > MAX_FURNITURE_DELIVERY_DRAFT_BYTES
  ) {
    return { error: 'Файл черновика превышает 2 МиБ.' }
  }
  let input: unknown
  try {
    input = JSON.parse(text)
  } catch {
    return { error: 'Не удалось прочитать JSON черновика переноса.' }
  }
  const parsed = furnitureDeliveryDraftSchema.safeParse(input)
  if (!parsed.success) {
    return { error: 'Неверный формат или версия черновика переноса.' }
  }
  const draft = parsed.data
  let savedGeometry: unknown
  try {
    savedGeometry = JSON.parse(draft.geometryKey)
  } catch {
    return { error: 'Не удалось прочитать геометрию черновика.' }
  }
  if (!samePlanDeliveryGeometry(savedGeometry, geometry)) {
    return { error: 'Схема изменилась: черновик относится к другой геометрии.' }
  }
  if (draft.referenceKey !== referenceKey(geometry)) {
    return { error: 'Уровень отсчёта изменился: черновик нужно сверить заново.' }
  }
  const currentProfile = furnitureDeliveryProfileFieldsSchema.safeParse(profileFields)
  if (
    !currentProfile.success ||
    JSON.stringify(draft.profileFields) !== JSON.stringify(currentProfile.data)
  ) {
    return { error: 'Размеры или положение мебели отличаются от сохранённого черновика.' }
  }
  return { fields: draft.fields }
}

import { samePlanDeliveryGeometry } from '@uyut/catalog/plan-delivery-record'
