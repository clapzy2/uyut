'use client'

import { Button, Dialog, DialogClose, DialogContent, DialogTrigger, toast } from '@uyut/ui'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { revokeCollaborator } from '@/actions/collaboration'
import { InviteDialog } from '@/components/collaboration/invite-dialog'
import type { CollaborationView } from '@/lib/collaboration/repository'
import { formatDate } from '@/lib/projects/format'

function RevokeDialog({
  projectId,
  name,
  pendingOnly,
}: {
  projectId: string
  name: string
  pendingOnly: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function confirm() {
    setBusy(true)
    const result = await revokeCollaborator(projectId)
    setBusy(false)
    if (!result.ok) {
      toast({ title: 'Не получилось', description: result.error, tone: 'danger' })
      return
    }
    toast({ title: pendingOnly ? 'Приглашение отозвано' : 'Доступ закрыт' })
    router.refresh()
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="text-sm text-ink-2 underline decoration-line-strong decoration-1 underline-offset-4 transition-colors duration-200 ease-ui hover:text-danger hover:decoration-danger"
        >
          {pendingOnly ? 'Отозвать приглашение' : 'Отозвать доступ'}
        </button>
      </DialogTrigger>
      <DialogContent
        title={pendingOnly ? 'Отозвать приглашение?' : `Закрыть доступ для ${name}?`}
        description={
          pendingOnly
            ? 'Ссылка из письма перестанет работать. Пригласить снова можно в любой момент.'
            : 'Проект пропадёт из списка, отметки «нравится» останутся. Пригласить снова можно в любой момент.'
        }
      >
        <div className="flex flex-wrap gap-3">
          <Button onClick={confirm} pending={busy}>
            {busy ? 'Закрываем…' : pendingOnly ? 'Отозвать' : 'Закрыть доступ'}
          </Button>
          <DialogClose asChild>
            <Button variant="secondary">Оставить</Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Блок «Вдвоём» на странице проекта у владельца: кто в проекте или кого позвать */
export function TogetherCard({
  projectId,
  collaboration,
  allowed,
}: {
  projectId: string
  collaboration: CollaborationView
  allowed: boolean
}) {
  const { partner, invite } = collaboration

  if (partner) {
    return (
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-serif text-[22px] leading-tight text-ink">{partner.name}</p>
          <p className="mt-1 font-mono text-[13px] text-ink-2">
            {partner.email}
            {partner.acceptedAt ? ` · в проекте с ${formatDate(partner.acceptedAt)}` : ''}
          </p>
          <p className="mt-2 max-w-md text-[15px] leading-relaxed text-ink-2">
            Смотрит комнаты, отмечает концепты и открывает подбор. Оплата, файлы и настройки
            остаются у вас.
          </p>
        </div>
        <RevokeDialog projectId={projectId} name={partner.name} pendingOnly={false} />
      </div>
    )
  }

  if (invite) {
    return (
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[15px] leading-relaxed text-ink">
            Приглашение отправлено на <span className="font-mono text-[14px]">{invite.email}</span>
          </p>
          <p className="mt-1 font-mono text-[13px] text-ink-2">
            действует до {formatDate(invite.expiresAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <InviteDialog
            projectId={projectId}
            initialEmail={invite.email}
            label="Отправить ещё раз"
            variant="ghost"
          />
          <RevokeDialog projectId={projectId} name={invite.email} pendingOnly />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <p className="max-w-md text-[15px] leading-relaxed text-ink-2">
        Выбирать интерьер вдвоём проще: пригласите того, с кем живёте, и сервис покажет, где ваши
        вкусы совпали.
      </p>
      {allowed ? (
        <InviteDialog projectId={projectId} variant="secondary" />
      ) : (
        <p className="text-[15px] text-ink-2">
          Доступно в оплаченном проекте или в Pro.{' '}
          <Link
            href={`/projects/${projectId}/summary`}
            className="text-ink underline decoration-accent decoration-1 underline-offset-4"
          >
            Забрать проект
          </Link>
        </p>
      )}
    </div>
  )
}
