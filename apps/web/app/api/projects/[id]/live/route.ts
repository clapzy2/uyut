import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { clearPresence, readLive, touchPresence } from '@/lib/collaboration/live'
import { otherMember } from '@/lib/collaboration/repository'
import { roomLikes } from '@/lib/concepts/repository'
import { AccessError, assertOwnerOrCollaborator } from '@/lib/projects/access'
import { getSession } from '@/lib/session'

const POLL_MS = 2000
const PRESENCE_EVERY = 10
const PING_EVERY = 15

type Params = Promise<{ id: string }>

const encoder = new TextEncoder()

function sse(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

/**
 * Живой канал страницы проекта: присутствие второго участника и отметки комнаты.
 * Сервер опрашивает Redis раз в две секунды и шлёт только изменения; отметки перечитываются
 * из базы, когда поднялась версия проекта. Само соединение и есть присутствие человека.
 */
export async function GET(request: NextRequest, { params }: { params: Params }) {
  const session = await getSession()
  if (!session) {
    return new Response('Unauthorized', { status: 401 })
  }
  const { id } = await params
  const roomParam = request.nextUrl.searchParams.get('room')
  const roomId = z.uuid().safeParse(roomParam).success ? (roomParam as string) : null
  let projectId: string
  try {
    projectId = (await assertOwnerOrCollaborator(session.user.id, id)).id
  } catch (error) {
    if (error instanceof AccessError) {
      return new Response('Not found', { status: 404 })
    }
    throw error
  }
  const userId = session.user.id
  const other = await otherMember(projectId, userId)

  let closed = false
  // Закрываемся при первом признаке ухода клиента: отмена потока, abort запроса или
  // ошибка записи. Иначе Next ругается на запись в уже закрытый ответ.
  const stop = async (controller?: ReadableStreamDefaultController<Uint8Array>) => {
    if (closed) {
      return
    }
    closed = true
    await clearPresence(projectId, userId).catch(() => undefined)
    try {
      controller?.close()
    } catch {
      // поток уже закрыт
    }
  }

  const send = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    chunk: Uint8Array,
  ): boolean => {
    if (closed) {
      return false
    }
    try {
      controller.enqueue(chunk)
      return true
    } catch {
      void stop()
      return false
    }
  }

  const loop = async (controller: ReadableStreamDefaultController<Uint8Array>) => {
    let lastVersion = -1
    let lastPresence = ''
    let tick = 0
    await touchPresence(projectId, userId, roomId)
    send(controller, sse('hello', { other: other ? { name: other.name } : null }))
    while (!closed) {
      try {
        if (tick > 0 && tick % PRESENCE_EVERY === 0) {
          await touchPresence(projectId, userId, roomId)
        }
        const live = await readLive(projectId, other?.userId ?? null)
        if (closed) {
          break
        }
        const presenceState = JSON.stringify({
          online: Boolean(live.presence),
          roomId: live.presence?.roomId ?? null,
          lastSeenAt: live.presence ? null : live.lastSeenAt,
        })
        if (other && presenceState !== lastPresence) {
          lastPresence = presenceState
          send(controller, sse('presence', JSON.parse(presenceState)))
        }
        if (live.version !== lastVersion) {
          lastVersion = live.version
          if (roomId) {
            send(controller, sse('likes', await roomLikes(projectId, roomId)))
          }
        }
        if (tick % PING_EVERY === 0) {
          send(controller, encoder.encode(': ping\n\n'))
        }
      } catch (error) {
        if (!closed) {
          console.error('live channel poll failed', error)
        }
      }
      tick += 1
      await new Promise((resolve) => setTimeout(resolve, POLL_MS))
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      request.signal.addEventListener('abort', () => void stop(controller))
      void loop(controller).then(() => stop(controller))
    },
    cancel() {
      void stop()
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  })
}
