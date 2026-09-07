import {
  buildSystemPrompt,
  buildTranscript,
  looksLikeToolCall,
  parseAgentReply,
  RESET_MARK,
  streamFalLlm,
  type TranscriptTurn,
} from '@uyut/ai'
import type { ChatCard, ChatMeta, ChatProposal } from '@uyut/db'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { recordAudit } from '@/lib/audit'
import { buildProjectContext } from '@/lib/chat/context'
import { appendChatMessage, listChatMessages } from '@/lib/chat/repository'
import { runTool } from '@/lib/chat/tools'
import { getEnv } from '@/lib/env'
import { AccessError } from '@/lib/projects/access'
import { getChatByUserLimiter } from '@/lib/redis'
import { getSession } from '@/lib/session'

const bodySchema = z.object({
  projectId: z.uuid(),
  roomId: z.uuid().nullable().optional(),
  conceptId: z.uuid().nullable().optional(),
  message: z.string().trim().min(1).max(2000),
})

const MAX_TOOL_CALLS = 3
const HISTORY_TURNS = 20
const OFFLINE_REPLY =
  'Помощник пока не подключён: в настройках сервиса нет ключа модели. Подбор и генерация работают без него.'

type Emit = (event: string, data: unknown) => void

/**
 * Один ход помощника: модель либо отвечает текстом, либо просит инструмент. Текст уходит клиенту
 * потоком по мере прихода; команда собирается целиком, выполняется, и цикл продолжается.
 */
async function converse(input: {
  apiKey: string
  system: string
  turns: TranscriptTurn[]
  scope: { userId: string; projectId: string; roomId: string | null; conceptId: string | null }
  emit: Emit
  signal: AbortSignal
}): Promise<{ text: string; meta: ChatMeta }> {
  const meta: ChatMeta = { cards: [], tools: [] }
  const turns = [...input.turns]
  for (let step = 0; step <= MAX_TOOL_CALLS; step += 1) {
    const prompt = buildTranscript(turns, HISTORY_TURNS + step * 2)
    let collected = ''
    let decided: 'tool' | 'text' | null = null
    for await (const delta of streamFalLlm(input.apiKey, {
      system: input.system,
      prompt,
      signal: input.signal,
    })) {
      if (delta.startsWith(RESET_MARK)) {
        // Модель переписала ответ с начала: показываем заново
        collected = delta.slice(1)
        input.emit('reset', {})
        if (decided === 'text') input.emit('delta', { text: collected })
        continue
      }
      collected += delta
      if (decided === null) {
        const head = collected.trimStart()
        if (head.length < 2) continue
        decided = looksLikeToolCall(head) ? 'tool' : 'text'
        if (decided === 'text') input.emit('delta', { text: collected })
      } else if (decided === 'text') {
        input.emit('delta', { text: delta })
      }
    }
    const reply = parseAgentReply(collected)
    if (reply.type === 'text' || step === MAX_TOOL_CALLS) {
      const text =
        reply.type === 'text'
          ? reply.text
          : 'Не получилось довести дело до конца, попробуйте переформулировать.'
      if (decided !== 'text') input.emit('delta', { text })
      return { text, meta }
    }
    const result = await runTool(reply.name, reply.args, input.scope)
    meta.tools?.push(reply.name)
    if (result.cards && result.cards.length > 0) {
      meta.cards = [...(meta.cards ?? []), ...result.cards]
      input.emit('cards', { cards: result.cards satisfies ChatCard[] })
    }
    if (result.proposal) {
      meta.proposal = result.proposal satisfies ChatProposal
      input.emit('proposal', { proposal: result.proposal })
    }
    turns.push(
      { role: 'assistant', content: collected.trim() },
      { role: 'tool', content: result.text },
    )
  }
  return { text: '', meta }
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return Response.json({ error: 'Сессия закончилась. Войдите снова.' }, { status: 401 })
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: 'Сообщение пустое или слишком длинное.' }, { status: 400 })
  }
  const { projectId, message } = parsed.data
  const roomId = parsed.data.roomId ?? null
  const conceptId = parsed.data.conceptId ?? null
  const userId = session.user.id

  const { success } = await getChatByUserLimiter().limit(userId)
  if (!success) {
    return Response.json(
      { error: 'Шестьдесят сообщений за час это много. Продолжим через часок.' },
      { status: 429, headers: { 'retry-after': '3600' } },
    )
  }

  let history: Awaited<ReturnType<typeof listChatMessages>>
  let context: string
  try {
    history = await listChatMessages(userId, projectId, 200)
    context = await buildProjectContext(userId, { projectId, roomId, conceptId })
  } catch (error) {
    if (error instanceof AccessError) {
      return Response.json({ error: 'Проект не найден' }, { status: 404 })
    }
    throw error
  }

  await appendChatMessage({ projectId, role: 'user', content: message })
  await recordAudit({
    action: 'chat.message',
    actorId: userId,
    targetType: 'project',
    targetId: projectId,
  })

  const turns: TranscriptTurn[] = history
    .filter((row) => row.role !== 'system')
    .map((row) => ({ role: row.role === 'user' ? 'user' : 'assistant', content: row.content }))
  turns.push({ role: 'user', content: message })

  const apiKey = getEnv().FAL_KEY
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit: Emit = (event, data) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }
      try {
        if (!apiKey) {
          emit('delta', { text: OFFLINE_REPLY })
          const saved = await appendChatMessage({
            projectId,
            role: 'assistant',
            content: OFFLINE_REPLY,
          })
          emit('done', { messageId: saved.id })
          controller.close()
          return
        }
        const { text, meta } = await converse({
          apiKey,
          system: buildSystemPrompt(context),
          turns,
          scope: { userId, projectId, roomId, conceptId },
          emit,
          signal: request.signal,
        })
        const saved = await appendChatMessage({
          projectId,
          role: 'assistant',
          content: text,
          meta: meta.cards?.length || meta.proposal || meta.tools?.length ? meta : undefined,
        })
        emit('done', { messageId: saved.id })
      } catch (error) {
        console.error(error)
        emit('error', { text: 'Помощник не ответил. Попробуйте ещё раз через минуту.' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    },
  })
}
