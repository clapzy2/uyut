import { describe, expect, it } from 'vitest'
import { isFailedRunStatus, isTerminalRunStatus } from './run-status'

describe('чем кончилась фоновая задача', () => {
  it('успех и падение — конец', () => {
    expect(isTerminalRunStatus('COMPLETED')).toBe(true)
    expect(isTerminalRunStatus('FAILED')).toBe(true)
  })

  it('молчаливые концы тоже конец: раньше на них экран висел вечно', () => {
    for (const status of ['CANCELED', 'CRASHED', 'SYSTEM_FAILURE', 'EXPIRED', 'TIMED_OUT']) {
      expect(isTerminalRunStatus(status), status).toBe(true)
      expect(isFailedRunStatus(status), status).toBe(true)
    }
  })

  it('пока задача в очереди или считает — ждём', () => {
    for (const status of [
      'PENDING_VERSION',
      'QUEUED',
      'DEQUEUED',
      'EXECUTING',
      'WAITING',
      'DELAYED',
    ]) {
      expect(isTerminalRunStatus(status), status).toBe(false)
      expect(isFailedRunStatus(status), status).toBe(false)
    }
  })

  it('успех не считается провалом, а незнакомое состояние не считается концом', () => {
    expect(isFailedRunStatus('COMPLETED')).toBe(false)
    expect(isTerminalRunStatus(undefined)).toBe(false)
    expect(isTerminalRunStatus(null)).toBe(false)
    expect(isTerminalRunStatus('НЕЧТО_НОВОЕ')).toBe(false)
  })
})
