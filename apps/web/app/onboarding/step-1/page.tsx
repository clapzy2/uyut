import { buttonClassName } from '@uyut/ui'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { uploadPlan } from '@/actions/projects'
import { FileUploader } from '@/components/file-uploader'
import { ApartmentForm } from '@/components/onboarding/apartment-form'
import { OnboardingShell } from '@/components/onboarding/onboarding-shell'
import { PLAN_ACCEPT, PLAN_LIMIT_TEXT, PLAN_MAX_BYTES } from '@/lib/files/rules'
import type { StepParams } from '@/lib/onboarding/guard'
import { getOnboardingState } from '@/lib/onboarding/repository'
import { AccessError } from '@/lib/projects/access'
import { fileNameFromKey } from '@/lib/projects/format'
import { getSession } from '@/lib/session'
import { presignedObjectUrl } from '@/lib/storage'

export const metadata: Metadata = { title: 'Расскажите о квартире' }

export default async function Step1({ searchParams }: StepParams) {
  const session = await getSession()
  if (!session) {
    redirect('/login?next=/onboarding/step-1')
  }
  const { project: projectId } = await searchParams

  if (!projectId) {
    return (
      <OnboardingShell
        step={1}
        title="Расскажите о квартире"
        hint="Достаточно названия и комнат. Всё остальное можно поправить потом."
      >
        <ApartmentForm />
      </OnboardingShell>
    )
  }

  // Проект уже создан: этот экран остаётся первым шагом и просит план квартиры
  let project: Awaited<ReturnType<typeof getOnboardingState>>
  try {
    project = await getOnboardingState(session.user.id, projectId)
  } catch (error) {
    if (error instanceof AccessError) {
      notFound()
    }
    throw error
  }

  const planSrc =
    project.planUrl && !project.planUrl.endsWith('.pdf')
      ? await presignedObjectUrl(project.planUrl)
      : null
  const uploadPlanForProject = uploadPlan.bind(null, project.id)

  return (
    <OnboardingShell
      step={1}
      title="Загрузите план"
      hint="Фотография или PDF. По плану мы поймём форму комнат, а комнаты добавим на странице проекта."
    >
      <div className="flex flex-col gap-7">
        {planSrc ? (
          <div className="overflow-hidden border border-line bg-muted">
            {/* biome-ignore lint/performance/noImgElement: подписанная ссылка живёт 15 минут, оптимизатор next/image здесь не нужен */}
            <img src={planSrc} alt="План квартиры" className="block w-full" />
          </div>
        ) : project.planUrl ? (
          <p className="border border-line bg-paper px-4 py-3 font-mono text-[13px] text-ink-2">
            {fileNameFromKey(project.planUrl)}
          </p>
        ) : (
          <div className="grid aspect-[3/2] place-items-center border border-dashed border-line-strong p-6 text-center text-[15px] leading-relaxed text-ink-2">
            <p>{PLAN_LIMIT_TEXT}</p>
          </div>
        )}

        <FileUploader
          inputId="plan"
          field="plan"
          accept={PLAN_ACCEPT}
          maxBytes={PLAN_MAX_BYTES}
          label={project.planUrl ? 'Заменить план' : 'Загрузить план'}
          pendingLabel="Загружаем…"
          successTitle="План загружен"
          action={uploadPlanForProject}
        />

        <div className="flex flex-wrap items-center gap-3">
          <Link href={`/onboarding/step-2?project=${project.id}`} className={buttonClassName()}>
            Дальше
          </Link>
          <Link
            href={`/onboarding/step-2?project=${project.id}`}
            className="text-sm text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink"
          >
            Загружу позже
          </Link>
        </div>
      </div>
    </OnboardingShell>
  )
}
