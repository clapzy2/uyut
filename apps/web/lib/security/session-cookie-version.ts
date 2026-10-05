// Старые подписанные кэш-cookie не должны переживать отзыв сеансов в БД и Redis.
export const SESSION_COOKIE_CACHE_VERSION = '2026-10-05-private-backup-1'
// Redis остаётся серверным кэшем; браузерный снимок не подтверждает отозванный вход.
export const SESSION_COOKIE_CACHE_ENABLED = false
