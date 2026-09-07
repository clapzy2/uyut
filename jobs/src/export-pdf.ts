import { logger, metadata, task } from '@trigger.dev/sdk'
import { briefHash, createFalBriefGenerator } from '@uyut/ai'
import type { WorksRates } from '@uyut/catalog'
import { type ContractorBrief, projectExports } from '@uyut/db'
import { fontFaceCss, footerTemplate, renderProjectHtml } from '@uyut/pdf'
import { and, desc, eq, isNotNull, ne } from 'drizzle-orm'
import { chromium } from 'playwright'
import { z } from 'zod'
import { db } from './lib/db'
import { optionalEnv } from './lib/env'
import { projectReadyLetter, sendMail } from './lib/mail'
import { briefInput, buildPdfData, loadSnapshot } from './lib/pdf-data'
import { presignedUrl, putObject } from './lib/s3'

const payloadSchema = z.object({ exportId: z.uuid() })

export type ExportPdfPayload = z.input<typeof payloadSchema>

/** Этапы для страницы итогов: ТЗ → вёрстка → печать → файл */
export type ExportStage = 'collect' | 'brief' | 'layout' | 'print' | 'upload' | 'done'

function publish(stage: ExportStage): void {
  metadata.set('progress', { stage })
}

function rates(): WorksRates {
  const rough = Number(optionalEnv('WORKS_ROUGH_RUB_PER_M2') ?? 15_000)
  const finish = Number(optionalEnv('WORKS_FINISH_RUB_PER_M2') ?? 5_000)
  return {
    roughRubPerM2: Number.isFinite(rough) && rough > 0 ? rough : 15_000,
    finishRubPerM2: Number.isFinite(finish) && finish > 0 ? finish : 5_000,
  }
}

/** ТЗ прошлого экспорта с теми же входными данными: модель не вызывается повторно */
async function cachedBrief(
  database: ReturnType<typeof db>,
  projectId: string,
  hash: string,
  exceptId: string,
): Promise<ContractorBrief | null> {
  const [row] = await database
    .select({ brief: projectExports.brief })
    .from(projectExports)
    .where(
      and(
        eq(projectExports.projectId, projectId),
        eq(projectExports.contentHash, hash),
        isNotNull(projectExports.brief),
        ne(projectExports.id, exceptId),
      ),
    )
    .orderBy(desc(projectExports.createdAt))
    .limit(1)
  return row?.brief ?? null
}

async function printPdf(html: string, title: string): Promise<Buffer> {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'load' })
    await page.emulateMedia({ media: 'print' })
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: footerTemplate(title),
    })
  } finally {
    await browser.close()
  }
}

// Число страниц по объектам /Type /Page в файле; для отчёта и P95 точности хватает
function countPages(pdf: Buffer): number {
  const matches = pdf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g)
  return matches ? matches.length : 0
}

export const exportPdf = task({
  id: 'export-pdf',
  maxDuration: 300,
  retry: { maxAttempts: 1 },
  run: async (raw: ExportPdfPayload) => {
    const { exportId } = payloadSchema.parse(raw)
    const database = db()
    const started = Date.now()
    const [row] = await database
      .select()
      .from(projectExports)
      .where(eq(projectExports.id, exportId))
      .limit(1)
    if (!row) {
      throw new Error(`экспорт ${exportId} не найден`)
    }
    await database
      .update(projectExports)
      .set({ status: 'running' })
      .where(eq(projectExports.id, exportId))

    try {
      publish('collect')
      const snapshot = await loadSnapshot(row.projectId)
      if (!snapshot) {
        throw new Error('проект не найден')
      }
      const input = briefInput(snapshot)
      const hash = briefHash(input)
      const falKey = optionalEnv('FAL_KEY')

      // ТЗ считается параллельно с картинками: модель — самая долгая часть экспорта
      const briefPromise = (async (): Promise<{
        brief: ContractorBrief | null
        error?: string
      }> => {
        const cached = await cachedBrief(database, row.projectId, hash, exportId)
        if (cached) {
          logger.info('brief reused from cache', { hash })
          return { brief: cached }
        }
        if (!falKey) {
          return { brief: null, error: 'нет FAL_KEY' }
        }
        publish('brief')
        try {
          return { brief: await createFalBriefGenerator(falKey)(input) }
        } catch (error) {
          return { brief: null, error: String(error) }
        }
      })()
      const dataPromise = buildPdfData({
        snapshot,
        kind: row.kind,
        options: row.options ?? {},
        rates: rates(),
        brief: null,
        summary: null,
      })
      const [briefResult, data] = await Promise.all([briefPromise, dataPromise])
      if (!briefResult.brief && briefResult.error) {
        // Бесплатный предпросмотр выходит без ТЗ, оплаченный документ без ТЗ отдавать нельзя
        if (row.kind === 'paid' && falKey) {
          throw new Error(`ТЗ не собралось: ${briefResult.error}`)
        }
        logger.warn('pdf without brief', { exportId, error: briefResult.error })
      }
      data.brief = briefResult.brief
      data.summary = briefResult.brief?.summary ?? null

      publish('layout')
      const html = renderProjectHtml(data, { fontCss: fontFaceCss() })
      publish('print')
      const pdf = await printPdf(html, data.project.title)
      publish('upload')
      const pdfKey = `projects/${row.projectId}/exports/${exportId}.pdf`
      await putObject(pdfKey, pdf, 'application/pdf')

      const pages = countPages(pdf)
      const durationMs = Date.now() - started
      await database
        .update(projectExports)
        .set({
          status: 'ready',
          pdfKey,
          brief: briefResult.brief,
          contentHash: hash,
          pages,
          durationMs,
          finishedAt: new Date(),
        })
        .where(eq(projectExports.id, exportId))
      publish('done')
      logger.info('pdf exported', { exportId, durationMs, pages, bytes: pdf.length })

      // Письмо со ссылкой после оплаты: сборка уже удалась, поэтому сбой почты только логируем
      const notifyEmail = row.options?.notifyEmail
      if (notifyEmail && row.kind === 'paid') {
        try {
          const ttlHours = Number(optionalEnv('PDF_URL_TTL_HOURS') ?? 168) || 168
          const appUrl = (optionalEnv('APP_URL') ?? 'https://uyut.ru').replace(/\/$/, '')
          const sent = await sendMail(
            notifyEmail,
            projectReadyLetter({
              projectTitle: data.project.title,
              pdfUrl: await presignedUrl(pdfKey, ttlHours * 60 * 60),
              summaryUrl: `${appUrl}/projects/${row.projectId}/summary`,
              ttlHours,
            }),
          )
          logger.info('project ready letter', { exportId, sent })
        } catch (error) {
          logger.warn('project ready letter failed', { exportId, error: String(error) })
        }
      }
      return { exportId, pdfKey, pages, durationMs }
    } catch (error) {
      await database
        .update(projectExports)
        .set({ status: 'failed', error: String(error).slice(0, 500), finishedAt: new Date() })
        .where(eq(projectExports.id, exportId))
      throw error
    }
  },
})
