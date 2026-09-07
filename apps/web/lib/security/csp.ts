/**
 * Одноразовый номер на каждый ответ: Next.js находит его в заголовке запроса и проставляет
 * своим тегам script, поэтому чужой скрипт, попавший в разметку, браузер не выполнит.
 */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...bytes))
}

type PolicyOptions = {
  /** Сервер разработки: ему нужны eval для горячей замены модулей и сокет */
  dev: boolean
  /** Приложение отдаётся по https: только тогда есть смысл поднимать протокол у подресурсов */
  secure: boolean
  /** Хранилище файлов: подписанные ссылки на планы, фото и рендеры ведут прямо туда */
  storageOrigin: string
}

/**
 * Политика собирается на каждый запрос, потому что номер в script-src каждый раз новый.
 * Картинки и подключения оставлены широкими: товары приходят с доменов магазинов,
 * а очередь задач и сбор ошибок живут на своих адресах, их тут не перечислить.
 */
export function contentSecurityPolicy(
  nonce: string,
  { dev, secure, storageOrigin }: PolicyOptions,
): string {
  const directives: Array<[string, string[]]> = [
    ['default-src', ["'self'"]],
    [
      'script-src',
      // strict-dynamic разрешает загрузку чанков тем скриптам, что уже прошли по номеру;
      // 'self' остаётся ради старых браузеров, которые strict-dynamic не понимают
      ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
    ],
    // Инлайновые стили ставят next/font и анимации свайпа, номер к ним не привязать
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ["'self'", 'data:', 'blob:', 'https:', storageOrigin]],
    ['font-src', ["'self'", 'data:']],
    ['connect-src', ["'self'", 'https:', storageOrigin, ...(dev ? ['ws:'] : [])]],
    ['media-src', ["'self'", 'data:', 'blob:']],
    ['worker-src', ["'self'", 'blob:']],
    ['frame-src', ["'none'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
    ['frame-ancestors', ["'none'"]],
  ]
  const policy = directives.map(([name, values]) => `${name} ${[...new Set(values)].join(' ')}`)
  if (secure) {
    policy.push('upgrade-insecure-requests')
  }
  return policy.join('; ')
}
