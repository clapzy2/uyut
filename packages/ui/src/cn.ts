// Склейка классов без зависимостей: достаточно для наших компонентов
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
