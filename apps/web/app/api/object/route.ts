import { type NextRequest, NextResponse } from 'next/server'
import { AccessError, assertOwnerOrCollaborator, isUuid } from '@/lib/projects/access'
import { getSession } from '@/lib/session'
import { getObject } from '@/lib/storage'

// Файлы проекта через наш домен: канве нужны пиксели рендера и маски, а картинки с другого
// адреса браузер для чтения закрывает. Доступ только к своим проектам, по ключу вида projects/{id}/…
export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 })
  }
  const key = request.nextUrl.searchParams.get('key') ?? ''
  const match = key.match(/^projects\/([0-9a-f-]{36})\//i)
  if (!match || !isUuid(match[1] as string) || key.includes('..')) {
    return new NextResponse('Not found', { status: 404 })
  }
  try {
    await assertOwnerOrCollaborator(session.user.id, match[1] as string)
    const object = await getObject(key)
    return new NextResponse(Buffer.from(object.body), {
      headers: {
        'content-type': object.contentType,
        'cache-control': 'private, max-age=300',
      },
    })
  } catch (error) {
    if (error instanceof AccessError) {
      return new NextResponse('Not found', { status: 404 })
    }
    throw error
  }
}
