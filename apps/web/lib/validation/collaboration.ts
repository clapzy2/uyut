import { z } from 'zod'
import { emailSchema, passwordSchema } from './auth'

export const inviteFormSchema = z.object({ email: emailSchema })

// Пароль задаёт только аккаунт из magic-link; пустые поля означают «позже»
export const acceptInviteFormSchema = z
  .object({
    password: z.string(),
    confirm: z.string(),
  })
  .superRefine((value, ctx) => {
    if (value.password === '' && value.confirm === '') {
      return
    }
    const checked = passwordSchema.safeParse(value.password)
    if (!checked.success) {
      ctx.addIssue({
        code: 'custom',
        path: ['password'],
        message: checked.error.issues[0]?.message ?? 'Проверьте пароль',
      })
      return
    }
    if (value.password !== value.confirm) {
      ctx.addIssue({ code: 'custom', path: ['confirm'], message: 'Пароли не совпадают' })
    }
  })

export type InviteFormInput = z.input<typeof inviteFormSchema>
export type AcceptInviteFormInput = z.input<typeof acceptInviteFormSchema>
