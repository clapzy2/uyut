import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { uploadPlan } from '@/actions/projects'
import { AddRoomDialog } from '@/components/add-room-dialog'
import { DeleteProjectDialog } from '@/components/delete-project-dialog'
import { FileUploader } from '@/components/file-uploader'
import { ProjectSettingsDialog } from '@/components/project-settings-dialog'
import { PLAN_ACCEPT, PLAN_LIMIT_TEXT, PLAN_MAX_BYTES } from '@/lib/files/rules'
import { NotFoundError } from '@/lib/projects/access'
import { fileNameFromKey, formatArea, projectMeta } from '@/lib/projects/format'
import { getProject } from '@/lib/projects/repository'
import { getSession } from '@/lib/session'
import { presignedObjectUrl } from '@/lib/storage'

type Params = Promise<{ id: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const session = await getSession()
  const { id } = await params
  if (!session) {
    return { title: 'Проект' }
  }
  try {
    const project = await getProject(session.user.id, id)
    return { title: project.title }
  } catch {
    return { title: 'Проект' }
  }
}

export default async function ProjectPage({ params }: { params: Params }) {
  const session = await getSession()
  const { id } = await params
  if (!session) {
    redirect(`/login?next=/projects/${id}`)
  }

  let project: Awaited<ReturnType<typeof getProject>>
  try {
    project = await getProject(session.user.id, id)
  } catch (error) {
    if (error instanceof NotFoundError) {
      notFound()
    }
    throw error
  }

  const planUrl = project.planUrl ? await presignedObjectUrl(project.planUrl) : null
  const planIsPdf = project.planUrl?.endsWith('.pdf') ?? false
  const uploadPlanForProject = uploadPlan.bind(null, project.id)

  return (
    <section className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-14 lg:py-20">
      <Link
        href="/projects"
        className="text-sm text-ink-2 underline decoration-line-strong decoration-1 underline-offset-4 hover:text-ink"
      >
        Все проекты
      </Link>
      <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-[40px] font-normal leading-[1.05] tracking-tight text-ink sm:text-5xl lg:text-[56px]">
            {project.title}
          </h1>
          <p className="mt-2 font-mono text-[13px] text-ink-2">
            {project.houseSeries || project.totalAreaM2 !== null
              ? projectMeta({
                  houseSeries: project.houseSeries,
                  totalAreaM2: project.totalAreaM2,
                  roomCount: project.rooms.length,
                })
              : `серия и площадь не указаны · ${projectMeta({ houseSeries: null, totalAreaM2: null, roomCount: project.rooms.length })}`}
          </p>
        </div>
        <ProjectSettingsDialog
          projectId={project.id}
          initial={{
            title: project.title,
            houseSeries: project.houseSeries,
            totalAreaM2: project.totalAreaM2,
          }}
        />
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-[5fr_7fr] lg:gap-14">
        <div>
          <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-2">
            План
          </p>
          {planUrl ? (
            <>
              <div className="overflow-hidden border border-line bg-muted">
                {planIsPdf ? (
                  <div className="grid aspect-[4/3] place-items-center text-center">
                    <div>
                      <p className="font-mono text-sm uppercase tracking-[0.1em] text-ink-2">PDF</p>
                      <a
                        href={planUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 inline-block text-[15px] text-ink underline decoration-accent decoration-1 underline-offset-4"
                      >
                        Открыть
                      </a>
                    </div>
                  </div>
                ) : (
                  // biome-ignore lint/performance/noImgElement: подписанная ссылка живёт 15 минут, оптимизатор next/image здесь не нужен
                  <img src={planUrl} alt="План квартиры" className="block w-full" />
                )}
              </div>
              <div className="mt-3 flex flex-wrap items-baseline justify-between gap-3">
                <span className="font-mono text-[13px] text-ink-2">
                  {fileNameFromKey(project.planUrl ?? '')}
                </span>
                <FileUploader
                  inputId="plan"
                  field="plan"
                  accept={PLAN_ACCEPT}
                  maxBytes={PLAN_MAX_BYTES}
                  label="Заменить"
                  pendingLabel="Загружаем…"
                  successTitle="План загружен"
                  action={uploadPlanForProject}
                />
              </div>
            </>
          ) : (
            <>
              <div className="grid aspect-[4/3] place-items-center border border-dashed border-line-strong p-6 text-center text-[15px] leading-relaxed text-ink-2">
                <p>
                  {PLAN_LIMIT_TEXT}.
                  <br />
                  Без плана тоже можно: комнаты добавляются вручную.
                </p>
              </div>
              <div className="mt-4">
                <FileUploader
                  inputId="plan"
                  field="plan"
                  accept={PLAN_ACCEPT}
                  maxBytes={PLAN_MAX_BYTES}
                  label="Загрузить план"
                  pendingLabel="Загружаем…"
                  successTitle="План загружен"
                  action={uploadPlanForProject}
                />
              </div>
            </>
          )}
        </div>

        <div>
          <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-2">
            Комнаты
          </p>
          {project.rooms.length === 0 ? (
            <div className="border-y border-line py-7">
              <h2 className="font-serif text-2xl leading-tight text-ink">Комнат пока нет.</h2>
              <p className="mt-2 max-w-md text-[15px] text-ink-2">
                Добавьте те, что хотите обставить: гостиную, спальню или кухню. Остальные типы
                появятся позже.
              </p>
              <div className="mt-4">
                <AddRoomDialog projectId={project.id} />
              </div>
            </div>
          ) : (
            <>
              <ul className="border-t border-line">
                {project.rooms.map((room) => (
                  <li key={room.id} className="border-b border-line">
                    <Link
                      href={`/projects/${project.id}/rooms/${room.id}`}
                      className="group flex items-baseline justify-between gap-4 py-4"
                    >
                      <span className="font-serif text-[22px] leading-tight text-ink decoration-accent decoration-1 underline-offset-[6px] group-hover:underline">
                        {room.name}
                      </span>
                      <span className="shrink-0 font-mono text-[13px] text-ink-2">
                        {[formatArea(room.areaM2), room.photoUrl ? 'фото есть' : 'без фото']
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="mt-5">
                <AddRoomDialog projectId={project.id} />
              </div>
            </>
          )}
        </div>
      </div>

      <div className="mt-14 border-t border-line pt-5">
        <DeleteProjectDialog projectId={project.id} title={project.title} />
      </div>
    </section>
  )
}
