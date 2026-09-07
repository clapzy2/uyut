import { getEnv } from '@/lib/env'
import { createFakePaymentProvider } from './fake-provider'
import type { PaymentProvider } from './provider'
import { createYooKassaProvider } from './yookassa'

let provider: PaymentProvider | undefined

// Без ключей магазина работает фейковый провайдер: успех сразу, без редиректа. Так живут dev и CI.
export function getPaymentProvider(): PaymentProvider {
  if (!provider) {
    const env = getEnv()
    provider =
      env.YUKASSA_SHOP_ID && env.YUKASSA_SECRET_KEY
        ? createYooKassaProvider({
            shopId: env.YUKASSA_SHOP_ID,
            secretKey: env.YUKASSA_SECRET_KEY,
            apiUrl: env.YUKASSA_API_URL,
          })
        : createFakePaymentProvider()
  }
  return provider
}

export type { CreatePaymentInput, Payment, PaymentProvider, PaymentStatus } from './provider'
export { isYooKassaAddress, YooKassaError } from './yookassa'
