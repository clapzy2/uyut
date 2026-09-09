import { timingSafeEqual } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { sweepPendingPurchases } from '@/lib/billing/cycle'
import { getEnv } from '@/lib/env'

export const dynamic = 'force-dynamic'

function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) {
    return false
  }
  const left = Buffer.from(provided)
  const right = Buffer.from(expected)
  // Сравнение по длине сначала: timingSafeEqual бросает на разных размерах
  return left.length === right.length && timingSafeEqual(left, right)
}

/**
 * Догоняющий проход по незакрытым покупкам. Отдельно от прохода по подпискам: у тех свой
 * суточный ритм, а деньги, о которых мы не узнали, ждать сутки не должны.
 */
export async function POST(request: NextRequest) {
  const expected = getEnv().CRON_SECRET
  if (!expected) {
    return Response.json({ error: 'not configured' }, { status: 404 })
  }
  if (!secretMatches(request.headers.get('x-cron-secret'), expected)) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  const report = await sweepPendingPurchases()
  return Response.json({ ok: true, ...report })
}
