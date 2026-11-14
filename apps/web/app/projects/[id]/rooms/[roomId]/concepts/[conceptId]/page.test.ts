import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ page: vi.fn(), room: vi.fn(), running: vi.fn() }))
vi.mock('@/lib/session', () => ({ getSession: async () => ({ user: { id: 'owner' } }) }))
vi.mock('@/lib/concepts/objects', () => ({ getConceptPage: mocks.page }))
vi.mock('@/lib/projects/repository', () => ({ getRoom: mocks.room }))
vi.mock('@/lib/concepts/resume-run', () => ({ generationStillRunning: mocks.running }))
vi.mock('@/components/concepts/concept-viewer', () => ({
  ConceptViewer: () => createElement('div', null, 'Сохранённый интерьер и товары'),
}))
vi.mock('@/components/plan-comparison', () => ({ PlanComparison: () => null }))
vi.mock('@/components/concepts/concept-edit-form', () => ({
  ConceptEditForm: ({ busyElsewhere }: { busyElsewhere: boolean }) =>
    createElement('button', { type: 'button', disabled: busyElsewhere }, 'Править'),
}))
vi.mock('@/components/chat/chat-drawer', () => ({
  ChatDrawer: ({ canRun }: { canRun: boolean }) =>
    createElement('button', { type: 'button', disabled: !canRun }, 'Править в чате'),
}))

import ConceptPage from './page'

async function render() {
  return renderToStaticMarkup(
    await ConceptPage({
      params: Promise.resolve({ id: 'project', roomId: 'room', conceptId: 'concept' }),
    }),
  )
}

describe('сохранённый вариант при сбое очереди', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.page.mockResolvedValue({
      role: 'owner',
      room: { id: 'room', projectId: 'project', projectTitle: 'Квартира', name: 'Спальня' },
      concept: { id: 'concept', orderIndex: 0, status: 'ready' },
      objects: [],
    })
    mocks.room.mockResolvedValue({ id: 'room' })
    mocks.running.mockResolvedValue(false)
  })
  it('оставляет результат доступным, но закрывает обе платные правки при неизвестном статусе', async () => {
    mocks.running.mockRejectedValue(new Error('Queue offline'))
    const html = await render()
    expect(html).toContain('Сохранённый интерьер и товары')
    expect(html).toContain('Не удалось проверить статус предыдущей генерации')
    expect(html).not.toContain('>Править</button>')
    expect(html).toContain('<button type="button" disabled="">Править в чате</button>')
  })
  it('открывает правку после успешной повторной проверки', async () => {
    const html = await render()
    expect(html).toContain('<button type="button">Править</button>')
    expect(html).toContain('<button type="button">Править в чате</button>')
    expect(html).not.toContain('Не удалось проверить')
  })
  it('не разрешает правку через чат пока задача ещё выполняется', async () => {
    mocks.running.mockResolvedValue(true)
    const html = await render()
    expect(html).toContain('<button type="button" disabled="">Править</button>')
    expect(html).toContain('<button type="button" disabled="">Править в чате</button>')
  })
  it('не скрывает отказ доступа к комнате как ошибку очереди', async () => {
    mocks.room.mockRejectedValue(new Error('Access denied'))
    await expect(render()).rejects.toThrow('Access denied')
    expect(mocks.running).not.toHaveBeenCalled()
  })
})
