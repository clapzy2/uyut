/**
 * После выкатки имена файлов сборки меняются, и уже открытая вкладка при переходе просит кусок
 * кода, которого на сервере больше нет. Для человека это выглядит как поломка сайта, хотя лечится
 * перезагрузкой страницы. Отличаем такую ошибку от настоящей, чтобы перезагрузить молча.
 */
const SIGNS = [
  'chunkloaderror',
  'loading chunk',
  'loading css chunk',
  'failed to fetch dynamically imported module',
  'error loading dynamically imported module',
  'importing a module script failed',
  "unexpected token '<'",
]

export function isStaleBuildError(error: unknown): boolean {
  if (!error) {
    return false
  }
  const source = error instanceof Error ? `${error.name} ${error.message}` : String(error)
  const text = source.toLowerCase()
  return SIGNS.some((sign) => text.includes(sign))
}

const KEY = 'uyut:stale-build-reload'
const QUIET_MS = 30_000

/**
 * Перезагружаем один раз: если после неё ошибка повторилась, дело не в устаревшей сборке,
 * и зацикливать обновление страницы нельзя.
 */
export function shouldReloadOnce(now: number = Date.now()): boolean {
  try {
    const previous = Number(window.sessionStorage.getItem(KEY) ?? 0)
    if (now - previous < QUIET_MS) {
      return false
    }
    window.sessionStorage.setItem(KEY, String(now))
    return true
  } catch {
    // Приватный режим или запрет на хранилище: молча не перезагружаем, показываем экран ошибки.
    return false
  }
}
