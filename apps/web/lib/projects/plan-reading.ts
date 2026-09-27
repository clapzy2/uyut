import 'server-only'

import { createHash } from 'node:crypto'
import { createFalPlanReader, type PlanReading, planMeasurementTextItems } from '@uyut/ai'
import { getEnv } from '@/lib/env'
import { getObject } from '@/lib/storage'
import { PlanReadError, preparePlanPage } from './plan-document'
import { type PdfRoomContours, pdfContourIssue } from './plan-pdf-room-binding'
import { verifyPlanReadingGeometry } from './plan-reading-geometry'

export { PlanReadError } from './plan-document'

/** Один выбранный лист — один AI-запрос. Проектные и обмерные листы не объединяем. */
export async function readPlanFromStorage(
  key: string,
  pageNumber = 1,
  reviewedContours?: PdfRoomContours,
): Promise<PlanReading> {
  const apiKey = getEnv().FAL_KEY
  if (!apiKey) {
    throw new PlanReadError('Чтение планов пока не подключено: в настройках сервиса нет ключа.')
  }
  try {
    const object = await getObject(key)
    const body = Buffer.from(object.body)
    const isPdf = key.toLowerCase().endsWith('.pdf')
    const sha256 = reviewedContours ? createHash('sha256').update(body).digest('hex') : undefined
    if (
      reviewedContours &&
      (!isPdf ||
        sha256 !== reviewedContours.source.sha256 ||
        pageNumber !== reviewedContours.source.pdfPage)
    )
      throw new PlanReadError(
        'Разметка относится к другому файлу или листу. Сверьте исходный план перед чтением.',
      )
    const page = await preparePlanPage(body, isPdf, pageNumber, reviewedContours !== undefined)
    if (reviewedContours) {
      const labels = planMeasurementTextItems(page.image.planText)
      if (
        !page.linework ||
        page.linework.paths.length === 0 ||
        !labels?.some((label) => label.text.trim() !== '') ||
        reviewedContours.rooms.length === 0 ||
        page.pageNumber !== pageNumber
      )
        throw new PlanReadError(
          'Для сверки разметки нужны нативные линии и подписи выбранного PDF-листа. Используйте обычное чтение или уточните источник.',
        )
      const issue = pdfContourIssue(
        page.linework,
        { ...reviewedContours.source, sha256: sha256 ?? '', pdfPage: page.pageNumber },
        reviewedContours,
      )
      if (issue)
        throw new PlanReadError(
          'Разметка или векторный слой требуют уточнения. Чтение не запущено; проверьте контуры выбранного листа.',
        )
    }
    const reading = await createFalPlanReader(apiKey)(page.image)
    if (reading.rooms.length === 0) {
      throw new PlanReadError(
        'Не удалось уверенно прочитать помещения на выбранном листе. Проверьте номер страницы или впишите данные вручную.',
      )
    }
    // Не перечитываем автоматически каждую сторону и не заменяем числа расчётом из площади.
    // Даже правильная площадь непрямоугольного помещения не доказывает его габариты.
    const result = { ...reading, sourcePage: page.pageNumber, pageCount: page.pageCount }
    if (!reviewedContours || !page.linework || !sha256) return result
    return verifyPlanReadingGeometry(result, {
      source: { sha256, pdfPage: page.pageNumber, state: reviewedContours.source.state },
      linework: page.linework,
      planText: page.image.planText,
      contours: reviewedContours,
    })
  } catch (error) {
    if (error instanceof PlanReadError) throw error
    console.error(error)
    throw new PlanReadError('Не получилось прочитать план. Проверьте файл и доступность сервиса.')
  }
}
