import { getEnv } from '@/lib/env'
import { createFakePaymentProvider } from './fake-provider'
import type { PaymentProvider } from './provider'
import { createYooKassaProvider } from './yookassa'

let provider: PaymentProvider | undefined

// Без ключей магазина работает фейковый провайдер: успех сразу, без редиректа. Так живут dev и CI.
export function getPaymentProvider(): PaymentProvider {
  if (!provider) {
    const env = getEnv()
    if (env.YUKASSA_SHOP_ID && env.YUKASSA_SECRET_KEY) {
      provider = createYooKassaProvider({
        shopId: env.YUKASSA_SHOP_ID,
        secretKey: env.YUKASSA_SECRET_KEY,
        apiUrl: env.YUKASSA_API_URL,
      })
    } else {
      // В бою подмена молчаливая и дорогая: фейк отвечает «оплачено» без списания, и сервис
      // начинает раздавать проекты даром, ничем этого не показывая. Лучше честно не стартовать.
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          'YUKASSA_SHOP_ID и YUKASSA_SECRET_KEY обязательны в production: без них оплата стала бы бесплатной',
        )
      }
      provider = createFakePaymentProvider()
    }
  }
  return provider
}

export type { CreatePaymentInput, Payment, PaymentProvider, PaymentStatus } from './provider'
export { isYooKassaAddress, YooKassaError } from './yookassa'
