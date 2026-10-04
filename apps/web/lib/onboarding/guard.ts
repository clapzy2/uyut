import { notFound, redirect } from 'next/navigation'
import { AccessError } from '@/lib/projects/access'
import { getSession } from '@/lib/session'
import { getOnboardingState, type OnboardingState } from './repository'

export type StepParams = { searchParams: Promise<{ project?: string }> }

/**
 * Общая проверка шагов 2-5: нужна сессия и свой проект. Без параметра проекта человек
 * попал сюда по прямой ссылке, отправляем его на первый шаг.
 */
export async function requireStepProject(
  searchParams: StepParams['searchParams'],
  step: number,
): Promise<OnboardingState> {
  const session = await getSession()
  const { project } = await searchParams
  if (!session) {
    const stepPath = `/onboarding/step-${step}`
    const next = project
      ? encodeURIComponent(`${stepPath}?project=${encodeURIComponent(project)}`)
      : stepPath
    redirect(`/login?next=${next}`)
  }
  if (!project) {
    redirect('/onboarding/step-1')
  }
  try {
    return await getOnboardingState(session.user.id, project)
  } catch (error) {
    if (error instanceof AccessError) {
      notFound()
    }
    throw error
  }
}
