const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://localhost:8025'

type SearchResponse = { messages: Array<{ ID: string; Subject: string }> }
type MessageResponse = { Text: string; HTML: string; Subject: string }

export type CapturedEmail = { subject: string; text: string; html: string }

// Ждём письмо адресату; Mailpit отдаёт его через REST без всякой авторизации
export async function waitForEmail(
  to: string,
  options: { subjectIncludes?: string; timeoutMs?: number } = {},
): Promise<CapturedEmail> {
  const deadline = Date.now() + (options.timeoutMs ?? 15_000)
  const query = encodeURIComponent(`to:${to}`)
  while (Date.now() < deadline) {
    const search = (await fetch(`${MAILPIT_URL}/api/v1/search?query=${query}&limit=10`).then((r) =>
      r.json(),
    )) as SearchResponse
    const match = search.messages.find(
      (m) => !options.subjectIncludes || m.Subject.includes(options.subjectIncludes),
    )
    if (match) {
      const message = (await fetch(`${MAILPIT_URL}/api/v1/message/${match.ID}`).then((r) =>
        r.json(),
      )) as MessageResponse
      return { subject: message.Subject, text: message.Text, html: message.HTML }
    }
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  throw new Error(`Письмо для ${to} не пришло за отведённое время`)
}

export function extractLink(text: string, pathIncludes: string): string {
  const links = text.match(/https?:\/\/[^\s<>"]+/g) ?? []
  const link = links.find((candidate) => candidate.includes(pathIncludes))
  if (!link) {
    throw new Error(`В письме нет ссылки с «${pathIncludes}»`)
  }
  return link
}
