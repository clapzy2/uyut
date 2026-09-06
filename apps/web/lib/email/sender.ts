export type EmailMessage = {
  to: string
  subject: string
  text: string
  html?: string
}

// Порт: приложение знает только этот интерфейс, транспорт подставляется по окружению
export interface EmailSender {
  send(message: EmailMessage): Promise<void>
}
