import { getPlan } from '@/lib/billing/repository'

export const INVITE_NEEDS_PLAN =
  'Выбирать вдвоём можно в оплаченном проекте или в Pro. Оплатите проект на странице итогов.'

/** Приглашения доступны в Pro и в оплаченном проекте, как и вся коллаборация по спеке */
export async function canInvite(userId: string, project: { isPaid: boolean }): Promise<boolean> {
  return project.isPaid || (await getPlan(userId)) === 'pro'
}
