type AuthErrorLike =
  | {
      code?: string
      message?: string
      status?: number
    }
  | null
  | undefined

const byCode: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'Почта или пароль не подходят. Проверьте и попробуйте ещё раз.',
  USER_ALREADY_EXISTS: 'Такая почта уже зарегистрирована. Войдите или восстановите пароль.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:
    'Такая почта уже зарегистрирована. Войдите или восстановите пароль.',
  INVALID_TOKEN: 'Ссылка устарела или уже использована. Запросите новую.',
  INVALID_PASSWORD: 'Текущий пароль не подходит.',
  PASSWORD_TOO_SHORT: 'Пароль не короче 8 знаков.',
  PASSWORD_TOO_LONG: 'Пароль слишком длинный, хватит 128 знаков.',
  EMAIL_NOT_VERIFIED: 'Сначала подтвердите почту: письмо уже у вас.',
  CREDENTIAL_ACCOUNT_NOT_FOUND: 'Для этого аккаунта пароль ещё не задан.',
}

export function authErrorMessage(error: AuthErrorLike): string {
  if (!error) {
    return 'Что-то пошло не так. Попробуйте ещё раз через минуту.'
  }
  if (error.status === 429) {
    return error.message?.includes('адреса')
      ? error.message
      : 'Слишком много попыток. Подождите минуту и попробуйте снова.'
  }
  const known = error.code ? byCode[error.code] : undefined
  if (known) {
    return known
  }
  return 'Не получилось. Попробуйте ещё раз, а если повторится, напишите нам.'
}
