import { styleLibrary } from '@uyut/ai'
import { z } from 'zod'
import { type StyleVoteInput, styleVoteSchema } from '@/lib/validation/onboarding'

const votesSchema = z
  .array(styleVoteSchema)
  .max(styleLibrary.length)
  .refine((votes) => new Set(votes.map((vote) => vote.styleId)).size === votes.length)

const draftSchema = z.object({
  version: z.literal(1),
  savedVotes: votesSchema,
  votes: votesSchema,
  restarted: z.boolean(),
})

function revision(votes: StyleVoteInput[]): string {
  return JSON.stringify([...votes].sort((left, right) => left.styleId.localeCompare(right.styleId)))
}

/** Черновик не должен заменять более новые оценки, уже сохранённые на сервере. */
export function readStyleVoteDraft(raw: string | null, savedVotes: StyleVoteInput[]) {
  if (!raw) return null
  try {
    const parsed = draftSchema.safeParse(JSON.parse(raw))
    if (!parsed.success || revision(parsed.data.savedVotes) !== revision(savedVotes)) return null
    return parsed.data
  } catch {
    return null
  }
}
