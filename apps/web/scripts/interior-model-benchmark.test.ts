import { describe, expect, it } from 'vitest'
import { styleOrDefault } from '../../../packages/ai/src/prompt'
import type { ConceptBrief } from '../../../packages/ai/src/types'
import {
  benchmarkConfig,
  promptForCase,
  renderReservation,
  validateManifest,
} from './interior-model-benchmark'

const brief: ConceptBrief = {
  roomKind: 'kitchen',
  roomName: 'Кухня',
  areaM2: null,
  condition: 'finished',
  notes: null,
  hasPhoto: true,
  budgetKopecks: null,
  household: null,
  primaryStyle: styleOrDefault(undefined),
  secondaryStyles: [],
  families: [],
}
const caseIds = [
  'compact-kitchen-window',
  'bedroom-two-doors',
  'living-window-doorway',
  'kid-two-openings',
]
const models = ['gpt-image-2.5-sunburst', 'nano-banana-2', 'nano-banana-pro'] as const
function manifest() {
  const cases = caseIds.map((id) => ({
    id,
    sourceId: id === 'kid-two-openings' ? 'bedroom-two-doors' : id,
    brief,
    prompt: promptForCase(brief),
    sourceSha256: 'a'.repeat(64),
  }))
  const jobs = cases.flatMap(({ id }) =>
    models.flatMap((model) =>
      [1, 2].map((repetition) => ({
        id: `${id}--${model}--${repetition}`,
        caseId: id,
        model,
        repetition,
        reservationUsd: renderReservation(model),
      })),
    ),
  )
  return {
    runId: 'test-run',
    cases,
    jobs,
    reservedRenderUsd: jobs.reduce((sum, job) => sum + job.reservationUsd, 0),
  }
}

describe('funded benchmark guards before paid submissions', () => {
  it.each(['prepare', 'render', 'review', 'paired', 'sheets'])(
    'accepts explicit phase %s',
    (phase) => {
      expect(benchmarkConfig([phase, 'funded-2026-09-27'])).toEqual({
        mode: phase,
        runId: 'funded-2026-09-27',
      })
    },
  )
  it.each([
    [],
    ['render'],
    ['render', '../old'],
    ['render', 'a/b'],
    ['render', 'a\\b'],
    ['retry', 'new'],
    ['render', 'new', '--retry'],
    ['render', ''],
  ])('rejects unsafe arguments %j', (...args) => {
    expect(() => benchmarkConfig(args)).toThrow()
  })
  it('accepts the bounded 24-request batch with identical per-case prompts', () => {
    const batch = manifest()
    expect(() => validateManifest(batch, batch.runId)).not.toThrow()
    expect(batch.reservedRenderUsd).toBeCloseTo(5.84)
  })
  it.each(['duplicate', 'path', 'model', 'cost', 'prompt', 'hash', 'count', 'source'])(
    'rejects altered %s',
    (change) => {
      const batch = manifest()
      const job = batch.jobs[0]
      const sample = batch.cases[0]
      const second = batch.cases[1]
      if (!job || !sample || !second) throw new Error('Missing test fixture')
      if (change === 'duplicate') second.id = sample.id
      if (change === 'path') job.id = '../old'
      if (change === 'model') Object.assign(job, { model: 'other-provider' })
      if (change === 'cost') batch.reservedRenderUsd = 0
      if (change === 'prompt') sample.prompt = 'Changed prompt'
      if (change === 'hash') sample.sourceSha256 = ''
      if (change === 'count') batch.jobs.push(job)
      if (change === 'source') sample.sourceId = '../private'
      expect(() => validateManifest(batch, batch.runId)).toThrow()
    },
  )
  it('keeps the production opening and appliance constraints in the shared kitchen prompt', () => {
    const prompt = promptForCase(brief)
    expect(prompt).toContain('same window shape')
    expect(prompt).toContain('Preserve the stated or visible sink connections')
    expect(prompt).toContain('Room dimensions are unknown')
    expect(prompt).toContain('No sofa')
  })
})
