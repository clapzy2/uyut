import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ queue: vi.fn() }))
vi.mock('../../../../packages/ai/src/fal-queue', () => ({
  FalError: class FalError extends Error {},
  falQueue: mocks.queue,
  toDataUri: (image: { body: Buffer }) => `data:image/png;base64,${image.body.toString('base64')}`,
}))

import {
  parseRegionNames,
  readRegionNames,
  type SourcePlanRegions,
} from '../../../../packages/ai/src/floor-plan-region-names'

const image = { body: Buffer.from('original'), contentType: 'image/png' }
const overlay = { body: Buffer.from('overlay'), contentType: 'image/png' }

function source(): SourcePlanRegions {
  const polygon = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ]
  return {
    width: 800,
    height: 400,
    truncated: false,
    regions: [
      { id: 'r1', polygon },
      { id: 'r2', polygon },
    ],
    expectedNames: ['Кухня', 'Балкон'],
  }
}

function response() {
  return {
    assignments: [{ name: 'Кухня', regionId: 'r1' }],
    ignoredRegionIds: ['r2'],
    unresolvedNames: ['Балкон'],
    uncertainties: ['Для балкона нет уверенной области'],
  }
}

beforeEach(() => mocks.queue.mockReset())

describe('experimental source region naming', () => {
  it('returns a fresh draft containing only names, without geometry or metrics', () => {
    const input = {
      ...response(),
      status: 'confirmed',
      widthMm: 6000,
      footprint: [{ x: 100, y: 200 }],
      assignments: [{ name: 'Кухня', regionId: 'r1', polygon: [], area: 5 }],
    }
    const result = parseRegionNames(JSON.stringify(input), source())
    expect(result).toEqual({ status: 'draft', ...response() })
    expect(result.assignments[0]).not.toHaveProperty('polygon')
  })

  it('supports fenced JSON and leaves ambiguous names unresolved', () => {
    const result = parseRegionNames(`\`\`\`json\n${JSON.stringify(response())}\n\`\`\``, source())
    expect(result.unresolvedNames).toEqual(['Балкон'])
    expect(result.ignoredRegionIds).toEqual(['r2'])
  })

  it('rejects malformed JSON rather than extracting an embedded fragment', () => {
    expect(() => parseRegionNames(`Some text ${JSON.stringify(response())}`, source())).toThrow(
      'JSON',
    )
  })

  it('rejects missing expected names', () => {
    expect(() =>
      parseRegionNames(JSON.stringify({ ...response(), unresolvedNames: [] }), source()),
    ).toThrow('Не все ожидаемые')
  })

  it('rejects unexpected or repeated names across both lists', () => {
    for (const unresolvedNames of [['Спальня'], ['Кухня', 'Балкон']]) {
      expect(() =>
        parseRegionNames(JSON.stringify({ ...response(), unresolvedNames }), source()),
      ).toThrow('название')
    }
  })

  it('rejects unknown IDs and duplicate accounting across assigned and ignored IDs', () => {
    for (const ignoredRegionIds of [['unknown'], ['r1', 'r2'], ['r2', 'r2']]) {
      expect(() =>
        parseRegionNames(JSON.stringify({ ...response(), ignoredRegionIds }), source()),
      ).toThrow('идентификатор')
    }
  })

  it('requires every source region to be assigned or explicitly ignored', () => {
    expect(() =>
      parseRegionNames(JSON.stringify({ ...response(), ignoredRegionIds: [] }), source()),
    ).toThrow('Не все исходные области')
  })

  it('allows visible names without an expected-name inventory', () => {
    const candidates = source()
    delete candidates.expectedNames
    expect(parseRegionNames(JSON.stringify(response()), candidates).assignments).toEqual(
      response().assignments,
    )
  })

  it('rejects truncated sources before a paid request', async () => {
    await expect(readRegionNames('key', image, { ...source(), truncated: true })).rejects.toThrow(
      'Неполный набор',
    )
    expect(mocks.queue).not.toHaveBeenCalled()
  })

  it('rejects invalid image dimensions before a paid request', async () => {
    for (const width of [0, 2001, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(readRegionNames('key', image, { ...source(), width })).rejects.toThrow('размеры')
    }
    expect(mocks.queue).not.toHaveBeenCalled()
  })

  it('rejects duplicate IDs, too many regions and invalid polygon bounds', () => {
    const invalidSources: SourcePlanRegions[] = []
    const duplicate = source()
    for (const region of duplicate.regions) region.id = 'r1'
    invalidSources.push(duplicate)
    invalidSources.push({ ...source(), regions: Array(51).fill(source().regions[0]) })
    for (const polygon of [
      [{ x: 0, y: 0 }],
      Array(201).fill({ x: 0, y: 0 }),
      [
        { x: -1, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      [
        { x: 801, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      [
        { x: 0, y: 401 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      [
        { x: Number.NaN, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
    ]) {
      invalidSources.push({ ...source(), regions: [{ id: 'r1', polygon }] })
    }
    for (const candidates of invalidSources) {
      expect(() => parseRegionNames(JSON.stringify(response()), candidates)).toThrow()
    }
  })

  it('rejects duplicated expected names and invalid strings', () => {
    expect(() =>
      parseRegionNames(JSON.stringify(response()), {
        ...source(),
        expectedNames: ['Кухня', 'Кухня'],
      }),
    ).toThrow('повторяются')
    expect(() =>
      parseRegionNames(JSON.stringify({ ...response(), uncertainties: [''] }), source()),
    ).toThrow('подпись')
  })

  it('makes one configured API request with original and optional overlay', async () => {
    mocks.queue.mockResolvedValue({ output: JSON.stringify(response()) })
    const capture = vi.fn().mockResolvedValue(undefined)
    await readRegionNames('key', image, source(), overlay, capture)
    expect(mocks.queue).toHaveBeenCalledTimes(1)
    expect(mocks.queue).toHaveBeenCalledWith(
      'key',
      'openrouter/router/vision',
      expect.objectContaining({
        model: 'anthropic/claude-sonnet-4.5',
        max_tokens: 3000,
        temperature: 0,
        image_urls: [
          `data:image/png;base64,${image.body.toString('base64')}`,
          `data:image/png;base64,${overlay.body.toString('base64')}`,
        ],
      }),
    )
    expect(capture).toHaveBeenCalledWith(JSON.stringify(response()))
  })

  it('captures raw output before JSON failure and never retries', async () => {
    mocks.queue.mockResolvedValue({ output: 'broken JSON' })
    const capture = vi.fn().mockResolvedValue(undefined)
    await expect(readRegionNames('key', image, source(), undefined, capture)).rejects.toThrow(
      'JSON',
    )
    expect(capture).toHaveBeenCalledWith('broken JSON')
    expect(mocks.queue).toHaveBeenCalledTimes(1)
  })

  it('captures partial output before rejecting and rejects empty or failed responses', async () => {
    const capture = vi.fn().mockResolvedValue(undefined)
    for (const result of [
      { output: JSON.stringify(response()), partial: true },
      { output: JSON.stringify(response()), error: 'provider error' },
      { output: '' },
    ]) {
      mocks.queue.mockResolvedValueOnce(result)
      await expect(readRegionNames('key', image, source(), undefined, capture)).rejects.toThrow(
        'неполный ответ',
      )
    }
    expect(mocks.queue).toHaveBeenCalledTimes(3)
    expect(capture).toHaveBeenCalledTimes(2)
  })
})
