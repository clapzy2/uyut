import type { CreatePaymentInput, Payment, PaymentProvider, PaymentStatus } from './provider'

export const YOOKASSA_API_URL = 'https://api.yookassa.ru/v3'

/** Подсети, с которых ЮKassa шлёт уведомления; список из документации, сверяется при настройке */
export const YOOKASSA_NOTIFICATION_CIDRS = [
  '185.71.76.0/27',
  '185.71.77.0/27',
  '77.75.153.0/25',
  '77.75.154.128/25',
  '77.75.156.11/32',
  '77.75.156.35/32',
  '2a02:5180::/32',
] as const

type YooAmount = { value: string; currency: string }

export type YooPayment = {
  id: string
  status: PaymentStatus
  paid: boolean
  amount: YooAmount
  confirmation?: { type: string; confirmation_url?: string }
  metadata?: Record<string, string>
  payment_method?: { id: string; saved?: boolean; type?: string }
}

export class YooKassaError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'YooKassaError'
  }
}

export function toRublesString(kopecks: number): string {
  const whole = Math.trunc(kopecks / 100)
  const rest = Math.abs(kopecks % 100)
  return `${whole}.${String(rest).padStart(2, '0')}`
}

export function fromRublesString(value: string): number {
  const [whole = '0', rest = ''] = value.split('.')
  return Number(whole) * 100 + Number(rest.padEnd(2, '0').slice(0, 2))
}

export function mapPayment(raw: YooPayment): Payment {
  return {
    id: raw.id,
    status: raw.status,
    amountKopecks: fromRublesString(raw.amount.value),
    paid: raw.paid,
    confirmationUrl: raw.confirmation?.confirmation_url,
    metadata: raw.metadata ?? {},
    paymentMethodId: raw.payment_method?.saved ? raw.payment_method.id : undefined,
  }
}

type Fetch = typeof fetch

export type YooKassaOptions = {
  shopId: string
  secretKey: string
  apiUrl?: string
  fetchImpl?: Fetch
}

/**
 * Клиент API ЮKassa на fetch: два запроса, которые нужны приёму оплаты.
 * Аутентификация — Basic с shopId и секретным ключом, повтор запроса защищён Idempotence-Key.
 */
export function createYooKassaProvider(options: YooKassaOptions): PaymentProvider {
  const apiUrl = (options.apiUrl ?? YOOKASSA_API_URL).replace(/\/$/, '')
  const fetchImpl = options.fetchImpl ?? fetch
  const authorization = `Basic ${Buffer.from(`${options.shopId}:${options.secretKey}`).toString('base64')}`

  async function request<T>(
    path: string,
    init: { method: 'GET' | 'POST'; body?: unknown; idempotencyKey?: string },
  ): Promise<T> {
    const headers: Record<string, string> = {
      authorization,
      accept: 'application/json',
    }
    if (init.body !== undefined) {
      headers['content-type'] = 'application/json'
    }
    if (init.idempotencyKey) {
      headers['idempotence-key'] = init.idempotencyKey
    }
    const response = await fetchImpl(`${apiUrl}${path}`, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(15_000),
    })
    const text = await response.text()
    const data = text ? (JSON.parse(text) as Record<string, unknown>) : {}
    if (!response.ok) {
      throw new YooKassaError(
        response.status,
        String(data.code ?? 'unknown'),
        String(data.description ?? `ЮKassa ответила ${response.status}`),
      )
    }
    return data as T
  }

  return {
    name: 'yookassa',
    async createPayment(input: CreatePaymentInput): Promise<Payment> {
      const raw = await request<YooPayment>('/payments', {
        method: 'POST',
        idempotencyKey: input.idempotencyKey,
        body: {
          amount: { value: toRublesString(input.amountKopecks), currency: 'RUB' },
          capture: true,
          confirmation: { type: 'redirect', return_url: input.returnUrl },
          description: input.description.slice(0, 128),
          metadata: input.metadata ?? {},
          ...(input.savePaymentMethod ? { save_payment_method: true } : {}),
        },
      })
      return mapPayment(raw)
    },
    async getPayment(id: string): Promise<Payment | null> {
      try {
        const raw = await request<YooPayment>(`/payments/${encodeURIComponent(id)}`, {
          method: 'GET',
        })
        return mapPayment(raw)
      } catch (error) {
        if (error instanceof YooKassaError && error.status === 404) {
          return null
        }
        throw error
      }
    },
  }
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.').map(Number)
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return null
  }
  return (
    ((parts[0] ?? 0) << 24) + ((parts[1] ?? 0) << 16) + ((parts[2] ?? 0) << 8) + (parts[3] ?? 0)
  )
}

function ipv6Prefix(ip: string): string | null {
  const lower = ip.toLowerCase()
  if (!lower.includes(':')) {
    return null
  }
  const [first = ''] = lower.split(':')
  return first
}

/** Уведомление пришло с адреса ЮKassa: проверка по подсетям из документации */
export function isYooKassaAddress(
  ip: string,
  cidrs: readonly string[] = YOOKASSA_NOTIFICATION_CIDRS,
): boolean {
  const asInt = ipv4ToInt(ip)
  if (asInt !== null) {
    return cidrs.some((cidr) => {
      const [base, bitsText] = cidr.split('/')
      if (!base || base.includes(':')) {
        return false
      }
      const baseInt = ipv4ToInt(base)
      const bits = Number(bitsText ?? 32)
      if (baseInt === null || !Number.isInteger(bits)) {
        return false
      }
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
      return ((asInt >>> 0) & mask) === ((baseInt >>> 0) & mask)
    })
  }
  const prefix = ipv6Prefix(ip)
  if (prefix === null) {
    return false
  }
  // Единственная подсеть IPv6 — 2a02:5180::/32, то есть первые 32 бита: два первых блока
  return cidrs.some((cidr) => {
    const [base] = cidr.split('/')
    if (!base?.includes(':')) {
      return false
    }
    const [first = '', second = ''] = base.toLowerCase().split(':')
    const [ipFirst = '', ipSecond = ''] = ip.toLowerCase().split(':')
    return first === ipFirst && second === ipSecond
  })
}
