import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ChatDrawer } from '@/components/chat/chat-drawer'
import { ConceptEditForm } from '@/components/concepts/concept-edit-form'
import { ConceptViewer } from '@/components/concepts/concept-viewer'
import { getConceptPage } from '@/lib/concepts/objects'
import { NotFoundError, ProjectClosedError } from '@/lib/projects/access'
import { getSession } from '@/lib/session'

type Params = Promise<{ id: string; roomId: string; conceptId: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const session = await getSession()
  const { conceptId } = await params
  if (!session) {
    return { title: 'Концепт' }
  }
  try {
    const data = await getConceptPage(session.user.id, conceptId)
    return { title: `Концепт ${data.concept.orderIndex + 1} · ${data.room.name}` }
  } catch {
    return { title: 'Концепт' }
  }
}

export default async function ConceptPage({ params }: { params: Params }) {
  const session = await getSession()
  const { id, roomId, conceptId } = await params
  if (!session) {
    redirect(`/login?next=/projects/${id}/rooms/${roomId}/concepts/${conceptId}`)
  }

  let data: Awaited<ReturnType<typeof getConceptPage>>
  try {
    data = await getConceptPage(session.user.id, conceptId)
  } catch (error) {
    if (error instanceof ProjectClosedError) {
      redirect(`/projects/${id}`)
    }
    if (error instanceof NotFoundError) {
      notFound()
    }
    throw error
  }
  if (data.room.id !== roomId || data.room.projectId !== id) {
    notFound()
  }

  return (
    <section className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-14 lg:py-16">
      <nav className="flex flex-wrap gap-x-2 text-sm text-ink-2">
        <Link
          href={`/projects/${data.room.projectId}`}
          className="inline-block py-1.5 underline decoration-line-strong decoration-1 underline-offset-4 hover:text-ink"
        >
          {data.room.projectTitle}
        </Link>
        <span aria-hidden="true">·</span>
        <Link
          href={`/projects/${data.room.projectId}/rooms/${data.room.id}`}
          className="inline-block py-1.5 underline decoration-line-strong decoration-1 underline-offset-4 hover:text-ink"
        >
          {data.room.name}
        </Link>
      </nav>
      {/* Хлебные крошки сверху мелкие и серые: владелец их не заметил и спросил, где кнопка
          назад. Поэтому обратный путь стоит отдельной заметной строкой рядом с заголовком. */}
      <div className="mt-5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h1 className="font-serif text-[36px] font-normal leading-[1.05] tracking-tight text-ink sm:text-5xl">
          Концепт {data.concept.orderIndex + 1}
        </h1>
        <Link
          href={`/projects/${data.room.projectId}/rooms/${data.room.id}`}
          className="text-[15px] text-accent underline decoration-accent/40 underline-offset-4 transition-colors duration-200 ease-ui hover:decoration-accent"
        >
          ← Ко всем вариантам
        </Link>
      </div>
      <div className="mt-8">
        <ConceptViewer data={data} />
      </div>
      {data.role === 'owner' && data.concept.status === 'ready' ? (
        <div className="mt-10 max-w-2xl">
          <ConceptEditForm
            conceptId={data.concept.id}
            roomHref={`/projects/${data.room.projectId}/rooms/${data.room.id}`}
          />
        </div>
      ) : null}
      <ChatDrawer
        projectId={data.room.projectId}
        roomId={data.room.id}
        conceptId={data.concept.id}
        hasConcepts
        canRun={data.role === 'owner'}
      />
    </section>
  )
}
