import type { ProjectRole } from '@uyut/db'

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
