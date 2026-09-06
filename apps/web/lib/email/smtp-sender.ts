import nodemailer from 'nodemailer'
import type { EmailSender } from './sender'

export function createSmtpSender(smtpUrl: string, from: string): EmailSender {
  const transport = nodemailer.createTransport(smtpUrl)
  return {
    async send(message) {
      await transport.sendMail({ from, ...message })
    },
  }
}
