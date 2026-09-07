import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { clearPresence, readLive, touchPresence } from '@/lib/collaboration/live'
import { otherMember } from '@/lib/collaboration/repository'
import { roomLikes } from '@/lib/concepts/repository'
import { AccessError, assertOwnerOrCollaborator } from '@/lib/projects/access'
import { getSession } from '@/lib/session'

const POLL_MS = 2000
const PRESENCE_EVERY = 10

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

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      let lastVersion = -1
      let lastPresence = ''
      let tick = 0

      const stop = async () => {
        if (closed) {
          return
        }
        closed = true
        await clearPresence(projectId, userId).catch(() => undefined)
        try {
          controller.close()
        } catch {
          // поток уже закрыт клиентом
        }
      }
      request.signal.addEventListener('abort', () => void stop())

      await touchPresence(projectId, userId, roomId)
      controller.enqueue(sse('hello', { other: other ? { name: other.name } : null }))

      while (!closed) {
        try {
          if (tick % PRESENCE_EVERY === 0 && tick > 0) {
            await touchPresence(projectId, userId, roomId)
          }
          const live = await readLive(projectId, other?.userId ?? null)
          const presenceState = JSON.stringify({
            online: Boolean(live.presence),
            roomId: live.presence?.roomId ?? null,
            lastSeenAt: live.presence ? null : live.lastSeenAt,
          })
          if (other && presenceState !== lastPresence) {
            lastPresence = presenceState
            controller.enqueue(sse('presence', JSON.parse(presenceState)))
          }
          if (live.version !== lastVersion) {
            lastVersion = live.version
            if (roomId) {
              controller.enqueue(sse('likes', await roomLikes(projectId, roomId)))
            }
          }
          if (tick % 15 === 0) {
            controller.enqueue(encoder.encode(': ping\n\n'))
          }
        } catch (error) {
          if (!closed) {
            console.error('live channel poll failed', error)
          }
        }
        tick += 1
        await new Promise((resolve) => setTimeout(resolve, POLL_MS))
      }
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
