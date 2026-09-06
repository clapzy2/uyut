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
      hint="Двадцать комнат, отмечайте те, где хотели бы жить. Дальше мы подберём похожее для вашей квартиры."
    >
      <StyleSwipe projectId={project.id} />
    </OnboardingShell>
  )
}
