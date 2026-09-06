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
