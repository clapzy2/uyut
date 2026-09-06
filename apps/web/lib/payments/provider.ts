export type PaymentStatus = 'pending' | 'succeeded' | 'canceled'

export type CreatePaymentInput = {
  amountKopecks: number
  description: string
  // Куда вернуть пользователя после оплаты у провайдера
  returnUrl: string
  idempotencyKey: string
}

export type Payment = {
  id: string
  status: PaymentStatus
  amountKopecks: number
  // Страница оплаты у провайдера; у фейкового провайдера отсутствует
  confirmationUrl?: string
}

// Порт платёжного провайдера. Реальная ЮKassa появится в фазе доставки проекта.
export interface PaymentProvider {
  createPayment(input: CreatePaymentInput): Promise<Payment>
  getPayment(id: string): Promise<Payment | null>
}
