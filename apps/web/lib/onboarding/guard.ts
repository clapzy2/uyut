import { notFound, redirect } from 'next/navigation'
import { NotFoundError } from '@/lib/projects/access'
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
    redirect(`/login?next=/onboarding/step-${step}`)
  }
  if (!project) {
    redirect('/onboarding/step-1')
  }
  try {
    return await getOnboardingState(session.user.id, project)
  } catch (error) {
    if (error instanceof NotFoundError) {
      notFound()
    }
    throw error
  }
}
