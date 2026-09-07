import { getSessionCookie } from 'better-auth/cookies'
import { type NextRequest, NextResponse } from 'next/server'
import { getEnv } from '@/lib/env'
import { getRequestsByIpLimiter } from '@/lib/redis'
import { contentSecurityPolicy, createNonce } from '@/lib/security/csp'

const protectedPrefixes = ['/profile', '/projects', '/onboarding', '/verify-email']
const guestOnlyPaths = new Set(['/login', '/register', '/forgot-password'])

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for')
  return forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || '127.0.0.1'
}

export async function proxy(request: NextRequest) {
  const env = getEnv()
  const policy = contentSecurityPolicy(createNonce(), {
    dev: process.env.NODE_ENV !== 'production',
    secure: env.APP_URL.startsWith('https://'),
    storageOrigin: new URL(env.S3_ENDPOINT).origin,
  })
  // Next.js читает номер из заголовка запроса, поэтому политику кладём и в запрос, и в ответ
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('content-security-policy', policy)

  function withPolicy(response: NextResponse): NextResponse {
    response.headers.set('content-security-policy', policy)
    return response
  }

  // Общий потолок по IP. Если Redis недоступен, пропускаем: доступность важнее строгости.
  try {
    const { success } = await getRequestsByIpLimiter().limit(clientIp(request))
    if (!success) {
      return withPolicy(
        new NextResponse('Слишком много запросов. Попробуйте через минуту.', {
          status: 429,
          headers: { 'retry-after': '60', 'content-type': 'text/plain; charset=utf-8' },
        }),
      )
    }
  } catch (error) {
    console.error('rate limit check failed', error)
  }

  const { pathname } = request.nextUrl
  const hasSession = Boolean(getSessionCookie(request))

  if (!hasSession && protectedPrefixes.some((prefix) => pathname.startsWith(prefix))) {
    const url = new URL('/login', request.url)
    url.searchParams.set('next', pathname)
    return withPolicy(NextResponse.redirect(url))
  }

  if (hasSession && guestOnlyPaths.has(pathname)) {
    return withPolicy(NextResponse.redirect(new URL('/projects', request.url)))
  }

  return withPolicy(NextResponse.next({ request: { headers: requestHeaders } }))
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|api/health).*)'],
}
