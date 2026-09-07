import { getEnv } from '../env'
import type { EmailSender } from './sender'
import { createSmtpSender } from './smtp-sender'

let sender: EmailSender | undefined

export function getEmailSender(): EmailSender {
  if (!sender) {
    const env = getEnv()
    sender = createSmtpSender(env.SMTP_URL, env.EMAIL_FROM)
  }
  return sender
}

export type { EmailMessage, EmailSender } from './sender'
export { invitationLetter, passwordResetLetter, verificationLetter } from './templates'
