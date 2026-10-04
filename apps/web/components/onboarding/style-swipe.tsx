'use client'

import { styleLibrary } from '@uyut/ai'
import { Button } from '@uyut/ui'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState, useTransition } from 'react'
import { saveStyleVotes } from '@/actions/onboarding'
import { FormError } from '@/components/form-error'
import { type SwipeCard, SwipeDeck } from '@/components/swipe-deck'
import { readStyleVoteDraft } from '@/lib/onboarding/style-vote-draft'
import { MIN_STYLE_VOTES, type StyleVoteInput } from '@/lib/validation/onboarding'

// Порядок разный для квартир, но одинаковый на сервере, в браузере и при возврате.
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

export function StyleSwipe({
  projectId,
  initialVotes,
}: {
  projectId: string
  initialVotes: StyleVoteInput[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [votes, setVotes] = useState<StyleVoteInput[]>(initialVotes)
  const [restarted, setRestarted] = useState(false)
  const [deckStartVotes, setDeckStartVotes] = useState(initialVotes)
  const [deckRevision, setDeckRevision] = useState(0)
  const [draftLoaded, setDraftLoaded] = useState(false)
  const [draftRestored, setDraftRestored] = useState(false)
  const draftKey = `domitsa:style-votes:${projectId}`

  useEffect(() => {
    try {
      const draft = readStyleVoteDraft(sessionStorage.getItem(draftKey), initialVotes)
      if (draft) {
        setVotes(draft.votes)
        setDeckStartVotes(draft.votes)
        setRestarted(draft.restarted)
        setDeckRevision((current) => current + 1)
        setDraftRestored(true)
      }
    } catch {
      // Вкладка работает и при запрете браузерного хранилища.
    }
    setDraftLoaded(true)
  }, [draftKey, initialVotes])

  useEffect(() => {
    if (!draftLoaded) return
    try {
      sessionStorage.setItem(
        draftKey,
        JSON.stringify({ version: 1, savedVotes: initialVotes, votes, restarted }),
      )
    } catch {
      // Сохранение в проект по кнопке «Дальше» не зависит от sessionStorage.
    }
  }, [draftKey, draftLoaded, initialVotes, votes, restarted])
  const allCards = useMemo(() => {
    const seed = Array.from(projectId).reduce(
      (value, character) => value + character.charCodeAt(0),
      0,
    )
    return shuffled(seed)
  }, [projectId])
  const cards = useMemo(
    () => allCards.filter((card) => !deckStartVotes.some((vote) => vote.styleId === card.id)),
    [allCards, deckStartVotes],
  )

  const liked = votes.filter((vote) => vote.liked).length
  const enough = votes.length >= MIN_STYLE_VOTES && liked > 0

  function save(then: 'next' | 'stay') {
    setError(null)
    startTransition(async () => {
      try {
        const result = await saveStyleVotes(projectId, { votes })
        if (!result.ok) {
          setError(result.error)
          return
        }
        try {
          sessionStorage.removeItem(draftKey)
        } catch {
          // Сервер уже сохранил оценки; очистка локального черновика необязательна.
        }
        if (then === 'next') {
          router.push(`/onboarding/step-5?project=${projectId}`)
        }
      } catch {
        setError(
          'Не удалось получить ответ сервера. Оценки остались на странице — попробуйте ещё раз.',
        )
      }
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <SwipeDeck
        key={deckRevision}
        cards={cards}
        likedCount={liked}
        disabled={pending || !draftLoaded}
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

      {draftRestored ? (
        <p className="text-center text-[15px] leading-relaxed text-ink-2" role="status">
          Черновик оценок восстановлен в этой вкладке. Нажмите «Дальше», чтобы сохранить его в
          проекте.
        </p>
      ) : null}

      {initialVotes.length > 0 && !restarted ? (
        <div className="text-center text-[15px] leading-relaxed text-ink-2">
          <p>
            Сохранённые оценки восстановлены: {initialVotes.length} из {allCards.length}.
            {cards.length > 0 ? ' Можно продолжить с оставшихся карточек.' : ''}
          </p>
          <button
            type="button"
            disabled={pending}
            className="mt-2 min-h-11 underline underline-offset-4 hover:text-ink disabled:opacity-40"
            onClick={() => {
              setVotes([])
              setDeckStartVotes([])
              setDeckRevision((current) => current + 1)
              setRestarted(true)
              setDraftRestored(false)
              setError(null)
            }}
          >
            Пересмотреть все карточки
          </button>
        </div>
      ) : null}

      <p className="text-center text-[15px] leading-relaxed text-ink-2">
        {votes.length === 0
          ? 'Тяните карточку вправо, если хотели бы так жить. Или жмите кнопки.'
          : enough
            ? votes.length < allCards.length
              ? 'Можно переходить дальше или посмотреть остальные карточки.'
              : 'Все карточки оценены. Можно переходить дальше.'
            : liked === 0 && votes.length >= MIN_STYLE_VOTES
              ? 'Выберите хотя бы одну комнату, которая вам нравится.'
              : `Оцените ещё ${Math.max(0, MIN_STYLE_VOTES - votes.length)} карточек. Для продолжения нужна хотя бы одна понравившаяся.`}
      </p>

      <FormError message={error ?? undefined} />
      <div className="flex flex-wrap justify-center gap-3">
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => router.push(`/onboarding/step-3?project=${projectId}`)}
        >
          Назад
        </Button>
        <Button type="button" disabled={!enough || pending} onClick={() => save('next')}>
          {pending ? 'Сохраняем…' : 'Дальше'}
        </Button>
      </div>
    </div>
  )
}
