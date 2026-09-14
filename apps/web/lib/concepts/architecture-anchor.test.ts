import {
  type ConceptRenderer,
  type RenderRequest,
  type RenderResult,
  renderArchitectureAnchoredBatch,
} from '@uyut/ai'
import { describe, expect, it } from 'vitest'

const rendered = (name: string): RenderResult => ({
  body: Buffer.from(name),
  contentType: 'image/webp',
  model: 'test',
  seed: null,
})

function fakeRenderer(run: (request: RenderRequest, index: number) => Promise<RenderResult>) {
  const requests: RenderRequest[] = []
  const engine: ConceptRenderer = {
    model: 'test',
    render(request) {
      requests.push(request)
      return run(request, requests.length - 1)
    },
  }
  return { engine, requests }
}

describe('пакет с архитектурным якорем', () => {
  it('передаёт первый кадр остальным вариантам и сохраняет порядок', async () => {
    const { engine, requests } = fakeRenderer(async (_request, index) => rendered(String(index)))
    const plan = renderArchitectureAnchoredBatch(engine, [
      { prompt: 'Первый' },
      { prompt: 'Второй' },
      { prompt: 'Третий' },
    ])
    const results = await Promise.all(plan.results)
    expect(results.map((result) => result.body.toString())).toEqual(['0', '1', '2'])
    expect(requests).toHaveLength(3)
    expect(requests[0]?.imageUrl).toBeUndefined()
    expect(requests[1]?.imageUrl).toBe('data:image/webp;base64,MA==')
    expect(requests[2]?.imageUrl).toBe(requests[1]?.imageUrl)
    expect(requests[1]?.prompt).toContain('architecture anchor')
    expect(requests[1]?.prompt).toContain('Второй')
  })

  it('не повторяет первый запрос при отказе якоря', async () => {
    const { engine, requests } = fakeRenderer(async (request, index) => {
      if (index === 0) throw new Error('anchor failed')
      return rendered(request.prompt)
    })
    const plan = renderArchitectureAnchoredBatch(engine, [
      { prompt: 'Первый' },
      { prompt: 'Второй' },
      { prompt: 'Третий' },
    ])
    const outcomes = await Promise.allSettled(plan.results)
    expect(outcomes[0]?.status).toBe('rejected')
    expect(outcomes.slice(1).every((outcome) => outcome.status === 'fulfilled')).toBe(true)
    expect(requests.map((request) => request.prompt)).toEqual(['Первый', 'Второй', 'Третий'])
    expect(requests.every((request) => request.imageUrl === undefined)).toBe(true)
  })

  it('не маскирует и не повторяет отказ производного edit-запроса', async () => {
    const { engine, requests } = fakeRenderer(async (_request, index) => {
      if (index === 1) throw new Error('edit failed')
      return rendered(String(index))
    })
    const plan = renderArchitectureAnchoredBatch(engine, [
      { prompt: 'Первый' },
      { prompt: 'Второй' },
    ])
    const outcomes = await Promise.allSettled(plan.results)
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['fulfilled', 'rejected'])
    expect(requests).toHaveLength(2)
  })
})
