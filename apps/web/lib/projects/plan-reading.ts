import 'server-only'

import { createFalPlanReader, type PlanReading } from '@uyut/ai'
import { getEnv } from '@/lib/env'
import { getObject } from '@/lib/storage'
import { PlanReadError, preparePlanPage } from './plan-document'

export { PlanReadError } from './plan-document'

/** Один выбранный лист — один AI-запрос. Проектные и обмерные листы не объединяем. */
export async function readPlanFromStorage(key: string, pageNumber = 1): Promise<PlanReading> {
  const apiKey = getEnv().FAL_KEY
  if (!apiKey) {
    throw new PlanReadError('Чтение планов пока не подключено: в настройках сервиса нет ключа.')
  }
  try {
    const object = await getObject(key)
    const page = await preparePlanPage(
      Buffer.from(object.body),
      key.toLowerCase().endsWith('.pdf'),
      pageNumber,
    )
    const reading = await createFalPlanReader(apiKey)(page.image)
    if (reading.rooms.length === 0) {
      throw new PlanReadError(
        'Не удалось уверенно прочитать помещения на выбранном листе. Проверьте номер страницы или впишите данные вручную.',
      )
    }
    // Не перечитываем автоматически каждую сторону и не заменяем числа расчётом из площади.
    // Даже правильная площадь непрямоугольного помещения не доказывает его габариты.
    return { ...reading, sourcePage: page.pageNumber, pageCount: page.pageCount }
  } catch (error) {
    if (error instanceof PlanReadError) throw error
    console.error(error)
    throw new PlanReadError('Не получилось прочитать план. Проверьте файл и доступность сервиса.')
  }
}
