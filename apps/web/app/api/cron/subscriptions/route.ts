import { timingSafeEqual } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { runSubscriptionCycle } from '@/lib/billing/cycle'
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
 * Дневной проход по подпискам живёт здесь, а не в воркере: списание проходит через ту же
 * applyPayment, что и обычная оплата, и остаётся единственным местом, где платёж становится фактом.
 * Будит маршрут расписание Trigger.dev, зная общий секрет.
 */
export async function POST(request: NextRequest) {
  const expected = getEnv().CRON_SECRET
  if (!expected) {
    return Response.json({ error: 'not configured' }, { status: 404 })
  }
  if (!secretMatches(request.headers.get('x-cron-secret'), expected)) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  const report = await runSubscriptionCycle()
  return Response.json({ ok: true, ...report })
}
