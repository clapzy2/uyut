import type { Metadata } from 'next'
import { OnboardingShell } from '@/components/onboarding/onboarding-shell'
import { StyleSwipe } from '@/components/onboarding/style-swipe'
import { requireStepProject, type StepParams } from '@/lib/onboarding/guard'

export const metadata: Metadata = { title: 'Ваш стиль' }

export default async function Step4({ searchParams }: StepParams) {
  const project = await requireStepProject(searchParams, 4)
  return (
    <OnboardingShell
      step={4}
      title="Ваш стиль"
      hint="Оцените хотя бы 10 из 20 комнат и выберите минимум одну, где хотели бы жить. По вашим ответам подберём стиль для квартиры."
    >
      <StyleSwipe key={project.id} projectId={project.id} initialVotes={project.styleVotes} />
    </OnboardingShell>
  )
}
