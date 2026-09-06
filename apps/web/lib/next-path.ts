// Редирект после входа только внутрь сайта: внешние адреса и protocol-relative ссылки отбрасываем
export function safeNextPath(value: string | undefined, fallback = '/projects'): string {
  if (!value?.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return fallback
  }
  return value
}
