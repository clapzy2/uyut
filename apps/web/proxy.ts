import { getSessionCookie } from 'better-auth/cookies'
import { type NextRequest, NextResponse } from 'next/server'
import { getRequestsByIpLimiter } from '@/lib/redis'

const protectedPrefixes = ['/profile', '/projects', '/onboarding', '/verify-email']
const guestOnlyPaths = new Set(['/login', '/register', '/forgot-password'])

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for')
  return forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || '127.0.0.1'
}

export async function proxy(request: NextRequest) {
  // Общий потолок по IP. Если Redis недоступен, пропускаем: доступность важнее строгости.
  try {
    const { success } = await getRequestsByIpLimiter().limit(clientIp(request))
    if (!success) {
      return new NextResponse('Слишком много запросов. Попробуйте через минуту.', {
        status: 429,
        headers: { 'retry-after': '60', 'content-type': 'text/plain; charset=utf-8' },
      })
    }
  } catch (error) {
    console.error('rate limit check failed', error)
  }

  const { pathname } = request.nextUrl
  const hasSession = Boolean(getSessionCookie(request))

  if (!hasSession && protectedPrefixes.some((prefix) => pathname.startsWith(prefix))) {
    const url = new URL('/login', request.url)
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  if (hasSession && guestOnlyPaths.has(pathname)) {
    return NextResponse.redirect(new URL('/projects', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|api/health).*)'],
}
