import type { Metadata } from 'next'
import { HouseholdForm } from '@/components/onboarding/household-form'
import { OnboardingShell } from '@/components/onboarding/onboarding-shell'
import { requireStepProject, type StepParams } from '@/lib/onboarding/guard'

export const metadata: Metadata = { title: 'Как вы живёте' }

export default async function Step2({ searchParams }: StepParams) {
  const project = await requireStepProject(searchParams, 2)
  return (
    <OnboardingShell
      step={2}
      title="Как вы живёте"
      hint="От этого зависит, что окажется в комнате: рабочий стол, полка для детских книг, место для кота."
    >
      <HouseholdForm projectId={project.id} initial={project.household ?? null} />
    </OnboardingShell>
  )
}
