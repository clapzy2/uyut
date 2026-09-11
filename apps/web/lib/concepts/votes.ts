import type { ConceptBatchKind, ConceptStatus, ProjectRole } from '@uyut/db'

// Чистые правила отметок для двоих: чей лайк «мой», чей «второго участника», где совпали

export type VotePair = { owner: boolean | null; partner: boolean | null }

export type VotedItem<T> = T & VotePair

export type VoteSplit<T> = {
  /** Ещё не оценивал тот, кто смотрит: эти карточки в стопке */
  unseen: T[]
  mine: T[]
  theirs: T[]
  both: T[]
}

export function myVote(item: VotePair, role: ProjectRole): boolean | null {
  return role === 'owner' ? item.owner : item.partner
}

export function theirVote(item: VotePair, role: ProjectRole): boolean | null {
  return role === 'owner' ? item.partner : item.owner
}

export function splitVotes<T extends VotePair>(items: T[], role: ProjectRole): VoteSplit<T> {
  const unseen: T[] = []
  const mine: T[] = []
  const theirs: T[] = []
  const both: T[] = []
  for (const item of items) {
    const my = myVote(item, role)
    const their = theirVote(item, role)
    if (my === null) {
      unseen.push(item)
    }
    if (my === true) {
      mine.push(item)
    }
    if (their === true) {
      theirs.push(item)
    }
    if (my === true && their === true) {
      both.push(item)
    }
  }
  return { unseen, mine, theirs, both }
}

/** Сколько оценок поставил каждый: порог для предложения вариантов на двоих */
export function voteCounts(items: VotePair[]): { owner: number; partner: number } {
  let owner = 0
  let partner = 0
  for (const item of items) {
    if (item.owner !== null) {
      owner += 1
    }
    if (item.partner !== null) {
      partner += 1
    }
  }
  return { owner, partner }
}

export type LikeMap = Record<string, VotePair>

/** Новые отметки с сервера поверх локальных: свои голоса, поставленные только что, не теряются */
export function mergeVotes<T extends VotePair & { id: string }>(
  items: T[],
  likes: LikeMap,
  role: ProjectRole,
  local: Record<string, boolean>,
): T[] {
  return items.map((item) => {
    const incoming = likes[item.id]
    if (!incoming) {
      return item
    }
    const merged = { ...item, owner: incoming.owner, partner: incoming.partner }
    const localVote = local[item.id]
    if (localVote !== undefined) {
      if (role === 'owner') {
        merged.owner = localVote
      } else {
        merged.partner = localVote
      }
    }
    return merged
  })
}

export const DUO_VOTES_THRESHOLD = 10

export type DuoEligibility = {
  eligible: boolean
  ownerVotes: number
  partnerVotes: number
  both: number
  /** Варианты на двоих уже рендерятся: второй раз предлагать рано */
  pendingDuo: boolean
}

/**
 * Когда предлагать варианты на двоих: оба оценили не меньше десяти готовых концептов
 * комнаты, ни один не понравился обоим, и предыдущий такой запуск уже дорисован.
 */
export function duoEligibility(
  items: Array<VotePair & { status: ConceptStatus; batchKind: ConceptBatchKind }>,
  threshold = DUO_VOTES_THRESHOLD,
): DuoEligibility {
  const ready = items.filter((item) => item.status === 'ready')
  const counts = voteCounts(ready)
  const both = ready.filter((item) => item.owner === true && item.partner === true).length
  const pendingDuo = items.some((item) => item.batchKind === 'duo' && item.status === 'pending')
  return {
    eligible: counts.owner >= threshold && counts.partner >= threshold && both === 0 && !pendingDuo,
    ownerVotes: counts.owner,
    partnerVotes: counts.partner,
    both,
    pendingDuo,
  }
}
