const MAX = 18

/**
 * Имя для интерфейса. Пока профиль не заполнен, берём часть адреса до собачки, но служебные
 * адреса вроде it-partner-1788786232467 режем по разделителю: иначе подпись растягивает строку
 * и читается как сбой, а не как имя человека.
 */
export function personName(
  name: string | null | undefined,
  email: string | null | undefined,
  fallback: string,
): string {
  const filled = name?.trim()
  if (filled) {
    return filled
  }
  const local = email?.split('@')[0]?.trim()
  if (!local) {
    return fallback
  }
  if (local.length <= MAX) {
    return local
  }
  const cut = local.slice(0, MAX)
  const separator = Math.max(cut.lastIndexOf('-'), cut.lastIndexOf('.'), cut.lastIndexOf('_'))
  return separator >= 3 ? cut.slice(0, separator) : `${cut.slice(0, MAX - 1)}…`
}
