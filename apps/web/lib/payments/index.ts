import { createFakePaymentProvider } from './fake-provider'
import type { PaymentProvider } from './provider'

let provider: PaymentProvider | undefined

export function getPaymentProvider(): PaymentProvider {
  provider ??= createFakePaymentProvider()
  return provider
}

export type { CreatePaymentInput, Payment, PaymentProvider, PaymentStatus } from './provider'
