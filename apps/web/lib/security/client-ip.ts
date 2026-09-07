/** Разобранный адрес клиента прокси кладёт сюда; остальной код читает только этот заголовок */
export const CLIENT_IP_HEADER = 'x-client-ip'

/**
 * X-Forwarded-For подделывается тривиально: клиент присылает свой список, а настоящий адрес
 * дописывает в конец наш обратный прокси. Поэтому запись берём с конца, отсчитывая по числу
 * своих прокси, а если перед приложением их нет, заголовку не верим вовсе.
 */
export function resolveClientIp(headers: Headers, hops: number): string | null {
  if (hops <= 0) {
    return null
  }
  const chain = (headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  // Цепочка короче ожидаемой означает, что запрос пришёл не через наши прокси
  return chain[chain.length - hops] ?? headers.get('x-real-ip')?.trim() ?? null
}
