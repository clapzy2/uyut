import { sourceMovePlanIssue, validSourceObject } from '@uyut/ai'
import { describe, expect, it, vi } from 'vitest'
import { renderEditSteps } from '../../../../jobs/src/lib/render-edit-steps'

describe('перенос исходного предмета', () => {
  it('не использует один комод как образец другого предмета', () => {
    expect(
      sourceMovePlanIssue({
        warningRu: '',
        steps: [
          { titleRu: 'Холодильник', prompt: 'Place fridge', needsObject: true },
          { titleRu: 'Комод', prompt: 'Place chest', needsObject: true },
        ],
      }),
    ).toContain('один предмет')
  })
  it('отклоняет слишком длинный план до очереди', () => {
    expect(
      sourceMovePlanIssue({
        warningRu: '',
        steps: [{ titleRu: 'Комод', prompt: 'x'.repeat(601), needsObject: true }],
      }),
    ).toContain('короткий план')
  })
  it.each([
    null,
    {},
    { photoRevision: 0 },
    { photoRevision: -1, box: { x: 0, y: 0, w: 1, h: 1 } },
    { photoRevision: 0, box: { x: 0.9, y: 0, w: 0.2, h: 0.5 } },
    { photoRevision: 0, box: { x: 0, y: 0, w: NaN, h: 0.5 } },
  ])('отклоняет неверное выделение %j', (value) => {
    expect(validSourceObject(value)).toBe(false)
  })

  it('принимает рамку исходного фото без метрических размеров', () => {
    expect(validSourceObject({ photoRevision: 4, box: { x: 0.7, y: 0.5, w: 0.3, h: 0.5 } })).toBe(
      true,
    )
  })

  it('не запускает даже удаление, если образец для последующей установки потерян', async () => {
    const render = vi.fn()
    await expect(
      renderEditSteps(
        { model: 'test', render },
        [
          { prompt: 'Remove cabinet', needsObject: false },
          { prompt: 'Place cabinet under window', needsObject: true },
        ],
        'source',
        [],
        '4:3',
      ),
    ).rejects.toThrow('образец')
    expect(render).not.toHaveBeenCalled()
  })

  it('удаляет без образца, затем ставит исходный предмет по отдельному кадру', async () => {
    const render = vi.fn().mockResolvedValue({
      body: Buffer.from('removed'),
      contentType: 'image/png',
      model: 'test',
      seed: 1,
    })
    await renderEditSteps(
      { model: 'test', render },
      [
        { prompt: 'Remove cabinet', needsObject: false },
        { prompt: 'Place cabinet under window; keep its handles and drawers', needsObject: true },
      ],
      'source',
      ['original-crop'],
      '4:3',
      'Убрать комод справа. Поставить этот же комод под подоконником. Ручки и ящики сохранить.',
    )
    expect(render.mock.calls[0]?.[0].referenceUrls).toBeUndefined()
    expect(render.mock.calls[1]?.[0]).toMatchObject({
      imageUrl: `data:image/png;base64,${Buffer.from('removed').toString('base64')}`,
      referenceUrls: ['original-crop'],
    })
    expect(render.mock.calls[1]?.[0].prompt).toContain('drawer and door arrangement')
    expect(render.mock.calls[0]?.[0].prompt).not.toMatch(/under window|под подоконником/i)
    expect(render.mock.calls[1]?.[0].prompt).toContain('keep its handles and drawers')
  })

  it('передаёт полный запрос в одиночную правку без переноса', async () => {
    const render = vi.fn().mockResolvedValue({ body: Buffer.alloc(0), contentType: 'image/png' })
    await renderEditSteps(
      { model: 'test', render },
      [{ prompt: 'Recolour the bedspread' }],
      'source',
      [],
      '4:3',
      'Подушки оставь тёмно-синими',
    )
    expect(render.mock.calls[0]?.[0].prompt).toContain('Подушки оставь тёмно-синими')
  })
})
