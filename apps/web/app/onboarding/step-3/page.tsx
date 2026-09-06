import type { Metadata } from 'next'
import { BudgetForm } from '@/components/onboarding/budget-form'
import { OnboardingShell } from '@/components/onboarding/onboarding-shell'
import { requireStepProject, type StepParams } from '@/lib/onboarding/guard'

export const metadata: Metadata = { title: 'Ваш бюджет' }

export default async function Step3({ searchParams }: StepParams) {
  const project = await requireStepProject(searchParams, 3)
  return (
    <OnboardingShell
      step={3}
      title="Ваш бюджет"
      hint="Примерная сумма на всю квартиру. Она задаёт уровень мебели в концептах."
    >
      <BudgetForm projectId={project.id} initial={project.budgetKopecks} />
    </OnboardingShell>
  )
}
