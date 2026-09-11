import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { uploadRoomPhoto } from '@/actions/rooms'
import { ChatDrawer } from '@/components/chat/chat-drawer'
import { ConceptsPanel } from '@/components/concepts/concepts-panel'
import { DeleteRoomDialog } from '@/components/delete-room-dialog'
import { FileUploader } from '@/components/file-uploader'
import { RoomConditionForm } from '@/components/room-condition-form'
import { RoomNotesForm } from '@/components/room-notes-form'
import { RoomSettingsDialog } from '@/components/room-settings-dialog'
import { otherMember } from '@/lib/collaboration/repository'
import { latestBatch, listConceptsByRoom } from '@/lib/concepts/repository'
import { resumeGenerationRun } from '@/lib/concepts/resume-run'
import { PHOTO_ACCEPT, PHOTO_LIMIT_TEXT, PHOTO_MAX_BYTES } from '@/lib/files/rules'
import { NotFoundError, ProjectClosedError } from '@/lib/projects/access'
import { fileNameFromKey, formatArea, roomKindLabels } from '@/lib/projects/format'
import { getRoom } from '@/lib/projects/repository'
import { getSession } from '@/lib/session'
import { presignedObjectUrl } from '@/lib/storage'

type Params = Promise<{ id: string; roomId: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const session = await getSession()
  const { roomId } = await params
  if (!session) {
    return { title: 'Комната' }
  }
  try {
    const room = await getRoom(session.user.id, roomId)
    return { title: `${room.name} · ${room.project.title}` }
  } catch {
    return { title: 'Комната' }
  }
}

export default async function RoomPage({ params }: { params: Params }) {
  const session = await getSession()
  const { id, roomId } = await params
  if (!session) {
    redirect(`/login?next=/projects/${id}/rooms/${roomId}`)
  }

  let room: Awaited<ReturnType<typeof getRoom>>
  try {
    room = await getRoom(session.user.id, roomId)
  } catch (error) {
    if (error instanceof ProjectClosedError) {
      redirect(`/projects/${id}`)
    }
    if (error instanceof NotFoundError) {
      notFound()
    }
    throw error
  }
  if (room.projectId !== id) {
    notFound()
  }
  const isOwner = room.role === 'owner'

  const [allConcepts, { batchId: latestBatchId }, other, runningGeneration] = await Promise.all([
    listConceptsByRoom(session.user.id, room.id),
    latestBatch(session.user.id, room.id),
    otherMember(room.projectId, session.user.id),
    resumeGenerationRun(room),
  ])
  const conceptItems = allConcepts
  const photoUrl = room.photoUrl ? await presignedObjectUrl(room.photoUrl) : null
  const uploadPhotoForRoom = uploadRoomPhoto.bind(null, room.id)
  const meta = [formatArea(room.areaM2), roomKindLabels[room.kind].toLowerCase()]
    .filter(Boolean)
    .join(' · ')

  return (
    <section className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-14 lg:py-20">
      <Link
        href={`/projects/${room.projectId}`}
        className="inline-block py-1.5 text-sm text-ink-2 underline decoration-line-strong decoration-1 underline-offset-4 hover:text-ink"
      >
        {room.project.title}
      </Link>
      <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-[40px] font-normal leading-[1.05] tracking-tight text-ink sm:text-5xl lg:text-[56px]">
            {room.name}
          </h1>
          <p className="mt-2 font-mono text-[13px] text-ink-2">{meta}</p>
        </div>
        {isOwner ? (
          <RoomSettingsDialog
            room={{ id: room.id, name: room.name, kind: room.kind, areaM2: room.areaM2 }}
          />
        ) : null}
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-[7fr_5fr] lg:gap-14">
        <div>
          <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-2">
            Фото
          </p>
          {photoUrl ? (
            <>
              <div className="overflow-hidden border border-line bg-muted">
                {/* biome-ignore lint/performance/noImgElement: подписанная ссылка живёт 15 минут, оптимизатор next/image здесь не нужен */}
                <img src={photoUrl} alt={`Фото: ${room.name}`} className="block w-full" />
              </div>
              <div className="mt-3 flex flex-wrap items-baseline justify-between gap-3">
                <span className="font-mono text-[13px] text-ink-2">
                  {fileNameFromKey(room.photoUrl ?? '')}
                </span>
                {isOwner ? (
                  <FileUploader
                    inputId="photo"
                    field="photo"
                    accept={PHOTO_ACCEPT}
                    maxBytes={PHOTO_MAX_BYTES}
                    label="Заменить"
                    pendingLabel="Загружаем…"
                    successTitle="Фото загружено"
                    action={uploadPhotoForRoom}
                  />
                ) : null}
              </div>
            </>
          ) : (
            <>
              <div className="grid aspect-[3/2] place-items-center border border-dashed border-line-strong p-6 text-center text-[15px] leading-relaxed text-ink-2">
                {isOwner ? (
                  <p>
                    Одно фото от двери, чтобы было видно окно и стены.
                    <br />
                    {PHOTO_LIMIT_TEXT}.
                  </p>
                ) : (
                  <p>Фото пока нет. Его загружает владелец проекта.</p>
                )}
              </div>
              {isOwner ? (
                <div className="mt-4">
                  <FileUploader
                    inputId="photo"
                    field="photo"
                    accept={PHOTO_ACCEPT}
                    maxBytes={PHOTO_MAX_BYTES}
                    label="Загрузить фото"
                    pendingLabel="Загружаем…"
                    successTitle="Фото загружено"
                    action={uploadPhotoForRoom}
                  />
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="flex flex-col gap-10">
          {isOwner ? <RoomConditionForm roomId={room.id} condition={room.condition} /> : null}
          {isOwner ? (
            <RoomNotesForm roomId={room.id} notes={room.notes} />
          ) : room.notes ? (
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-2">
                Заметки
              </p>
              <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink">
                {room.notes}
              </p>
            </div>
          ) : null}
          <ConceptsPanel
            roomId={room.id}
            projectId={room.projectId}
            hasPhoto={Boolean(room.photoUrl)}
            keepsFurniture={room.condition === 'keep'}
            onboarded={Boolean(room.project.onboardedAt)}
            canGenerate={isOwner}
            role={room.role}
            other={other ? { name: other.name } : null}
            latestBatchId={latestBatchId}
            initialRun={runningGeneration}
            items={conceptItems.map((item) => ({
              id: item.id,
              batchId: item.batchId,
              batchKind: item.batchKind,
              editRequest: item.editRequest,
              title: item.title,
              status: item.status,
              renderSrc: item.renderSrc,
              owner: item.likedByOwner,
              partner: item.likedByPartner,
              orderIndex: item.orderIndex,
            }))}
          />
        </div>
      </div>

      {isOwner ? (
        <div className="mt-14 border-t border-line pt-5">
          <DeleteRoomDialog roomId={room.id} name={room.name} />
        </div>
      ) : null}
      <ChatDrawer
        projectId={room.projectId}
        roomId={room.id}
        hasConcepts={conceptItems.length > 0}
        canRun={isOwner}
      />
    </section>
  )
}
