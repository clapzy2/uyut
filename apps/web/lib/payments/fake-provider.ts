import { randomUUID } from 'node:crypto'
import type { ChargeSavedInput, CreatePaymentInput, Payment, PaymentProvider } from './provider'

// Отвечает успехом с небольшой задержкой, чтобы интерфейс проходил через состояние ожидания.
// Живёт в памяти процесса: без ключей магазина это dev и CI, где иного и не нужно.
export function createFakePaymentProvider(delayMs = 300): PaymentProvider {
  const payments = new Map<string, Payment>()
  const byIdempotencyKey = new Map<string, string>()

  return {
    name: 'fake',
    async createPayment(input: CreatePaymentInput): Promise<Payment> {
      const existingId = byIdempotencyKey.get(input.idempotencyKey)
      const existing = existingId ? payments.get(existingId) : undefined
      if (existing) {
        return existing
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs))
      const payment: Payment = {
        id: `fake_${randomUUID()}`,
        status: 'succeeded',
        paid: true,
        amountKopecks: input.amountKopecks,
        metadata: input.metadata ?? {},
        ...(input.savePaymentMethod ? { paymentMethodId: `fake_pm_${randomUUID()}` } : {}),
      }
      payments.set(payment.id, payment)
      byIdempotencyKey.set(input.idempotencyKey, payment.id)
      return payment
    },
    async chargeSaved(input: ChargeSavedInput): Promise<Payment> {
      const existingId = byIdempotencyKey.get(input.idempotencyKey)
      const existing = existingId ? payments.get(existingId) : undefined
      if (existing) {
        return existing
      }
      const payment: Payment = {
        id: `fake_${randomUUID()}`,
        status: 'succeeded',
        paid: true,
        amountKopecks: input.amountKopecks,
        metadata: input.metadata ?? {},
        paymentMethodId: input.paymentMethodId,
      }
      payments.set(payment.id, payment)
      byIdempotencyKey.set(input.idempotencyKey, payment.id)
      return payment
    },
    async getPayment(id: string): Promise<Payment | null> {
      return payments.get(id) ?? null
    },
  }
}
