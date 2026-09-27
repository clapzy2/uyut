import { afterEach, describe, expect, it, vi } from 'vitest'

const { queue, access, writeFile } = vi.hoisted(() => ({
  queue: vi.fn(),
  access: vi.fn(),
  writeFile: vi.fn(),
}))
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  access,
  writeFile,
}))
vi.mock('../../../packages/ai/src/fal-queue', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  falQueue: queue,
}))
const originalArguments = process.argv
afterEach(() => {
  process.argv = originalArguments
  vi.unstubAllEnvs()
})

async function runArguments(args: string[], recordedAttempt = false) {
  vi.resetModules()
  access.mockReset()
  if (recordedAttempt) access.mockResolvedValue(undefined)
  else access.mockRejectedValue(new Error('No recorded attempt.'))
  vi.stubEnv('FAL_KEY', undefined)
  process.argv = ['bun', 'plan-reference-call.ts', '__qa_argument_only__.pdf', ...args]
  let failure: unknown
  try {
    await import('./plan-reference-call')
  } catch (error) {
    failure = error
  }
  expect(queue).not.toHaveBeenCalled()
  expect(writeFile).not.toHaveBeenCalled()
  expect(failure).toBeInstanceOf(Error)
  return (failure as Error).message
}

describe('plan reference call argument guards', () => {
  it.each(['../old', 'C:/escape', 'Mixed-Case', 'double--dash', 'trailing-', 'a'.repeat(65)])(
    'rejects unsafe run id %s before source access or a paid call',
    async (runId) => {
      expect(await runArguments(['--run-id', runId, '--run-paid'])).toContain('--run-id:')
    },
  )

  it('accepts a bounded sibling slug but still requires credentials', async () => {
    expect(await runArguments(['--run-id', 'qa-sonnet45-1', '--run-paid'])).toContain('Нет FAL_KEY')
  })

  it.each([['--run-id'], ['--run-id', '--run-paid'], ['--run-id', 'first', '--run-id', 'second']])(
    'rejects missing or duplicate value flags %j',
    async (...args) => {
      expect(await runArguments(args)).toContain('Укажите единственное значение --run-id')
    },
  )

  it.each([['--run-paid', '--run-paid'], ['--unrecognized']])(
    'rejects duplicate and unknown boolean flags %j',
    async (...args) => {
      expect(await runArguments(args)).toContain('Неизвестный или повторный аргумент')
    },
  )

  it('does not allow paid replay', async () => {
    expect(await runArguments(['--run-paid', '--replay'])).toContain(
      'Повторная сверка не может запускать платное чтение',
    )
  })

  it('requires a separate run id for an independently selected QA model', async () => {
    expect(await runArguments(['--model', 'anthropic/claude-sonnet-5', '--run-paid'])).toContain(
      'требуется --run-id',
    )
  })

  it('rejects arbitrary model names before billing', async () => {
    expect(await runArguments(['--model', 'not-a-verified-model', '--run-paid'])).toContain(
      'Модель не входит в проверенный список',
    )
  })

  it('refuses a recorded attempt without overwriting it or submitting a second request', async () => {
    expect(await runArguments(['--run-id', 'existing-run', '--run-paid'], true)).toContain(
      'Попытка уже записана',
    )
  })
})
