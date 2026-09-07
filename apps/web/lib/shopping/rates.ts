import type { WorksRates } from '@uyut/catalog'
import { getEnv } from '@/lib/env'

/** Ставки работ из окружения; по умолчанию 15 000 и 5 000 рублей за м² */
export function getWorksRates(): WorksRates {
  const env = getEnv()
  return {
    roughRubPerM2: env.WORKS_ROUGH_RUB_PER_M2,
    finishRubPerM2: env.WORKS_FINISH_RUB_PER_M2,
  }
}
