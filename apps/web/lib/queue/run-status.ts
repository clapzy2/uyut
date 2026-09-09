/**
 * Чем кончилась фоновая задача.
 *
 * Очередь различает тринадцать состояний, а завершением раньше считались только два:
 * успех и падение. Остальные пять концов — отменена, разбилась, не уложилась в отведённое
 * время, протухла в очереди, сбой платформы — экран ожидания не ловил и висел бесконечно.
 * Это ровно то, что видел человек: галочки замирали на «Рендерим», и выйти было нечем.
 */
const TERMINAL_STATUSES = new Set([
  'COMPLETED',
  'FAILED',
  'CANCELED',
  'CRASHED',
  'SYSTEM_FAILURE',
  'EXPIRED',
  'TIMED_OUT',
])

export function isTerminalRunStatus(status: string | null | undefined): boolean {
  return typeof status === 'string' && TERMINAL_STATUSES.has(status)
}

/**
 * Задача кончилась, но не успехом. Считается отдельно от завершения: человеку нужно сказать
 * разное — «готово» или «не вышло, попробуйте ещё раз».
 */
export function isFailedRunStatus(status: string | null | undefined): boolean {
  return isTerminalRunStatus(status) && status !== 'COMPLETED'
}
