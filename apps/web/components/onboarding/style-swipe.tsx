'use client'

import { styleLibrary } from '@uyut/ai'
import { Button } from '@uyut/ui'
import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { saveStyleVotes } from '@/actions/onboarding'
import { FormError } from '@/components/form-error'
import { type SwipeCard, SwipeDeck } from '@/components/swipe-deck'
import { MIN_STYLE_VOTES } from '@/lib/validation/onboarding'

type Vote = { styleId: string; liked: boolean }

// Порядок перемешивается один раз на визит, чтобы вкус не зависел от того, что лежит первым
function shuffled(seed: number): SwipeCard[] {
  const cards: SwipeCard[] = styleLibrary.map((style) => ({
    id: style.id,
    src: `/style-lib/${style.id}.webp`,
    title: style.ru,
  }))
  for (let index = cards.length - 1; index > 0; index -= 1) {
    const position = Math.floor(((Math.sin(seed + index) + 1) / 2) * (index + 1))
    const left = cards[index] as SwipeCard
    const right = cards[position] as SwipeCard
    cards[index] = right
    cards[position] = left
  }
  return cards
}

export function StyleSwipe({ projectId }: { projectId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [votes, setVotes] = useState<Vote[]>([])
  const cards = useMemo(() => shuffled(Date.now() % 1000), [])

  const liked = votes.filter((vote) => vote.liked).length
  const enough = votes.length >= MIN_STYLE_VOTES && liked > 0

  function save(then: 'next' | 'stay') {
    setError(null)
    startTransition(async () => {
      const result = await saveStyleVotes(projectId, { votes })
      if (!result.ok) {
        setError(result.error)
        return
      }
      if (then === 'next') {
        router.push(`/onboarding/step-5?project=${projectId}`)
      }
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <SwipeDeck
        cards={cards}
        likedCount={liked}
        onVote={(card, isLiked) =>
          setVotes((current) => [
            ...current.filter((vote) => vote.styleId !== card.id),
            { styleId: card.id, liked: isLiked },
          ])
        }
        onUndo={() => setVotes((current) => current.slice(0, -1))}
        onFinished={() => save('stay')}
        className="mx-auto w-full max-w-md"
      />

      <p className="text-center text-[15px] leading-relaxed text-ink-2">
        {votes.length === 0
          ? 'Тяните карточку вправо, если хотели бы так жить. Или жмите кнопки.'
          : enough
            ? 'Этого уже хватит, но можно посмотреть остальные.'
            : `Отметьте ещё ${Math.max(0, MIN_STYLE_VOTES - votes.length)}, и вкус посчитается.`}
      </p>

      <FormError message={error ?? undefined} />
      <div className="flex flex-wrap justify-center gap-3">
        <Button
          type="button"
          variant="secondary"
          onClick={() => router.push(`/onboarding/step-3?project=${projectId}`)}
        >
          Назад
        </Button>
        <Button type="button" disabled={!enough || pending} onClick={() => save('next')}>
          {pending ? 'Сохраняем…' : 'Дальше'}
        </Button>
      </div>
      {liked === 0 && votes.length >= MIN_STYLE_VOTES ? (
        <p className="text-center text-[15px] text-ink-2">
          Пока ничего не понравилось. Отметьте хотя бы одну карточку, иначе не от чего оттолкнуться.
        </p>
      ) : null}
    </div>
  )
}
