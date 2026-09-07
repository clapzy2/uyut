'use client'

import type { ChatCard, ChatProposal } from '@uyut/db'
import { Button, cn, toast } from '@uyut/ui'
import { AnimatePresence, motion } from 'motion/react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { confirmRegeneration, dismissProposal, loadChatHistory } from '@/actions/chat'
import { formatPrice } from '@/lib/concepts/format'

type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  cards?: ChatCard[]
  proposal?: ChatProposal
  /** Ответ ещё печатается */
  streaming?: boolean
}

type Scope = {
  projectId: string
  roomId?: string | null
  conceptId?: string | null
  hasConcepts?: boolean
  /** Запуск генерации из предложения помощника: только владелец проекта */
  canRun?: boolean
}

const TYPE_INTERVAL_MS = 30

function suggestions(scope: Scope): string[] {
  if (scope.conceptId) {
    return ['Почему тут такие стены?', 'Подбери диван дешевле', 'Сколько выходит по смете?']
  }
  if (scope.roomId) {
    return scope.hasConcepts
      ? [
          'Какой концепт лучше для этой комнаты?',
          'Подбери диван дешевле',
          'Сколько выходит по смете?',
        ]
      : ['С чего начать?', 'Что нужно в эту комнату?', 'Какой стиль мне подойдёт?']
  }
  return ['С чего начать?', 'Сколько выходит по смете?', 'Что ещё нужно в квартиру?']
}

function ProductCards({ cards }: { cards: ChatCard[] }) {
  return (
    <ul className="mt-2 flex flex-col gap-1.5">
      {cards.map((card) => (
        <li key={`${card.catalogItemId}-${card.objectId ?? ''}`}>
          <a
            href={card.affiliateUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 rounded-sm border border-line bg-paper p-1.5 transition-colors duration-200 ease-ui hover:border-line-strong"
          >
            <span className="block h-11 w-11 shrink-0 overflow-hidden rounded-xs bg-muted">
              {card.imageUrl ? (
                // biome-ignore lint/performance/noImgElement: картинка товара живёт у магазина или подписана на час
                <img
                  src={card.imageUrl}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              ) : null}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] text-ink">{card.title}</span>
              <span className="block font-mono text-[12px] text-ink-2">
                {formatPrice(card.priceKopecks)}
              </span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  )
}

function ProposalCard({
  messageId,
  proposal,
  onChange,
  canRun,
}: {
  messageId: string
  proposal: ChatProposal
  onChange: (proposal: ChatProposal) => void
  canRun: boolean
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  if (!canRun) {
    return (
      <p className="mt-2 text-[13px] text-ink-2">
        Запуск новой генерации доступен владельцу проекта.
      </p>
    )
  }
  if (proposal.status === 'confirmed') {
    return (
      <p className="mt-2 text-[13px] text-success">
        Генерация запущена, новые концепты появятся на странице комнаты.
      </p>
    )
  }
  if (proposal.status === 'dismissed') {
    return <p className="mt-2 text-[13px] text-ink-2">Отменено.</p>
  }
  return (
    <div className="mt-2 rounded-sm border border-accent bg-paper p-2.5 text-[13px]">
      <p className="text-ink">
        Запустить новую генерацию с этими правками? Пять рендеров, около тридцати секунд.
      </p>
      <div className="mt-2 flex gap-2">
        <Button
          size="sm"
          pending={pending}
          onClick={() => {
            setPending(true)
            void confirmRegeneration(messageId).then((result) => {
              setPending(false)
              if (!result.ok) {
                toast({ title: result.error, tone: 'danger' })
                return
              }
              onChange({ ...proposal, status: 'confirmed' })
              toast({ title: 'Генерация запущена' })
              router.push(
                `/projects/${window.location.pathname.split('/')[2]}/rooms/${result.data.roomId}`,
              )
            })
          }}
        >
          Запустить
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() => {
            void dismissProposal(messageId)
            onChange({ ...proposal, status: 'dismissed' })
          }}
        >
          Отмена
        </Button>
      </div>
    </div>
  )
}

export function ChatDrawer(scope: Scope) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [loaded, setLoaded] = useState(false)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const bufferRef = useRef('')
  const typingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!open || loaded) {
      return
    }
    void loadChatHistory(scope.projectId).then((result) => {
      if (result.ok) {
        setMessages(
          result.data
            .filter((row) => row.role !== 'system')
            .map((row) => ({
              id: row.id,
              role: row.role === 'user' ? 'user' : 'assistant',
              content: row.content,
              cards: row.meta?.cards,
              proposal: row.meta?.proposal,
            })),
        )
      }
      setLoaded(true)
    })
  }, [loaded, open, scope.projectId])

  useEffect(() => {
    if (messages.length === 0) {
      return
    }
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }
    if (open) {
      window.addEventListener('keydown', onKeyDown)
    }
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  const patchLast = useCallback((patch: (message: Message) => Message) => {
    setMessages((current) => {
      const last = current[current.length - 1]
      if (last?.role !== 'assistant') {
        return current
      }
      return [...current.slice(0, -1), patch(last)]
    })
  }, [])

  // Печать буква за буквой: буфер наполняется потоком, интервал выдаёт по символу.
  // Если поток ушёл далеко вперёд, выдаём по несколько символов, чтобы не отставать.
  const startTyping = useCallback(() => {
    if (typingRef.current) {
      return
    }
    typingRef.current = setInterval(() => {
      const buffer = bufferRef.current
      if (buffer.length === 0) {
        return
      }
      const step = buffer.length > 240 ? 6 : buffer.length > 80 ? 3 : 1
      const chunk = buffer.slice(0, step)
      bufferRef.current = buffer.slice(step)
      patchLast((message) => ({ ...message, content: message.content + chunk }))
    }, TYPE_INTERVAL_MS)
  }, [patchLast])

  const stopTypingWhenDrained = useCallback(() => {
    const check = setInterval(() => {
      if (bufferRef.current.length === 0) {
        clearInterval(check)
        if (typingRef.current) {
          clearInterval(typingRef.current)
          typingRef.current = null
        }
        patchLast((message) => ({ ...message, streaming: false }))
      }
    }, TYPE_INTERVAL_MS)
  }, [patchLast])

  async function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || sending) {
      return
    }
    setSending(true)
    setInput('')
    const localId = `local-${Date.now()}`
    setMessages((current) => [
      ...current,
      { id: `${localId}-u`, role: 'user', content: trimmed },
      { id: `${localId}-a`, role: 'assistant', content: '', streaming: true },
    ])
    bufferRef.current = ''
    startTyping()
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: scope.projectId,
          roomId: scope.roomId ?? null,
          conceptId: scope.conceptId ?? null,
          message: trimmed,
        }),
      })
      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(payload?.error ?? 'Помощник не ответил.')
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let pending = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        pending += decoder.decode(value, { stream: true })
        const blocks = pending.split('\n\n')
        pending = blocks.pop() ?? ''
        for (const block of blocks) {
          const eventLine = block.split('\n').find((line) => line.startsWith('event:'))
          const dataLine = block.split('\n').find((line) => line.startsWith('data:'))
          if (!eventLine || !dataLine) continue
          const event = eventLine.slice(6).trim()
          const data = JSON.parse(dataLine.slice(5).trim()) as Record<string, unknown>
          if (event === 'delta') {
            bufferRef.current += String(data.text ?? '')
          } else if (event === 'reset') {
            bufferRef.current = ''
            patchLast((message) => ({ ...message, content: '' }))
          } else if (event === 'cards') {
            patchLast((message) => ({
              ...message,
              cards: [...(message.cards ?? []), ...((data.cards as ChatCard[]) ?? [])],
            }))
          } else if (event === 'proposal') {
            patchLast((message) => ({ ...message, proposal: data.proposal as ChatProposal }))
          } else if (event === 'done') {
            patchLast((message) => ({ ...message, id: String(data.messageId) }))
          } else if (event === 'error') {
            bufferRef.current += String(data.text ?? '')
          }
        }
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Помощник не ответил.'
      bufferRef.current += text
    } finally {
      stopTypingWhenDrained()
      setSending(false)
    }
  }

  const chips = suggestions(scope)

  return (
    <>
      {/* Кнопка висит поверх страницы, поэтому под содержимым нужен запас, иначе она ложится на последнюю строку */}
      <div aria-hidden="true" className="h-20 sm:h-0" />
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'fixed bottom-5 right-5 z-40 inline-flex h-12 items-center gap-2 rounded-full bg-accent px-5 text-[15px] font-medium text-on-accent shadow-soft transition-colors duration-200 ease-ui hover:bg-accent-hover',
          open && 'pointer-events-none opacity-0',
        )}
        aria-label="Открыть помощника"
      >
        <span aria-hidden="true">✦</span> Спросить
      </button>

      <AnimatePresence>
        {open ? (
          <>
            <motion.button
              type="button"
              aria-label="Закрыть помощника"
              className="fixed inset-0 z-40 bg-ink/30"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
            />
            <motion.aside
              role="dialog"
              aria-label="Помощник"
              className="fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-page shadow-soft sm:w-[420px] sm:border-l sm:border-line"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 380, damping: 38 }}
            >
              <header className="flex items-center justify-between border-b border-line px-5 py-4">
                <h2 className="font-serif text-2xl text-ink">Помощник</h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="grid h-9 w-9 place-items-center rounded-full text-ink-2 transition-colors duration-200 ease-ui hover:bg-muted hover:text-ink"
                  aria-label="Закрыть"
                >
                  ✕
                </button>
              </header>

              <div ref={listRef} className="flex-1 overflow-y-auto px-5 py-4">
                {!loaded ? (
                  <p className="text-[15px] text-ink-2">Загружаем разговор…</p>
                ) : messages.length === 0 ? (
                  <div className="rounded-md bg-muted px-4 py-3 text-[15px] leading-relaxed text-ink">
                    Я помощник Uyut. Помогу с интерьером этой квартиры: подобрать мебель, объяснить
                    концепт, посчитать смету.
                  </div>
                ) : null}
                <ul className="flex flex-col gap-3">
                  {messages.map((message) => (
                    <li
                      key={message.id}
                      className={cn(
                        'max-w-[90%] rounded-xl px-3.5 py-2.5 text-[15px] leading-relaxed',
                        message.role === 'user'
                          ? 'self-end rounded-br-sm bg-accent-tint text-ink'
                          : 'self-start rounded-bl-sm bg-muted text-ink',
                      )}
                    >
                      <span className="whitespace-pre-wrap">{message.content}</span>
                      {message.streaming && message.content === '' ? (
                        <span className="text-ink-2">…</span>
                      ) : null}
                      {message.cards && message.cards.length > 0 ? (
                        <ProductCards cards={message.cards} />
                      ) : null}
                      {message.proposal && !message.id.startsWith('local-') ? (
                        <ProposalCard
                          canRun={scope.canRun ?? true}
                          messageId={message.id}
                          proposal={message.proposal}
                          onChange={(proposal) =>
                            setMessages((current) =>
                              current.map((item) =>
                                item.id === message.id ? { ...item, proposal } : item,
                              ),
                            )
                          }
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="border-t border-line px-5 pb-5 pt-3">
                {messages.length < 2 ? (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {chips.map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => void send(chip)}
                        disabled={sending}
                        className="rounded-full border border-control px-3 py-1.5 text-[13px] text-ink-2 transition-colors duration-200 ease-ui hover:border-accent hover:text-accent disabled:opacity-50"
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                ) : null}
                <form
                  method="post"
                  className="flex items-end gap-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void send(input)
                  }}
                >
                  <textarea
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault()
                        void send(input)
                      }
                    }}
                    rows={1}
                    maxLength={2000}
                    placeholder="Напишите вопрос…"
                    aria-label="Сообщение помощнику"
                    className="max-h-32 min-h-11 flex-1 resize-none rounded-sm border border-line bg-paper px-3.5 py-2.5 text-[15px] text-ink placeholder:text-ink-2/70 focus:border-accent focus:outline-none"
                  />
                  <Button
                    type="submit"
                    disabled={sending || input.trim() === ''}
                    aria-label="Отправить"
                  >
                    →
                  </Button>
                </form>
              </div>
            </motion.aside>
          </>
        ) : null}
      </AnimatePresence>
    </>
  )
}
