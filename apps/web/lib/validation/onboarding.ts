import { styleIds } from '@uyut/ai'
import { z } from 'zod'
import { seriesRoomCounts } from '@/lib/onboarding/house-series'
import { mvpRoomKinds } from '@/lib/projects/format'

export const BUDGET_MIN_KOPECKS = 100_000_00
export const BUDGET_MAX_KOPECKS = 3_000_000_00
export const BUDGET_DEFAULT_KOPECKS = 800_000_00

/** Сколько карточек стиля нужно пройти, чтобы вкус посчитался осмысленно */
export const MIN_STYLE_VOTES = 10

const titleSchema = z
  .string()
  .trim()
  .min(1, { error: 'Дайте проекту название' })
  .max(80, { error: 'Слишком длинно: хватит 80 знаков' })

const areaNumber = z
  .number()
  .positive({ error: 'Площадь должна быть больше нуля' })
  .max(2000, { error: 'Слишком много для одной квартиры' })

const roomName = z
  .string()
  .trim()
  .min(1, { error: 'Как назовём комнату?' })
  .max(40, { error: 'Слишком длинно: хватит 40 знаков' })

export const manualRoomSchema = z.object({
  kind: z.enum(mvpRoomKinds, { error: 'Выберите тип комнаты' }),
  name: roomName,
  areaM2: areaNumber.nullable(),
})

// Шаг 1. Три способа рассказать о квартире: план, серия дома, комнаты руками.
export const apartmentSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('plan'),
    title: titleSchema,
    totalAreaM2: areaNumber.nullable(),
  }),
  z.object({
    mode: z.literal('series'),
    title: titleSchema,
    seriesId: z.string().min(1, { error: 'Выберите серию' }),
    roomCount: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  }),
  z.object({
    mode: z.literal('manual'),
    title: titleSchema,
    totalAreaM2: areaNumber.nullable(),
    rooms: z
      .array(manualRoomSchema)
      .min(1, { error: 'Добавьте хотя бы одну комнату' })
      .max(8, { error: 'Восьми комнат хватит для одной квартиры' }),
  }),
])

export const householdSchema = z.object({
  adults: z.number().int().min(1).max(6),
  kids: z.number().int().min(0).max(6),
  pets: z.boolean(),
  cookHome: z.boolean(),
  receiveGuests: z.boolean(),
  wfh: z.boolean(),
})

export const budgetSchema = z.object({
  budgetKopecks: z
    .number()
    .int()
    .min(BUDGET_MIN_KOPECKS, { error: 'Минимум сто тысяч рублей' })
    .max(BUDGET_MAX_KOPECKS, { error: 'Максимум три миллиона рублей' }),
})

export const styleVoteSchema = z.object({
  styleId: z
    .string()
    .refine((value) => styleIds.includes(value), { error: 'Неизвестная картинка' }),
  liked: z.boolean(),
})

export const styleVotesSchema = z.object({
  votes: z.array(styleVoteSchema).min(1, { error: 'Отметьте хотя бы одну картинку' }).max(40),
})

// Шаг 5. Ссылка на картинку или на доску Pinterest; файл приходит отдельным действием.
export const referenceLinkSchema = z.object({
  url: z
    .string()
    .trim()
    .max(500, { error: 'Слишком длинная ссылка' })
    .refine((value) => value === '' || /^https?:\/\//i.test(value), {
      error: 'Вставьте ссылку целиком, вместе с https://',
    }),
})

export type ApartmentInput = z.infer<typeof apartmentSchema>
export type HouseholdInput = z.infer<typeof householdSchema>
export type BudgetInput = z.infer<typeof budgetSchema>
export type StyleVoteInput = z.infer<typeof styleVoteSchema>
export type ReferenceLinkInput = z.infer<typeof referenceLinkSchema>

export { seriesRoomCounts }
