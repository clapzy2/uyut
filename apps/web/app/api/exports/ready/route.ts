import { timingSafeEqual } from 'node:crypto'
import { projectExports, projects } from '@uyut/db'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { userEmail } from '@/lib/billing/repository'
import { getDb } from '@/lib/db'
import { getEmailSender } from '@/lib/email'
import { projectReadyLetter } from '@/lib/email/templates'
import { getEnv } from '@/lib/env'
import { isUuid } from '@/lib/projects/access'
import { presignedObjectUrl } from '@/lib/storage'

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
 * Письмо о готовом проекте отправляет сервер, а не задача в очереди.
 *
 * Очередь Trigger.dev живёт за границей, и адрес почты покупателя туда попадать не должен —
 * так написано в нашей политике конфиденциальности. Поэтому задача, собрав PDF, только стучится
 * сюда с идентификатором экспорта, а кому писать, сервер выясняет сам и отправляет письмо из
 * России. Тем же секретом, что и дневной проход по подпискам: у воркера он уже есть.
 */
export async function POST(request: NextRequest) {
  const env = getEnv()
  if (!env.CRON_SECRET) {
    return Response.json({ error: 'not configured' }, { status: 404 })
  }
  if (!secretMatches(request.headers.get('x-cron-secret'), env.CRON_SECRET)) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }

  let exportId: unknown
  try {
    exportId = (await request.json())?.exportId
  } catch {
    return Response.json({ error: 'bad request' }, { status: 400 })
  }
  if (typeof exportId !== 'string' || !isUuid(exportId)) {
    return Response.json({ error: 'bad request' }, { status: 400 })
  }

  const [row] = await getDb()
    .select({
      kind: projectExports.kind,
      status: projectExports.status,
      pdfKey: projectExports.pdfKey,
      projectId: projectExports.projectId,
      projectTitle: projects.title,
      ownerId: projects.ownerId,
    })
    .from(projectExports)
    .innerJoin(projects, eq(projects.id, projectExports.projectId))
    .where(eq(projectExports.id, exportId))
    .limit(1)

  if (!row) {
    return Response.json({ error: 'not found' }, { status: 404 })
  }
  // Письмо полагается только за оплаченный документ и только когда он действительно собран
  if (row.kind !== 'paid' || row.status !== 'ready' || !row.pdfKey) {
    return Response.json({ sent: false, reason: 'not a ready paid export' })
  }

  const email = await userEmail(row.ownerId)
  if (!email) {
    return Response.json({ sent: false, reason: 'no email' })
  }

  const ttlHours = env.PDF_URL_TTL_HOURS
  const appUrl = env.APP_URL.replace(/\/$/, '')
  await getEmailSender().send({
    to: email,
    ...projectReadyLetter({
      projectTitle: row.projectTitle,
      pdfUrl: await presignedObjectUrl(row.pdfKey, ttlHours * 60 * 60),
      summaryUrl: `${appUrl}/projects/${row.projectId}/summary`,
      ttlHours,
    }),
  })
  return Response.json({ sent: true })
}
