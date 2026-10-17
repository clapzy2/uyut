import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { PlanPaintedFloorReviewEditor } from './plan-painted-floor-review'

it('keeps technical JSON collapsed while preserving explicit source review', () => {
  const html = renderToStaticMarkup(
    createElement(PlanPaintedFloorReviewEditor, {
      projectId: 'test-project',
      revision: 'test-revision',
      onSaved: vi.fn(),
      onConflict: vi.fn(),
    }),
  )

  expect(html).toContain('Подготовить черновик по подписям PDF')
  expect(html).toContain(
    '<summary class="min-h-11 cursor-pointer py-2 text-[13px] font-medium">Технические данные и ручная правка</summary>',
  )
  expect(html).toContain('JSON выбора областей пола')
  expect(html).toContain('не подтверждение физических границ или обмеров')
  expect(html).toContain('disabled=""')
})
