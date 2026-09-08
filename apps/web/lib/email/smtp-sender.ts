import nodemailer from 'nodemailer'
import type { EmailSender } from './sender'

/**
 * Таймауты обязательны. По умолчанию nodemailer ждёт две минуты, а отправка письма о
 * подтверждении почты происходит внутри запроса на регистрацию: если почтовый порт закрыт
 * или сервер не отвечает, форма молча висит эти две минуты и потом бодро сообщает, что письмо
 * ушло. Локально этого не увидеть — Mailpit отвечает мгновенно.
 */
const TIMEOUTS = {
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 20_000,
}

export function createSmtpSender(smtpUrl: string, from: string): EmailSender {
  const transport = nodemailer.createTransport({ url: smtpUrl, ...TIMEOUTS })
  return {
    async send(message) {
      await transport.sendMail({ from, ...message })
    },
  }
}
