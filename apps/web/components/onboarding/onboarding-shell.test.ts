import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { OnboardingShell } from './onboarding-shell'

function renderStep(step: number, title: string) {
  const props = { step, title, children: 'Форма' }
  return renderToStaticMarkup(createElement(OnboardingShell, props))
}

describe('понятная подготовка проекта', () => {
  it('объясняет при первом входе разницу между анкетой и готовым проектом', () => {
    const html = renderStep(1, 'Квартира')
    expect(html).toContain('Эти пять шагов — анкета, не готовый проект')
    expect(html).toContain('Далее: Образ жизни')
    expect(html).toContain('aria-label="Подготовка проекта"')
  })

  it('называет текущий и следующий этап, не только показывает полосы', () => {
    const html = renderStep(3, 'Ваш бюджет')
    expect(html).toContain('aria-valuetext="Шаг 3 из 5: Бюджет"')
    expect(html).toContain('Далее: Стиль')
  })

  it('после последнего вопроса обещает переход к проекту, не готовый интерьер', () => {
    const html = renderStep(5, 'Любимый интерьер')
    expect(html).toContain('Далее: ваш проект')
    expect(html).not.toContain('Всё готово')
  })
})
