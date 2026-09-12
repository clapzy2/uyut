import 'server-only'

import { createFalPlanReader, type PlanReading } from '@uyut/ai'
import sharp from 'sharp'
import { getEnv } from '@/lib/env'
import { getObject } from '@/lib/storage'

export class PlanReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlanReadError'
  }
}

/**
 * Сторона картинки, которую отправляем модели. План хранится до 4000 пикселей, и в таком виде
 * он весит мегабайты: в base64 это лишние секунды на каждой отправке. На проверке чтение
 * не испортилось и на 900 пикселях, но там был чертёж, а не скан: две тысячи — запас под мелкие
 * цифры размерных линий на снятом телефоном листе.
 */
const READING_MAX_SIDE = 2000

/** Ссылку на план fal не откроет: bucket приватный, а подписанная ссылка живёт пятнадцать минут. */
async function planImage(key: string): Promise<{ body: Buffer; contentType: string }> {
  const object = await getObject(key)
  const body = await sharp(Buffer.from(object.body))
    .resize({ width: READING_MAX_SIDE, height: READING_MAX_SIDE, fit: 'inside' })
    .jpeg({ quality: 88 })
    .toBuffer()
  return { body, contentType: 'image/jpeg' }
}

export function planIsPdf(key: string): boolean {
  return key.toLowerCase().endsWith('.pdf')
}

export const PDF_PLAN_MESSAGE =
  'План лежит в PDF, а размеры мы читаем с картинки. Пришлите скриншот или фотографию плана — и мы прочитаем.'

export async function readPlanFromStorage(key: string): Promise<PlanReading> {
  if (planIsPdf(key)) {
    throw new PlanReadError(PDF_PLAN_MESSAGE)
  }
  const apiKey = getEnv().FAL_KEY
  if (!apiKey) {
    throw new PlanReadError('Чтение планов пока не подключено: в настройках сервиса нет ключа.')
  }
  let reading: PlanReading
  try {
    reading = await createFalPlanReader(apiKey)(await planImage(key))
  } catch (error) {
    console.error(error)
    throw new PlanReadError('Не получилось прочитать план. Попробуйте ещё раз через минуту.')
  }
  if (reading.rooms.length === 0) {
    throw new PlanReadError(
      'На плане не нашлось ни одного размера. Так бывает с рекламными планировками застройщика: на них есть названия комнат, но нет размерных линий. Впишите размеры руками.',
    )
  }
  return reading
}
