import { z } from 'zod'

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Похоже на опечатку: проверьте адрес' }))

export const passwordSchema = z
  .string()
  .min(8, { error: 'Не короче 8 знаков' })
  .max(128, { error: 'Слишком длинный: хватит 128 знаков' })

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, { error: 'Введите пароль' }),
})

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  consent: z.literal(true, { error: 'Без согласия на обработку данных аккаунт создать нельзя' }),
})

export const forgotPasswordSchema = z.object({
  email: emailSchema,
})

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirm: z.string(),
  })
  .refine((value) => value.password === value.confirm, {
    path: ['confirm'],
    error: 'Пароли не совпадают',
  })

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, { error: 'Введите текущий пароль' }),
  newPassword: passwordSchema,
})

export const profileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: 'Как к вам обращаться?' })
    .max(60, { error: 'Слишком длинно: хватит 60 знаков' }),
})

export type LoginInput = z.infer<typeof loginSchema>
export type RegisterInput = z.infer<typeof registerSchema>
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>
export type ProfileInput = z.infer<typeof profileSchema>
