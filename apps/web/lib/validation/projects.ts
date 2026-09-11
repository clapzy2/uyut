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
})

export type ConceptEditInput = z.input<typeof conceptEditSchema>
