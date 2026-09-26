export const CATALOG_FRESH_FOR_MS = 48 * 60 * 60 * 1000

/** Свежесть записи фида, не гарантия цены или наличия на сайте магазина. */
export function catalogFreshnessNotice(
  lastSyncedAt: Date | null | undefined,
  now = new Date(),
): string | null {
  const synced = lastSyncedAt?.getTime()
  if (synced === undefined || !Number.isFinite(synced) || synced > now.getTime()) {
    return 'Дата обновления каталога неизвестна — проверьте цену и наличие в магазине'
  }
  if (now.getTime() - synced > CATALOG_FRESH_FOR_MS) {
    return 'Каталог не обновлялся больше 48 часов — проверьте цену и наличие в магазине'
  }
  return null
}
