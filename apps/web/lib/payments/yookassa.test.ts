import { describe, expect, it } from 'vitest'
import {
  createYooKassaProvider,
  fromRublesString,
  isYooKassaAddress,
  mapPayment,
  toRublesString,
  YooKassaError,
} from './yookassa'

type Call = { url: string; init: RequestInit }

function fakeFetch(handler: (call: Call) => { status: number; body: unknown }) {
  const calls: Call[] = []
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} }
    calls.push(call)
    const { status, body } = handler(call)
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
  return { fetchImpl, calls }
}

describe('yookassa client', () => {
  it('formats amounts as rubles with two decimals and back', () => {
    expect(toRublesString(150_000)).toBe('1500.00')
    expect(toRublesString(99_900)).toBe('999.00')
    expect(toRublesString(1_05)).toBe('1.05')
    expect(fromRublesString('1500.00')).toBe(150_000)
    expect(fromRublesString('999.5')).toBe(99_950)
    expect(fromRublesString('12')).toBe(1_200)
  })

  it('charges a saved method without asking the payer anything', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 200,
      body: {
        id: 'pay_auto',
        status: 'succeeded',
        paid: true,
        amount: { value: '999.00', currency: 'RUB' },
        payment_method: { id: 'pm_saved', saved: true, type: 'bank_card' },
        metadata: { purchaseId: 'p9' },
      },
    }))
    const provider = createYooKassaProvider({
      shopId: '123',
      secretKey: 'test_key',
      apiUrl: 'https://api.test/v3',
      fetchImpl,
    })
    const payment = await provider.chargeSaved({
      amountKopecks: 99_900,
      description: 'Uyut Pro, один месяц',
      paymentMethodId: 'pm_saved',
      idempotencyKey: 'p9',
      metadata: { purchaseId: 'p9' },
    })
    expect(payment.status).toBe('succeeded')
    expect(payment.amountKopecks).toBe(99_900)
    expect(payment.paymentMethodId).toBe('pm_saved')

    const body = JSON.parse(String(calls[0]?.init.body))
    expect(body.payment_method_id).toBe('pm_saved')
    expect(body.capture).toBe(true)
    // Блок confirmation превратил бы списание в обычный платёж со страницей оплаты
    expect(body.confirmation).toBeUndefined()
    expect(calls[0]?.init.headers).toMatchObject({ 'idempotence-key': 'p9' })
  })

  it('creates a payment with basic auth, an idempotence key and a redirect confirmation', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 200,
      body: {
        id: 'pay_1',
        status: 'pending',
        paid: false,
        amount: { value: '1500.00', currency: 'RUB' },
        confirmation: { type: 'redirect', confirmation_url: 'https://yookassa.ru/pay/1' },
        metadata: { purchaseId: 'p1' },
      },
    }))
    const provider = createYooKassaProvider({
      shopId: '123',
      secretKey: 'test_key',
      apiUrl: 'https://api.test/v3/',
      fetchImpl,
    })
    const payment = await provider.createPayment({
      amountKopecks: 150_000,
      description: 'Проект «Квартира на Мира»',
      returnUrl: 'http://localhost:4300/projects/x/summary?payment=p1',
      idempotencyKey: 'p1',
      metadata: { purchaseId: 'p1' },
    })
    expect(payment).toEqual({
      id: 'pay_1',
      status: 'pending',
      amountKopecks: 150_000,
      paid: false,
      confirmationUrl: 'https://yookassa.ru/pay/1',
      metadata: { purchaseId: 'p1' },
      paymentMethodId: undefined,
    })
    const call = calls[0]
    expect(call?.url).toBe('https://api.test/v3/payments')
    const headers = call?.init.headers as Record<string, string>
    expect(headers.authorization).toBe(`Basic ${Buffer.from('123:test_key').toString('base64')}`)
    expect(headers['idempotence-key']).toBe('p1')
    const body = JSON.parse(String(call?.init.body)) as Record<string, unknown>
    expect(body.amount).toEqual({ value: '1500.00', currency: 'RUB' })
    expect(body.capture).toBe(true)
    expect(body.confirmation).toEqual({
      type: 'redirect',
      return_url: 'http://localhost:4300/projects/x/summary?payment=p1',
    })
    expect(body.save_payment_method).toBeUndefined()
  })

  it('asks to save the payment method for subscriptions and reads it back', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 200,
      body: {
        id: 'pay_2',
        status: 'succeeded',
        paid: true,
        amount: { value: '999.00', currency: 'RUB' },
        payment_method: { id: 'pm_1', saved: true, type: 'bank_card' },
      },
    }))
    const provider = createYooKassaProvider({ shopId: '1', secretKey: 'k', fetchImpl })
    const payment = await provider.createPayment({
      amountKopecks: 99_900,
      description: 'Pro',
      returnUrl: 'http://localhost/return',
      idempotencyKey: 'sub-1',
      savePaymentMethod: true,
    })
    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>
    expect(body.save_payment_method).toBe(true)
    expect(payment.paymentMethodId).toBe('pm_1')
    expect(payment.status).toBe('succeeded')
  })

  it('returns null for an unknown payment and throws on other errors', async () => {
    const { fetchImpl } = fakeFetch((call) =>
      call.url.endsWith('/payments/missing')
        ? { status: 404, body: { code: 'not_found', description: 'Payment not found' } }
        : { status: 401, body: { code: 'invalid_credentials', description: 'Bad auth' } },
    )
    const provider = createYooKassaProvider({ shopId: '1', secretKey: 'k', fetchImpl })
    expect(await provider.getPayment('missing')).toBeNull()
    await expect(provider.getPayment('other')).rejects.toBeInstanceOf(YooKassaError)
  })

  it('maps a raw payment without optional fields', () => {
    expect(
      mapPayment({
        id: 'x',
        status: 'canceled',
        paid: false,
        amount: { value: '10.00', currency: 'RUB' },
      }),
    ).toEqual({
      id: 'x',
      status: 'canceled',
      amountKopecks: 1_000,
      paid: false,
      confirmationUrl: undefined,
      metadata: {},
      paymentMethodId: undefined,
    })
  })

  it('recognises notification addresses by subnet', () => {
    expect(isYooKassaAddress('185.71.76.5')).toBe(true)
    expect(isYooKassaAddress('185.71.76.31')).toBe(true)
    expect(isYooKassaAddress('185.71.76.32')).toBe(false)
    expect(isYooKassaAddress('77.75.156.11')).toBe(true)
    expect(isYooKassaAddress('77.75.156.12')).toBe(false)
    expect(isYooKassaAddress('77.75.154.200')).toBe(true)
    expect(isYooKassaAddress('10.0.0.1')).toBe(false)
    expect(isYooKassaAddress('2a02:5180:0:1509::1')).toBe(true)
    expect(isYooKassaAddress('2a02:5181::1')).toBe(false)
    expect(isYooKassaAddress('not-an-ip')).toBe(false)
  })
})
