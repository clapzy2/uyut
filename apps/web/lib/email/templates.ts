import { formatPrice } from '@/lib/concepts/format'
import type { EmailMessage } from './sender'

type Letter = Omit<EmailMessage, 'to'>

function letter(subject: string, paragraphs: string[], url: string, linkText: string): Letter {
  const text = [...paragraphs, url].join('\n\n')
  const html = [
    '<div style="font-family: Georgia, serif; font-size: 17px; line-height: 1.55; color: #262220; max-width: 36em;">',
    ...paragraphs.map((p) => `<p style="margin: 0 0 1em;">${p}</p>`),
    `<p style="margin: 1.5em 0 0;"><a href="${url}" style="color: #7c2f3b;">${linkText}</a></p>`,
    `<p style="margin: 2em 0 0; font-size: 14px; color: #6d6656;">Если ссылка не открывается, скопируйте её в адресную строку:<br>${url}</p>`,
    '</div>',
  ].join('')
  return { subject, text, html }
}

export function verificationLetter(url: string): Letter {
  return letter(
    'Подтвердите почту в Uyut',
    ['Осталось подтвердить почту, и можно собирать первый проект. Ссылка работает сутки.'],
    url,
    'Подтвердить почту',
  )
}

export function passwordResetLetter(url: string): Letter {
  return letter(
    'Смена пароля в Uyut',
    [
      'Кто-то попросил сменить пароль от вашего аккаунта. Если это вы, перейдите по ссылке: она работает полчаса.',
      'Если это не вы, просто не открывайте ссылку. Пароль останется прежним.',
    ],
    url,
    'Задать новый пароль',
  )
}

export function invitationLetter(input: {
  inviterName: string
  projectTitle: string
  url: string
}): Letter {
  return letter(
    `${input.inviterName} зовёт вас в проект «${input.projectTitle}» в Uyut`,
    [
      `${input.inviterName} собирает интерьер квартиры в Uyut и хочет выбирать вдвоём: вы будете смотреть те же рендеры, отмечать, что нравится, а сервис покажет, где ваши вкусы совпали.`,
      'Ссылка работает неделю и открывает проект. Если вы не ждали этого письма, просто не открывайте его.',
    ],
    input.url,
    'Открыть проект',
  )
}

export function partnerJoinedLetter(input: {
  partnerName: string
  projectTitle: string
  url: string
}): Letter {
  return letter(
    `${input.partnerName} теперь в проекте «${input.projectTitle}»`,
    [
      `${input.partnerName} открыл(а) приглашение и уже может смотреть комнаты и отмечать концепты. Общие совпадения появятся на вкладке «Общие» у каждой комнаты.`,
    ],
    input.url,
    'Открыть проект',
  )
}

const dayMonth = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' })

export function proRenewalLetter(input: { periodEnd: Date; renewUrl: string }): Letter {
  const date = dayMonth.format(input.periodEnd)
  return letter(
    `Pro в Uyut заканчивается ${date}`,
    [
      `Оплаченный месяц Pro заканчивается ${date}. После этого проекты останутся на месте, но новые создать не получится, а PDF будет выходить с водяным знаком.`,
      'Продление занимает минуту: одна оплата, автосписаний по вашей подписке нет.',
    ],
    input.renewUrl,
    'Продлить Pro',
  )
}

export function proChargedLetter(input: {
  periodEnd: Date
  amountKopecks: number
  manageUrl: string
}): Letter {
  return letter(
    'Pro в Uyut продлён на месяц',
    [
      `Списали ${formatPrice(input.amountKopecks)} по сохранённой карте, Pro работает до ${dayMonth.format(input.periodEnd)}.`,
      'Если продлевать больше не нужно, отключите автопродление на странице проектов — следующее списание не пройдёт.',
    ],
    input.manageUrl,
    'Открыть проекты',
  )
}

/**
 * Письмо о готовом проекте отправляет сайт, а не задача в очереди. Очередь живёт за границей,
 * и адрес почты туда передавать нельзя — так написано в нашей политике. Задача только сообщает
 * серверу, что документ собран, а кому писать, сервер выясняет сам.
 *
 * Ссылок здесь две, поэтому общий letter() не подходит: он рассчитан на одну.
 */
export function projectReadyLetter(input: {
  projectTitle: string
  pdfUrl: string
  summaryUrl: string
  ttlHours: number
}): Letter {
  const days = Math.max(1, Math.round(input.ttlHours / 24))
  const word = days === 1 ? 'день' : days < 5 ? 'дня' : 'дней'
  const paragraphs = [
    'Оплата прошла, и документ собран: обложка, комнаты, список покупок, смета и задание для бригады — без водяного знака.',
    `Прямая ссылка на PDF работает ${days} ${word}. Позже файл всегда можно скачать заново со страницы итогов проекта.`,
  ]
  const links = [
    { url: input.pdfUrl, text: 'Скачать PDF' },
    { url: input.summaryUrl, text: 'Открыть итоги проекта' },
  ]
  return {
    subject: `Проект «${input.projectTitle}» готов`,
    text: [...paragraphs, ...links.map((link) => `${link.text}: ${link.url}`)].join('\n\n'),
    html: [
      '<div style="font-family: Georgia, serif; font-size: 17px; line-height: 1.55; color: #262220; max-width: 36em;">',
      ...paragraphs.map((p) => `<p style="margin: 0 0 1em;">${p}</p>`),
      ...links.map(
        (link) =>
          `<p style="margin: 1.5em 0 0;"><a href="${link.url}" style="color: #7c2f3b;">${link.text}</a></p>`,
      ),
      '</div>',
    ].join(''),
  }
}

export function proChargeFailedLetter(input: { periodEnd: Date; renewUrl: string }): Letter {
  return letter(
    'Не получилось продлить Pro',
    [
      `Мы трижды пробовали списать оплату по сохранённой карте, и банк её не пропустил. Pro действует до ${dayMonth.format(input.periodEnd)}, дальше проекты останутся на месте, но новые создать не получится, а PDF будет выходить с водяным знаком.`,
      'Чаще всего помогает оплата заново другой картой — она же станет сохранённой для следующих месяцев.',
    ],
    input.renewUrl,
    'Продлить Pro',
  )
}
