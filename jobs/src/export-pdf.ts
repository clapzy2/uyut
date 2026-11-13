import { createHash } from 'node:crypto'
import { logger, metadata, task } from '@trigger.dev/sdk'
import { briefHash, createFalBriefGenerator } from '@uyut/ai'
import type { WorksRates } from '@uyut/catalog'
import { type ContractorBrief, projectExports } from '@uyut/db'
import { fontFaceCss, renderProjectHtml } from '@uyut/pdf'
import { and, desc, eq, isNotNull, isNull, ne } from 'drizzle-orm'
import { z } from 'zod'
import { db } from './lib/db'
import { optionalEnv, requireEnv } from './lib/env'

import { briefInput, buildPdfData, loadSnapshot } from './lib/pdf-data'
import { printPdf } from './lib/print-pdf'
import { putObject } from './lib/s3'

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
    if (row.status === 'ready' && row.pdfKey) {
      return { exportId, pdfKey: row.pdfKey, pages: row.pages, durationMs: row.durationMs }
    }
    if (row.pdfKey) {
      throw new Error('PDF уже подготовлен. Проверьте сохранённый результат перед повтором.')
    }
    const [claimed] = await database
      .update(projectExports)
      .set({ status: 'running' })
      .where(and(eq(projectExports.id, exportId), ne(projectExports.status, 'ready')))
      .returning({ id: projectExports.id })
    if (!claimed) {
      const [saved] = await database
        .select()
        .from(projectExports)
        .where(eq(projectExports.id, exportId))
        .limit(1)
      if (saved?.status === 'ready' && saved.pdfKey) {
        return { exportId, pdfKey: saved.pdfKey, pages: saved.pages, durationMs: saved.durationMs }
      }
      throw new Error(`не удалось начать экспорт ${exportId}: проверьте сохранённый результат`)
    }

    let uploadPrepared = false
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
        if (row.kind === 'paid') {
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
      const digest = createHash('sha256').update(pdf).digest('hex')
      const pdfKey = `projects/${row.projectId}/exports/${exportId}-${digest}.pdf`
      const pages = countPages(pdf)
      if (pages < 1) throw new Error('В PDF не найдены страницы')
      // Контрольная запись связывает именно эти байты с экспортом. При потере
      // ответа о загрузке сайт сможет проверить файл без повторной подготовки.
      uploadPrepared = true
      const [prepared] = await database
        .update(projectExports)
        .set({
          status: 'running',
          pdfKey,
          brief: briefResult.brief,
          contentHash: hash,
          pages,
          durationMs: null,
          finishedAt: null,
          error: null,
        })
        .where(
          and(
            eq(projectExports.id, exportId),
            eq(projectExports.status, 'running'),
            isNull(projectExports.pdfKey),
          ),
        )
        .returning({ id: projectExports.id })
      if (!prepared) throw new Error('Контрольная запись PDF изменилась. Проверьте результат.')
      // Ограничиваем передачу, оставляя время зафиксировать необходимость сверки:
      // потеря ответа не доказывает, что хранилище не приняло файл.
      await putObject(pdfKey, pdf, 'application/pdf', AbortSignal.timeout(60_000), {
        'export-id': exportId,
        'pdf-sha256': digest,
      })

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
          error: null,
        })
        .where(and(eq(projectExports.id, exportId), eq(projectExports.pdfKey, pdfKey)))
      // Файл уже сохранён: отказ уведомления о прогрессе не означает отказ сборки.
      try {
        publish('done')
        logger.info('pdf exported', { exportId, durationMs, pages, bytes: pdf.length })
      } catch (error) {
        console.warn('PDF сохранён, уведомление о завершении недоступно', exportId, error)
      }

      // Письмо после оплаты отправляет сайт, а не мы: адрес покупателя не должен покидать
      // Россию, а мы работаем за границей. Отсюда уходит только «экспорт такой-то готов».
      // Сборка уже удалась, поэтому сбой этого вызова только логируем.
      if (row.kind === 'paid') {
        try {
          const appUrl = requireEnv('APP_URL').replace(/\/$/, '')
          const response = await fetch(`${appUrl}/api/exports/ready`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-cron-secret': requireEnv('CRON_SECRET'),
            },
            body: JSON.stringify({ exportId }),
          })
          logger.info('project ready letter asked', { exportId, status: response.status })
        } catch (error) {
          logger.warn('project ready letter failed', { exportId, error: String(error) })
        }
      }
      return { exportId, pdfKey, pages, durationMs }
    } catch (error) {
      await database
        .update(projectExports)
        .set({
          status: uploadPrepared ? 'running' : 'failed',
          error: String(error).slice(0, 500),
          finishedAt: uploadPrepared ? null : new Date(),
        })
        .where(and(eq(projectExports.id, exportId), ne(projectExports.status, 'ready')))
      throw error
    }
  },
})
