import { getSessionCookie } from 'better-auth/cookies'
import { type NextRequest, NextResponse } from 'next/server'
import { getEnv } from '@/lib/env'
import { getRequestsByIpLimiter } from '@/lib/redis'
import { CLIENT_IP_HEADER, resolveClientIp } from '@/lib/security/client-ip'
import { contentSecurityPolicy, createNonce } from '@/lib/security/csp'
import { isAuthCookieName, isStaleSessionBounce } from '@/lib/security/stale-session'

const protectedPrefixes = ['/profile', '/projects', '/onboarding', '/verify-email']
const guestOnlyPaths = new Set(['/login', '/register', '/forgot-password'])

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

  // Адрес разбирается здесь один раз; заголовок перезаписывается всегда, иначе его пришлёт клиент
  const clientIp = resolveClientIp(request.headers, env.TRUSTED_PROXY_HOPS)
  if (clientIp) {
    requestHeaders.set(CLIENT_IP_HEADER, clientIp)
  } else {
    requestHeaders.delete(CLIENT_IP_HEADER)
  }

  function withPolicy(response: NextResponse): NextResponse {
    response.headers.set('content-security-policy', policy)
    return response
  }

  // Общий потолок по IP. Если Redis недоступен, пропускаем: доступность важнее строгости.
  try {
    const { success } = await getRequestsByIpLimiter().limit(clientIp ?? 'unknown')
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

  if (
    isStaleSessionBounce({
      hasSessionCookie: hasSession,
      isGuestOnlyPath: guestOnlyPaths.has(pathname),
      hasNextParam: request.nextUrl.searchParams.has('next'),
    })
  ) {
    // Печенье есть, а сессии за ним нет: разворачивать обратно нельзя, получится круг.
    const response = withPolicy(NextResponse.next({ request: { headers: requestHeaders } }))
    for (const cookie of request.cookies.getAll()) {
      if (isAuthCookieName(cookie.name)) {
        response.cookies.delete(cookie.name)
      }
    }
    return response
  }

  if (hasSession && guestOnlyPaths.has(pathname)) {
    return withPolicy(NextResponse.redirect(new URL('/projects', request.url)))
  }

  return withPolicy(NextResponse.next({ request: { headers: requestHeaders } }))
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|api/health).*)'],
}
