import { describe, expect, it } from 'vitest'
import { createFakePaymentProvider } from './fake-provider'

const input = {
  amountKopecks: 150_000,
  description: 'Проект «Квартира на Ленина»',
  returnUrl: 'http://localhost:4300/projects',
  idempotencyKey: 'order-1',
}

describe('fake payment provider', () => {
  it('succeeds after a short delay and remembers the payment', async () => {
    const provider = createFakePaymentProvider(5)
    const payment = await provider.createPayment(input)
    expect(payment.status).toBe('succeeded')
    expect(payment.amountKopecks).toBe(150_000)
    expect(await provider.getPayment(payment.id)).toEqual(payment)
  })

  it('returns the same payment for the same idempotency key', async () => {
    const provider = createFakePaymentProvider(5)
    const first = await provider.createPayment(input)
    const second = await provider.createPayment(input)
    expect(second.id).toBe(first.id)
  })

  it('knows nothing about foreign ids', async () => {
    const provider = createFakePaymentProvider(5)
    expect(await provider.getPayment('fake_missing')).toBeNull()
  })
})
