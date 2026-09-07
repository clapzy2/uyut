import nodemailer, { type Transporter } from 'nodemailer'
import { optionalEnv } from './env'

type Letter = { subject: string; text: string; html: string }

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Тот же тихий стиль, что у писем регистрации: серифный текст, одна ссылка, без баннеров
function letter(
  subject: string,
  paragraphs: string[],
  links: Array<{ url: string; text: string }>,
): Letter {
  const text = [...paragraphs, ...links.map((link) => `${link.text}: ${link.url}`)].join('\n\n')
  const html = [
    '<div style="font-family: Georgia, serif; font-size: 17px; line-height: 1.55; color: #262220; max-width: 36em;">',
    ...paragraphs.map((p) => `<p style="margin: 0 0 1em;">${escapeHtml(p)}</p>`),
    ...links.map(
      (link) =>
        `<p style="margin: 1.5em 0 0;"><a href="${link.url}" style="color: #7c2f3b;">${escapeHtml(link.text)}</a></p>`,
    ),
    `<p style="margin: 2em 0 0; font-size: 14px; color: #6d6656;">Если ссылка не открывается, скопируйте её в адресную строку:<br>${links.map((link) => link.url).join('<br>')}</p>`,
    '</div>',
  ].join('')
  return { subject, text, html }
}

export function projectReadyLetter(input: {
  projectTitle: string
  pdfUrl: string
  summaryUrl: string
  ttlHours: number
}): Letter {
  const days = Math.max(1, Math.round(input.ttlHours / 24))
  return letter(
    `Проект «${input.projectTitle}» готов`,
    [
      `Оплата прошла, и документ собран: обложка, комнаты, список покупок, смета и задание для бригады — без водяного знака.`,
      `Прямая ссылка на PDF работает ${days} ${days === 1 ? 'день' : days < 5 ? 'дня' : 'дней'}. Позже файл всегда можно скачать заново со страницы итогов проекта.`,
    ],
    [
      { url: input.pdfUrl, text: 'Скачать PDF' },
      { url: input.summaryUrl, text: 'Открыть итоги проекта' },
    ],
  )
}

let transport: Transporter | undefined

/** Письмо уходит через тот же SMTP, что и письма о регистрации; без SMTP_URL молча пропускаем */
export async function sendMail(to: string, mail: Letter): Promise<boolean> {
  const smtpUrl = optionalEnv('SMTP_URL')
  const from = optionalEnv('EMAIL_FROM')
  if (!smtpUrl || !from) {
    return false
  }
  transport ??= nodemailer.createTransport(smtpUrl)
  await transport.sendMail({ from, to, ...mail })
  return true
}
