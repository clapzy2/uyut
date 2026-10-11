import type { PlanGeometry, PlanReading } from '@uyut/db'
import { z } from 'zod'

const coordinate = z.number().finite().min(-10000).max(10000)
const elevation = z.number().finite().min(-600).max(1200)
const point = z.object({ xCm: coordinate, yCm: coordinate }).strict()
const position = point
  .extend({ zCm: elevation, orientation: z.union([z.literal(0), z.literal(90)]).optional() })
  .strict()
const positions = z.array(position).min(1).max(6000)
const bounds = z
  .object({
    leftCm: coordinate,
    topCm: coordinate,
    rightCm: coordinate,
    bottomCm: coordinate,
    bottomElevationCm: elevation,
    topElevationCm: elevation,
  })
  .strict()
  .refine(
    (value) =>
      value.leftCm <= value.rightCm &&
      value.topCm <= value.bottomCm &&
      value.bottomElevationCm <= value.topElevationCm,
  )
const regions = z
  .array(
    z
      .object({
        kind: z.enum(['landing', 'tread']),
        index: z.number().int().min(0).max(127),
        polygon: z.array(point).min(3).max(32),
        station: point.optional(),
        elevationCm: elevation,
        ceilingElevationCm: elevation,
      })
      .strict(),
  )
  .min(3)
  .max(128)
const stages = z
  .array(
    z
      .object({
        kind: z.enum(['lift', 'translate', 'lower', 'tilt', 'untilt', 'turn']),
        from: position,
        to: position,
        bounds,
      })
      .strict(),
  )
  .min(1)
  .max(6000)
const length = z.number().finite().positive().max(10000)
const profile = z
  .object({
    widthCm: length,
    depthCm: length,
    heightCm: length,
    clearanceCm: z.number().finite().min(0).max(100),
    orientation: z.union([z.literal(0), z.literal(90)]),
  })
  .strict()
const notes = z.array(z.string().max(5000)).max(100)
const reportSchema = z
  .object({
    kind: z.literal('domitsa-furniture-delivery-report'),
    version: z.literal(1),
    units: z.literal('cm'),
    coordinateSystem: z.string().max(1000),
    limitations: notes,
    scope: z
      .object({
        completeRoute: z.literal(true),
        exteriorChecked: z.boolean(),
        leavesChecked: z.boolean(),
      })
      .strict(),
    geometry: z.record(z.string(), z.unknown()),
    request: z
      .object({
        profile,
        targetRoomId: z.string().max(200),
        survey: z
          .object({
            geometryKey: z.string().max(1000000),
            referenceKey: z.string().max(1000000),
            acknowledged: z.literal(true),
            source: z
              .object({
                kind: z.enum(['site-measurement', 'dimensioned-drawing']),
                reference: z.string().max(1000),
              })
              .strict(),
          })
          .passthrough(),
        accessInput: z
          .object({ exterior: z.unknown().optional(), doorLeaves: z.unknown().optional() })
          .strict()
          .optional(),
      })
      .strict(),
    result: z
      .object({
        points: positions,
        targetRoomId: z.string().max(200),
        checkedNodes: z.number().int().min(0).max(6000),
        exteriorChecked: z.literal(true).optional(),
        leavesChecked: z.literal(true).optional(),
        segments: z
          .object({
            entry: positions,
            stairs: positions,
            exit: positions,
            exterior: positions.optional(),
          })
          .strict(),
        stairs: z
          .object({
            referenceId: z.string().max(100),
            travelDirection: z.enum(['up', 'down']),
            tilt: z.enum(['none', 'width', 'depth']),
            angleDeg: z.number().finite().min(0).max(90),
            carried: profile.pick({ widthCm: true, depthCm: true, heightCm: true }),
            sweepHeightCm: length,
            regions,
            points: positions,
            stages,
            checkedStages: z.number().int().min(0).max(6000).optional(),
          })
          .strict(),
      })
      .strict(),
    notes,
    savedDraftKey: z.string().max(2 * 1024 * 1024),
  })
  .strict()

export type StoredPlanDeliveryInspection =
  | { status: 'held'; warnings: string[] }
  | {
      status: 'checked'
      reviewedAt: string
      profile: z.infer<typeof profile>
      targetRoomName: string
      points: z.infer<typeof positions>
      regions: z.infer<typeof regions>
      stages: z.infer<typeof stages>
      exteriorChecked: boolean
      leavesChecked: boolean
      notes: string[]
    }

export type PlanDeliveryPresentation = StoredPlanDeliveryInspection

/** JSONB may reorder object keys, but never array positions or numeric values. */
export function canonicalPlanDeliveryJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item,
  )
}

export function samePlanDeliveryGeometry(first: unknown, second: unknown): boolean {
  const withEditorDefaults = (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value
    const geometry = value as Record<string, unknown>
    // The editor and checker already use [] for these two absent collections.
    // A non-empty list, null, or any other field must still compare exactly.
    return {
      ...geometry,
      obstacles: geometry.obstacles === undefined ? [] : geometry.obstacles,
      kitchenItems: geometry.kitchenItems === undefined ? [] : geometry.kitchenItems,
    }
  }
  return (
    canonicalPlanDeliveryJson(withEditorDefaults(first)) ===
    canonicalPlanDeliveryJson(withEditorDefaults(second))
  )
}

const recordSchema = z
  .object({
    version: z.literal(1),
    savedAt: z.string().datetime(),
    draftJson: z.string().max(2 * 1024 * 1024),
    reportJson: z
      .string()
      .max(8 * 1024 * 1024)
      .optional(),
  })
  .strict()
const numericText = (value: unknown) =>
  typeof value === 'string' && value.trim() !== ''
    ? Number(value.trim().replace(',', '.'))
    : Number.NaN

/** Reads a server-written database snapshot, not a client-supplied certificate. */
export function inspectStoredPlanDelivery(
  geometry: PlanGeometry | undefined,
  record: PlanReading['deliveryMeasurements'] | unknown,
): StoredPlanDeliveryInspection | undefined {
  if (record === undefined) return undefined
  const held = (warning: string): StoredPlanDeliveryInspection => ({
    status: 'held',
    warnings: [warning],
  })
  if (geometry?.requiresSourceReviewReimport)
    return held(
      'Исходная разметка PDF изменилась. Обновите перенос схемы и заново проверьте маршрут заноса.',
    )
  try {
    const stored = recordSchema.parse(record)
    if (new TextEncoder().encode(stored.draftJson).byteLength > 2 * 1024 * 1024)
      return held('Обмеры заноса превышают допустимый размер.')
    if (!stored.reportJson)
      return held('Обмеры заноса сохранены как черновик; полный маршрут не проверен.')
    if (new TextEncoder().encode(stored.reportJson).byteLength > 8 * 1024 * 1024)
      return held('Отчёт заноса превышает допустимый размер.')
    const report = reportSchema.parse(JSON.parse(stored.reportJson))
    const draft = JSON.parse(stored.draftJson)
    if (
      !geometry ||
      report.savedDraftKey !== canonicalPlanDeliveryJson(draft) ||
      draft.kind !== 'domitsa-furniture-delivery' ||
      draft.version !== 1 ||
      !samePlanDeliveryGeometry(JSON.parse(draft.geometryKey), geometry) ||
      !samePlanDeliveryGeometry(report.geometry, geometry) ||
      report.request.survey.geometryKey !== draft.geometryKey ||
      report.request.survey.referenceKey !== draft.referenceKey ||
      report.request.targetRoomId !== draft.fields?.targetRoomId ||
      report.result.targetRoomId !== report.request.targetRoomId ||
      report.request.survey.source.reference.trim() !== draft.fields?.sourceReference?.trim() ||
      report.request.survey.source.kind !== 'site-measurement'
    ) {
      return held('Схема или обмеры изменились; маршрут заноса нужно проверить заново.')
    }
    for (const key of ['widthCm', 'depthCm', 'heightCm', 'clearanceCm'] as const) {
      if (report.request.profile[key] !== numericText(draft.profileFields?.[key]))
        return held('Габариты мебели в отчёте не соответствуют обмерам.')
    }
    if (report.request.profile.orientation !== Number(draft.profileFields?.orientation))
      return held('Положение мебели изменилось.')
    const roomIndex = Number(report.result.targetRoomId)
    if (
      !/^\d+$/u.test(report.result.targetRoomId) ||
      String(roomIndex) !== report.result.targetRoomId ||
      !geometry.rooms[roomIndex]
    )
      return held('Целевая комната больше не существует.')
    if (
      report.scope.exteriorChecked !== (report.result.exteriorChecked === true) ||
      report.scope.leavesChecked !== (report.result.leavesChecked === true) ||
      report.scope.exteriorChecked !== (draft.fields.exteriorEnabled === true) ||
      report.scope.leavesChecked !== (draft.fields.doorLeavesEnabled === true)
    )
      return held('Состав проверки заноса изменился.')
    return {
      status: 'checked',
      reviewedAt: stored.savedAt,
      profile: report.request.profile,
      targetRoomName: geometry.rooms[roomIndex].name,
      points: report.result.points,
      regions: report.result.stairs.regions,
      stages: report.result.stairs.stages,
      exteriorChecked: report.scope.exteriorChecked,
      leavesChecked: report.scope.leavesChecked,
      notes: report.notes,
    }
  } catch {
    return held('Сохранённые обмеры или отчёт заноса повреждены; требуется повторная проверка.')
  }
}
