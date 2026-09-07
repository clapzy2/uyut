'use client'

import { cn } from '@uyut/ui'
import { AnimatePresence, animate, motion, useMotionValue, useTransform } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'

export type SwipeCard = {
  id: string
  src: string
  title?: string
  caption?: string
  /** Метка в углу: например, что карточка уже понравилась второму участнику */
  badge?: string
}

const THRESHOLD_PX = 110
const THRESHOLD_VELOCITY = 500

type Leaving = { card: SwipeCard; liked: boolean }

/**
 * Стопка карточек с физикой перетаскивания. Используется и на шаге вкуса, и на свайпе концептов,
 * поэтому знает только про картинки и два ответа: нравится или нет.
 *
 * Голос засчитывается сразу, а улетающая карточка живёт отдельно и анимируется сама по себе.
 * Если браузер не рисует кадры (свёрнутая вкладка, экономия батареи), стопка всё равно движется.
 */
export function SwipeDeck({
  cards,
  onVote,
  onUndo,
  onFinished,
  onOpen,
  likedCount,
  className,
}: {
  cards: SwipeCard[]
  onVote: (card: SwipeCard, liked: boolean) => void
  onUndo?: () => void
  onFinished?: () => void
  /** Тап по карточке без перетаскивания или пробел: открыть карточку целиком */
  onOpen?: (card: SwipeCard) => void
  likedCount?: number
  className?: string
}) {
  const [voted, setVoted] = useState<string[]>([])
  const [leaving, setLeaving] = useState<Leaving | null>(null)
  const draggedRef = useRef(false)
  const x = useMotionValue(0)
  const rotate = useTransform(x, [-320, 0, 320], [-9, 0, 9])
  const likeOpacity = useTransform(x, [40, 150], [0, 1])
  const skipOpacity = useTransform(x, [-150, -40], [1, 0])
  const finishedRef = useRef(false)

  const pending = cards.filter((card) => !voted.includes(card.id))
  const current = pending[0]
  const remaining = pending.length
  const canUndo = voted.length > 0

  const commit = useCallback(
    (liked: boolean) => {
      const card = current
      if (!card) {
        return
      }
      onVote(card, liked)
      setLeaving({ card, liked })
      setVoted((value) => [...value, card.id])
      x.set(0)
    },
    [current, onVote, x],
  )

  const undo = useCallback(() => {
    if (!canUndo || !onUndo) {
      return
    }
    setVoted((value) => value.slice(0, -1))
    onUndo()
  }, [canUndo, onUndo])

  useEffect(() => {
    if (!current && !finishedRef.current && cards.length > 0) {
      finishedRef.current = true
      onFinished?.()
    }
    if (current) {
      finishedRef.current = false
    }
  }, [cards.length, current, onFinished])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.target instanceof HTMLElement && event.target.matches('input, textarea, select')) {
        return
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        commit(false)
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        commit(true)
      }
      if (event.key === ' ' && onOpen && current) {
        event.preventDefault()
        onOpen(current)
      }
      if ((event.key === 'z' || event.key === 'я') && canUndo) {
        event.preventDefault()
        undo()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [canUndo, commit, current, onOpen, undo])

  return (
    <div className={cn('flex flex-col items-center gap-5', className)}>
      <div className="relative aspect-[4/3] w-full select-none">
        {pending.slice(1, 3).map((card, offset) => (
          <div
            key={card.id}
            className="absolute inset-0 overflow-hidden border border-line bg-muted"
            style={{
              transform: `translateY(${(offset + 1) * 10}px) scale(${1 - (offset + 1) * 0.04})`,
              opacity: 1 - (offset + 1) * 0.25,
              zIndex: 1,
            }}
            aria-hidden="true"
          >
            {/* biome-ignore lint/performance/noImgElement: подписанные ссылки живут час, оптимизатор next/image здесь не нужен */}
            <img src={card.src} alt="" className="h-full w-full object-cover" />
          </div>
        ))}

        {current ? (
          <motion.div
            key={current.id}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.55}
            onDragStart={() => {
              draggedRef.current = true
            }}
            onClick={() => {
              // Клик после перетаскивания — не открытие, а конец жеста
              if (draggedRef.current) {
                draggedRef.current = false
                return
              }
              if (onOpen && current) {
                onOpen(current)
              }
            }}
            onDragEnd={(_, info) => {
              const far = Math.abs(info.offset.x) > THRESHOLD_PX
              const fast = Math.abs(info.velocity.x) > THRESHOLD_VELOCITY
              if (far || fast) {
                commit(info.offset.x > 0)
              } else {
                void animate(x, 0, { type: 'spring', stiffness: 500, damping: 40 })
              }
            }}
            style={{ x, rotate, zIndex: 2 }}
            className="absolute inset-0 cursor-grab overflow-hidden border border-line bg-muted shadow-soft active:cursor-grabbing"
            role={onOpen ? 'button' : undefined}
            tabIndex={onOpen ? 0 : undefined}
            aria-label={onOpen ? 'Открыть карточку' : undefined}
          >
            {/* biome-ignore lint/performance/noImgElement: подписанные ссылки живут час, оптимизатор next/image здесь не нужен */}
            <img
              src={current.src}
              alt={current.title ?? ''}
              draggable={false}
              className="pointer-events-none h-full w-full object-cover"
            />
            <motion.span
              style={{ opacity: likeOpacity }}
              className="pointer-events-none absolute left-4 top-4 -rotate-6 rounded-sm border-2 border-success bg-paper/85 px-3 py-1 font-medium text-success text-sm"
            >
              Нравится
            </motion.span>
            <motion.span
              style={{ opacity: skipOpacity }}
              className="pointer-events-none absolute right-4 top-4 rotate-6 rounded-sm border-2 border-ink-2 bg-paper/85 px-3 py-1 font-medium text-ink-2 text-sm"
            >
              Мимо
            </motion.span>
            {current.caption ? (
              <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent px-4 pb-3 pt-10 text-[13px] text-white">
                {current.caption}
              </span>
            ) : null}
            {current.badge ? (
              <span className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-accent px-3 py-1 text-[12px] font-medium text-on-accent shadow-soft">
                {current.badge}
              </span>
            ) : null}
          </motion.div>
        ) : (
          <div className="absolute inset-0 grid place-items-center border border-dashed border-line-strong text-center text-ink-2">
            <p className="px-6 text-[15px] leading-relaxed">Карточки закончились.</p>
          </div>
        )}

        <AnimatePresence onExitComplete={() => setLeaving(null)}>
          {leaving ? (
            <motion.div
              key={leaving.card.id}
              initial={{ x: 0, opacity: 1, rotate: 0 }}
              animate={{
                x: leaving.liked ? 520 : -520,
                opacity: 0,
                rotate: leaving.liked ? 12 : -12,
              }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
              onAnimationComplete={() => setLeaving(null)}
              style={{ zIndex: 3 }}
              className="pointer-events-none absolute inset-0 overflow-hidden border border-line bg-muted"
              aria-hidden="true"
            >
              {/* biome-ignore lint/performance/noImgElement: подписанные ссылки живут час, оптимизатор next/image здесь не нужен */}
              <img src={leaving.card.src} alt="" className="h-full w-full object-cover" />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      <div className="flex items-center gap-6">
        <button
          type="button"
          onClick={() => commit(false)}
          disabled={!current}
          aria-label="Не нравится"
          className="grid h-12 w-12 place-items-center rounded-full border border-line-strong text-ink-2 transition-colors duration-200 ease-ui hover:border-ink hover:text-ink disabled:opacity-40"
        >
          <span aria-hidden="true" className="text-lg">
            ✕
          </span>
        </button>
        {onUndo ? (
          <button
            type="button"
            onClick={undo}
            disabled={!canUndo}
            aria-label="Вернуть предыдущую"
            className="grid h-10 w-10 place-items-center rounded-full border border-line text-ink-2 transition-colors duration-200 ease-ui hover:border-line-strong hover:text-ink disabled:opacity-30"
          >
            <span aria-hidden="true">↶</span>
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => commit(true)}
          disabled={!current}
          aria-label="Нравится"
          className="grid h-12 w-12 place-items-center rounded-full border border-accent text-accent transition-colors duration-200 ease-ui hover:bg-accent-tint disabled:opacity-40"
        >
          <span aria-hidden="true" className="text-lg">
            ♥
          </span>
        </button>
      </div>

      <p className="font-mono text-[13px] text-ink-2" aria-live="polite">
        {remaining > 0 ? `Осталось ${remaining}` : 'Всё'}
        {likedCount === undefined ? '' : ` · понравилось ${likedCount}`}
      </p>
    </div>
  )
}
