/**
 * Прокси решает «человек вошёл» по наличию печенья, а страница проверяет подпись и саму сессию.
 * Когда эти два мнения расходятся, получается круг: страница шлёт на вход, прокси — обратно
 * в проекты, и так сотни раз в минуту, пока не сработает ограничитель запросов.
 *
 * Расходятся они не в теории. Печенье переживает свою сессию при сбросе пароля, при смене
 * BETTER_AUTH_SECRET и при переходе на HTTPS: с ним Better Auth начинает писать печенье с
 * приставкой `__Secure-`, а старое, без приставки, остаётся в браузере.
 *
 * Признак, по которому круг узнаётся точно: мы на странице для гостей, печенье при нас, и в
 * адресе есть `next` — то есть нас только что развернула защищённая страница. Значит печенье
 * недействительно: гасим его и показываем вход.
 */

const AUTH_COOKIES = ['better-auth.session_token', 'better-auth.session_data']

export function isStaleSessionBounce(input: {
  hasSessionCookie: boolean
  isGuestOnlyPath: boolean
  hasNextParam: boolean
}): boolean {
  return input.hasSessionCookie && input.isGuestOnlyPath && input.hasNextParam
}

/** Печенье авторизации в любом написании: с приставкой `__Secure-`, `__Host-` и без них */
export function isAuthCookieName(name: string): boolean {
  return AUTH_COOKIES.some((known) => name === known || name.endsWith(`-${known}`))
}
