import type { Metadata } from 'next'
import { OnboardingShell } from '@/components/onboarding/onboarding-shell'
import { ReferenceForm } from '@/components/onboarding/reference-form'
import { requireStepProject, type StepParams } from '@/lib/onboarding/guard'
import { presignedObjectUrl } from '@/lib/storage'

export const metadata: Metadata = { title: 'Любимый интерьер' }

export default async function Step5({ searchParams }: StepParams) {
  const project = await requireStepProject(searchParams, 5)
  const referenceSrc = project.referenceUrl ? await presignedObjectUrl(project.referenceUrl) : null
  return (
    <OnboardingShell
      step={5}
      title="Есть любимый интерьер?"
      hint="Необязательно. Если есть картинка, которая вам нравится, покажите её — концепты станут ближе к ней."
    >
      <ReferenceForm projectId={project.id} referenceSrc={referenceSrc} />
    </OnboardingShell>
  )
}
