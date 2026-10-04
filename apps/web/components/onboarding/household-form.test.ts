import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/actions/onboarding', () => ({ saveHousehold: vi.fn() }))

import { HouseholdForm } from './household-form'

describe('доступные переключатели образа жизни', () => {
  it('сохраняет короткие имена переключателей и связывает отдельные пояснения', () => {
    const html = renderToStaticMarkup(
      createElement(HouseholdForm, { projectId: 'project', initial: null }),
    )
    const toggles = [...html.matchAll(/<input[^>]*type="checkbox"[^>]*>/g)].map((match) => match[0])
    expect(toggles).toHaveLength(4)
    for (const [index, label] of [
      'Есть кот или собака',
      'Готовите дома',
      'Часто принимаете гостей',
      'Работаете из дома',
    ].entries()) {
      expect(toggles[index]).toContain(`aria-label="${label}"`)
      const hintId = toggles[index]?.match(/aria-describedby="([^"]+)"/)?.[1]
      expect(hintId).toBeDefined()
      expect(html).toContain(`id="${hintId}"`)
    }
    expect(toggles[1]).toContain('checked=""')
    expect(toggles[0]).not.toContain('checked=""')
  })

  it('группирует количества нативными radio с реальными значениями', () => {
    const html = renderToStaticMarkup(
      createElement(HouseholdForm, { projectId: 'project', initial: { adults: 3, kids: 1 } }),
    )
    expect(html).toContain('<legend class="text-[15px] font-medium text-ink">Взрослых</legend>')
    expect(html).toMatch(/name="adults"[^>]*checked=""[^>]*value="3"/)
    expect(html).toMatch(/name="kids"[^>]*checked=""[^>]*value="1"/)
  })
})
