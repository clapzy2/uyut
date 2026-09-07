export type PaymentStatus = 'pending' | 'waiting_for_capture' | 'succeeded' | 'canceled'

export type CreatePaymentInput = {
  amountKopecks: number
  description: string
  // Куда вернуть пользователя после оплаты у провайдера
  returnUrl: string
  idempotencyKey: string
  /** Наши идентификаторы: провайдер вернёт их в объекте платежа и в уведомлении */
  metadata?: Record<string, string>
  /** Сохранить способ оплаты для будущих списаний подписки */
  savePaymentMethod?: boolean
}

/** Списание по ранее сохранённому способу оплаты: без участия плательщика и без страницы оплаты */
export type ChargeSavedInput = {
  amountKopecks: number
  description: string
  paymentMethodId: string
  idempotencyKey: string
  metadata?: Record<string, string>
}

export type Payment = {
  id: string
  status: PaymentStatus
  amountKopecks: number
  paid: boolean
  // Страница оплаты у провайдера; у фейкового провайдера отсутствует
  confirmationUrl?: string
  metadata: Record<string, string>
  /** Сохранённый способ оплаты, если провайдер его вернул */
  paymentMethodId?: string
}

// Порт платёжного провайдера: ЮKassa в бою, фейк без ключей и в CI
export interface PaymentProvider {
  readonly name: 'yookassa' | 'fake'
  createPayment(input: CreatePaymentInput): Promise<Payment>
  chargeSaved(input: ChargeSavedInput): Promise<Payment>
  getPayment(id: string): Promise<Payment | null>
}
