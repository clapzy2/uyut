import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AuthShell } from '@/components/auth-shell'
import { AcceptInviteForm } from '@/components/collaboration/accept-invite-form'
import { SignOutButton } from '@/components/sign-out-button'
import { findInvite, hasPassword } from '@/lib/collaboration/repository'
import { getSession } from '@/lib/session'

export const metadata: Metadata = { title: 'Приглашение в проект' }

type Params = Promise<{ token: string }>
type Search = Promise<{ error?: string }>

const TOKEN = /^[A-Za-z0-9_-]{16,128}$/

const linkClassName =
  'text-[15px] text-ink underline decoration-accent decoration-1 underline-offset-4'

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Params
  searchParams: Search
}) {
  const { token } = await params
  const { error } = await searchParams
  const session = await getSession()
  const invite = TOKEN.test(token) ? await findInvite(token) : null

  // Ссылка входа из письма живёт сутки, приглашение — неделю: без сессии объясняем, что делать
  if (!session) {
    if (error === 'link' && invite) {
      return (
        <AuthShell
          title="Ссылка для входа устарела."
          lede={`Она работала сутки. Попросите ${invite.inviterName} отправить приглашение в «${invite.projectTitle}» ещё раз, или войдите, если у вас уже есть аккаунт.`}
        >
          <Link href={`/login?next=/invites/${token}`} className={linkClassName}>
            Войти
          </Link>
        </AuthShell>
      )
    }
    redirect(`/login?next=/invites/${token}`)
  }

  if (!invite) {
    return (
      <AuthShell
        title="Ссылка не подошла."
        lede="Приглашения с таким адресом нет. Попросите владельца проекта отправить его ещё раз."
      >
        <Link href="/projects" className={linkClassName}>
          К проектам
        </Link>
      </AuthShell>
    )
  }

  if (invite.status === 'accepted') {
    if (invite.acceptedBy === session.user.id) {
      redirect(`/projects/${invite.projectId}`)
    }
    return (
      <AuthShell
        title="Приглашение уже использовано."
        lede={`Ссылку из письма уже открыли. Если это были не вы, попросите ${invite.inviterName} отправить новое приглашение.`}
      >
        <Link href="/projects" className={linkClassName}>
          К проектам
        </Link>
      </AuthShell>
    )
  }

  if (invite.status === 'expired') {
    return (
      <AuthShell
        title="Ссылка устарела."
        lede={`Приглашение в «${invite.projectTitle}» работало неделю. Попросите ${invite.inviterName} отправить новое.`}
      >
        <Link href="/projects" className={linkClassName}>
          К проектам
        </Link>
      </AuthShell>
    )
  }

  if (invite.status === 'closed') {
    return (
      <AuthShell
        title="Владелец закрыл проект."
        lede={`Проект «${invite.projectTitle}» удалён, приглашение больше не действует.`}
      >
        <Link href="/projects" className={linkClassName}>
          К проектам
        </Link>
      </AuthShell>
    )
  }

  if (invite.email !== session.user.email.toLowerCase()) {
    return (
      <AuthShell
        title="Приглашение для другого адреса."
        lede={`Письмо ушло на ${invite.email}, а вы вошли как ${session.user.email}. Выйдите и откройте ссылку из письма под адресом, на который оно пришло.`}
      >
        <SignOutButton />
      </AuthShell>
    )
  }

  const needsPassword = !(await hasPassword(session.user.id))
  return (
    <AuthShell
      title={`«${invite.projectTitle}» ждёт вас.`}
      lede={`${invite.inviterName} зовёт выбирать интерьер вдвоём: те же рендеры, свои отметки «нравится» и общие совпадения. Удалить проект, оплатить его или пригласить кого-то ещё может только владелец.`}
    >
      <AcceptInviteForm token={token} needsPassword={needsPassword} />
    </AuthShell>
  )
}
