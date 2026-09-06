import { randomUUID } from 'node:crypto'
import type { CreatePaymentInput, Payment, PaymentProvider } from './provider'

// Отвечает успехом с небольшой задержкой, чтобы интерфейс проходил через состояние ожидания
export function createFakePaymentProvider(delayMs = 300): PaymentProvider {
  const payments = new Map<string, Payment>()
  const byIdempotencyKey = new Map<string, string>()

  return {
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
        amountKopecks: input.amountKopecks,
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
