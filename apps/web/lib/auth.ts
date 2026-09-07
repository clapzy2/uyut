import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { accounts, sessions, users, verifications } from '@uyut/db'
import { betterAuth } from 'better-auth'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { nextCookies } from 'better-auth/next-js'
import { magicLink } from 'better-auth/plugins'
import { recordAudit } from './audit'
import { findInvite } from './collaboration/repository'
import { getDb } from './db'
import { getEmailSender, invitationLetter, passwordResetLetter, verificationLetter } from './email'
import { getEnv } from './env'
import { hashPassword, verifyPassword } from './password'
import { createAuthStorage, getLoginByEmailLimiter } from './redis'
import { CLIENT_IP_HEADER } from './security/client-ip'

const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

function createAuth() {
  const env = getEnv()

  return betterAuth({
    appName: 'Uyut',
    baseURL: env.APP_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.APP_URL],
    database: drizzleAdapter(getDb(), {
      provider: 'pg',
      schema: { user: users, session: sessions, account: accounts, verification: verifications },
    }),
    secondaryStorage: createAuthStorage(),
    user: {
      fields: { name: 'displayName', image: 'avatarUrl' },
      additionalFields: {
        role: { type: 'string', defaultValue: 'user', input: false },
      },
    },
    session: {
      expiresIn: 30 * DAY,
      updateAge: DAY,
      storeSessionInDatabase: true,
      cookieCache: { enabled: true, maxAge: 15 * MINUTE },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      autoSignIn: true,
      requireEmailVerification: false,
      resetPasswordTokenExpiresIn: 30 * MINUTE,
      revokeSessionsOnPasswordReset: true,
      password: { hash: hashPassword, verify: verifyPassword },
      sendResetPassword: async ({ user, url }, request) => {
        // Не ждём отправку: иначе по времени ответа видно, существует ли адрес
        void getEmailSender()
          .send({ to: user.email, ...passwordResetLetter(url) })
          .catch((error) => console.error('password reset email failed', error))
        await recordAudit({
          action: 'auth.password_reset_requested',
          actorId: user.id,
          headers: request?.headers,
        })
      },
      onPasswordReset: async ({ user }, request) => {
        await recordAudit({
          action: 'auth.password_reset',
          actorId: user.id,
          headers: request?.headers,
        })
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: DAY,
      sendVerificationEmail: async ({ user, url }) => {
        await getEmailSender().send({ to: user.email, ...verificationLetter(url) })
      },
      afterEmailVerification: async (user, request) => {
        await recordAudit({
          action: 'auth.email_verified',
          actorId: user.id,
          headers: request?.headers,
        })
      },
    },
    rateLimit: {
      enabled: true,
      storage: 'secondary-storage',
      window: MINUTE,
      max: 60,
      customRules: {
        '/sign-in/email': { window: MINUTE, max: 5 },
        '/sign-up/email': { window: HOUR, max: 3 },
        '/request-password-reset': { window: HOUR, max: 5 },
        '/send-verification-email': { window: HOUR, max: 5 },
      },
    },
    advanced: {
      database: { generateId: false },
      // Прокси Next.js уже разобрал цепочку и положил доверенный адрес в этот заголовок
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },
    databaseHooks: {
      user: {
        create: {
          // Форма регистрации не спрашивает имя: до первого редактирования профиля берём часть адреса
          before: async (user) => {
            const name = user.name?.trim()
            if (name) {
              return { data: user }
            }
            return { data: { ...user, name: user.email.split('@')[0] ?? 'Вы' } }
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-in/email') {
          return
        }
        const email = typeof ctx.body?.email === 'string' ? ctx.body.email.toLowerCase() : null
        if (!email) {
          return
        }
        const { success } = await getLoginByEmailLimiter().limit(email)
        if (!success) {
          throw new APIError('TOO_MANY_REQUESTS', {
            message:
              'Слишком много попыток входа для этого адреса. Подождите час или смените пароль.',
          })
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        const headers = ctx.request?.headers ?? new Headers(ctx.headers ?? undefined)
        const actorId = ctx.context.newSession?.user.id ?? ctx.context.session?.user.id ?? null
        if (ctx.path === '/sign-up/email' && ctx.context.newSession) {
          await recordAudit({ action: 'auth.register', actorId, headers })
        }
        if (ctx.path === '/sign-in/email' && ctx.context.newSession) {
          await recordAudit({ action: 'auth.login', actorId, headers })
        }
        if (ctx.path === '/sign-out' && actorId) {
          await recordAudit({ action: 'auth.logout', actorId, headers })
        }
        if (ctx.path === '/change-password' && actorId) {
          await recordAudit({ action: 'auth.password_changed', actorId, headers })
        }
      }),
    },
    plugins: [
      nextCookies(),
      // Вход по ссылке нужен только приглашённым без аккаунта: письмо уходит лишь под живое
      // приглашение на этот адрес, иначе публичный эндпоинт ничего не отправляет
      magicLink({
        expiresIn: DAY,
        storeToken: 'hashed',
        sendMagicLink: async ({ email, url, metadata }) => {
          const token = typeof metadata?.inviteToken === 'string' ? metadata.inviteToken : null
          const invite = token ? await findInvite(token) : null
          if (invite?.status !== 'pending' || invite.email !== email.toLowerCase()) {
            return
          }
          await getEmailSender().send({
            to: email,
            ...invitationLetter({
              inviterName: invite.inviterName,
              projectTitle: invite.projectTitle,
              url,
            }),
          })
        },
      }),
    ],
  })
}

let instance: ReturnType<typeof createAuth> | undefined

// Ленивая инициализация: при сборке Next.js импортирует роуты, а окружения ещё нет
export function getAuth() {
  instance ??= createAuth()
  return instance
}

export type Auth = ReturnType<typeof createAuth>
export type Session = Auth['$Infer']['Session']
