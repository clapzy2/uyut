import { describe, expect, it } from 'vitest'
import { loginSchema, registerSchema, resetPasswordSchema } from './auth'

describe('auth validation', () => {
  it('normalises email to lower case and trims spaces', () => {
    const result = loginSchema.parse({ email: '  Anna@Example.RU ', password: 'x' })
    expect(result.email).toBe('anna@example.ru')
  })

  it('rejects a malformed email with a friendly message', () => {
    const result = loginSchema.safeParse({ email: 'anna@', password: 'x' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/опечатку/)
    }
  })

  it('requires an 8 character password and consent on registration', () => {
    const result = registerSchema.safeParse({
      email: 'a@b.ru',
      password: 'short',
      confirm: 'short',
      consent: false,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join('.'))
      expect(paths).toContain('password')
      expect(paths).toContain('consent')
    }
  })

  it('checks that both passwords match on registration', () => {
    const result = registerSchema.safeParse({
      email: 'a@b.ru',
      password: 'longenough',
      confirm: 'longenouhg',
      consent: true,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const mismatch = result.error.issues.find((issue) => issue.path.join('.') === 'confirm')
      expect(mismatch?.message).toBe('Пароли не совпадают')
    }
  })

  it('accepts a registration where the repeated password is the same', () => {
    const result = registerSchema.safeParse({
      email: 'a@b.ru',
      password: 'longenough',
      confirm: 'longenough',
      consent: true,
    })
    expect(result.success).toBe(true)
  })

  it('checks that both passwords match on reset', () => {
    const result = resetPasswordSchema.safeParse({ password: 'longenough', confirm: 'different' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['confirm'])
    }
  })
})
