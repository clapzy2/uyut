/** Обрезка по границе фразы: длинный текст должен кончаться словом, а не серединой слова */
export function clampText(text: string | null, max: number): string | null {
  if (!text) {
    return null
  }
  const trimmed = text.trim()
  if (trimmed.length <= max) {
    return trimmed
  }
  const cut = trimmed.slice(0, max)
  const sentence = cut.lastIndexOf('. ')
  if (sentence > max * 0.45) {
    return cut.slice(0, sentence + 1)
  }
  const space = Math.max(cut.lastIndexOf(', '), cut.lastIndexOf(' '))
  return `${cut
    .slice(0, space > max * 0.6 ? space : max)
    .trim()
    .replace(/[,;:—-]$/, '')
    .trim()}…`
}
