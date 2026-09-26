import { z } from 'zod'
import { mvpRoomKinds, roomConditionOptions } from '@/lib/projects/format'

export const projectIdSchema = z.uuid()

const titleSchema = z
  .string()
  .trim()
  .min(1, { error: 'Дайте проекту название' })
  .max(80, { error: 'Слишком длинно: хватит 80 знаков' })

// Пустая строка из формы превращается в null, запятая в числе допустима
const areaSchema = z
  .string()
  .trim()
  .transform((value, ctx): number | null => {
    const normalized = value.replace(',', '.')
    if (normalized === '') {
      return null
    }
    const number = Number(normalized)
    if (!Number.isFinite(number)) {
      ctx.addIssue({ code: 'custom', message: 'Введите число' })
      return z.NEVER
    }
    if (number <= 0) {
      ctx.addIssue({ code: 'custom', message: 'Площадь должна быть больше нуля' })
      return z.NEVER
    }
    if (number > 2000) {
      ctx.addIssue({ code: 'custom', message: 'Слишком много для одной квартиры' })
      return z.NEVER
    }
    return Math.round(number * 100) / 100
  })

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: `Слишком длинно: хватит ${max} знаков` })
    .transform((value) => (value === '' ? null : value))

export const createProjectSchema = z.object({ title: titleSchema })

export const projectSettingsSchema = z.object({
  title: titleSchema,
  houseSeries: optionalText(40),
  totalAreaM2: areaSchema,
})

export const roomKindSchema = z.enum(mvpRoomKinds, { error: 'Выберите тип комнаты' })

export const roomConditionSchema = z.enum(roomConditionOptions, {
  error: 'Выберите, что делаем с комнатой',
})

export const roomSchema = z.object({
  kind: roomKindSchema,
  name: z
    .string()
    .trim()
    .min(1, { error: 'Как назовём комнату?' })
    .max(40, { error: 'Слишком длинно: хватит 40 знаков' }),
  areaM2: areaSchema,
})

export const roomConditionFormSchema = z.object({ condition: roomConditionSchema })

/** Участок стены со слов человека: название и ширина в сантиметрах */
const spotWidthSchema = z
  .string()
  .trim()
  .transform((value, ctx): number | null => {
    const normalized = value.replace(',', '.')
    if (normalized === '') {
      return null
    }
    const number = Number(normalized)
    if (!Number.isFinite(number) || number < 10 || number > 2000) {
      ctx.addIssue({ code: 'custom', message: 'От 10 до 2000 см' })
      return null
    }
    return number
  })

const toleranceSchema = z
  .string()
  .trim()
  .default('')
  .transform((value, ctx): number | null => {
    if (!value) return null
    const number = Number(value.replace(',', '.'))
    if (!Number.isFinite(number) || number <= 0 || number > 100) {
      ctx.addIssue({ code: 'custom', message: 'Укажите погрешность больше 0 и не больше 100 см' })
      return null
    }
    return number
  })

export const roomMeasurementsSchema = z
  .object({
    finishStage: z.enum(['unknown', 'before', 'after']).default('unknown'),
    toleranceCm: toleranceSchema,
    confirmDimensions: z.boolean().default(false),
    layoutNotes: z.string().trim().max(800).optional(),
    ceilingCm: spotWidthSchema,
    widthCm: spotWidthSchema,
    depthCm: spotWidthSchema,
    spots: z
      .array(z.object({ name: z.string().trim().max(40), widthCm: spotWidthSchema }))
      .max(8)
      .default([]),
  })
  .superRefine((value, ctx) => {
    if (
      value.confirmDimensions &&
      (value.widthCm === null ||
        value.depthCm === null ||
        value.finishStage === 'unknown' ||
        value.toleranceCm === null)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Для подтверждения укажите обе стороны, этап отделки и погрешность замера.',
      })
    }
    if (
      value.toleranceCm !== null &&
      [value.widthCm, value.depthCm].some(
        (side) => side !== null && value.toleranceCm !== null && value.toleranceCm >= side,
      )
    ) {
      ctx.addIssue({ code: 'custom', message: 'Погрешность должна быть меньше размера комнаты.' })
    }
  })

export type RoomMeasurementsInput = z.input<typeof roomMeasurementsSchema>

/**
 * Правка прочитанного плана. Название пустым разрешено: строку, которую человек снял галочкой,
 * незачем заставлять его дозаполнять, а у оставленной подставится название по типу комнаты.
 */
export const planRoomsSchema = z.object({
  ceilingCm: spotWidthSchema,
  /** Состояние квартиры одним ответом на все создаваемые комнаты: от него зависит смета работ */
  condition: z.enum(['bare', 'finished'], { error: 'Выберите, что делаем с квартирой' }),
  rooms: z
    .array(
      z.object({
        include: z.boolean(),
        // Пустая строка, а не отсутствие поля: форма отдаёт то, что есть в состоянии строки
        roomId: z.union([z.uuid(), z.literal('')]),
        name: z.string().trim().max(40, { error: 'Слишком длинно: хватит 40 знаков' }),
        kind: roomKindSchema,
        sourceNumber: z.number().int().min(1).max(50).optional(),
        ceilingCm: spotWidthSchema.optional(),
        widthCm: spotWidthSchema,
        depthCm: spotWidthSchema,
        areaM2: areaSchema,
        wish: z.string().trim().max(500, { error: 'Слишком длинно: хватит 500 знаков' }),
        layoutNotes: z.string().trim().max(800).optional(),
      }),
    )
    .min(1, { error: 'Нечего сохранять' })
    .max(20, { error: 'Больше двадцати комнат за раз не берём' }),
})

export type PlanRoomsInput = z.input<typeof planRoomsSchema>

export const roomNotesSchema = z.object({
  notes: z.string().trim().max(2000, { error: 'Слишком длинно: хватит 2000 знаков' }),
})

export type CreateProjectInput = z.input<typeof createProjectSchema>
export type ProjectSettingsInput = z.input<typeof projectSettingsSchema>
export type ProjectSettingsOutput = z.output<typeof projectSettingsSchema>
export type RoomInput = z.input<typeof roomSchema>
export type RoomOutput = z.output<typeof roomSchema>
export type RoomNotesInput = z.input<typeof roomNotesSchema>
export type RoomConditionInput = z.input<typeof roomConditionFormSchema>

export const conceptEditSchema = z.object({
  request: z
    .string()
    .trim()
    .min(3, { error: 'Напишите, что поменять' })
    .max(500, { error: 'Слишком длинно: хватит 500 знаков' }),
  /** Предмет с рендера, приложенный к просьбе картинкой. Пусто — правим одними словами */
  objectId: z.union([z.uuid(), z.literal('')]).default(''),
})

export type ConceptEditInput = z.input<typeof conceptEditSchema>
