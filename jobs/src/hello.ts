import { logger, task } from '@trigger.dev/sdk'

// Проверочная задача: подтверждает, что проект подключён к Trigger.dev и воркер запускается
export const helloUyut = task({
  id: 'hello-uyut',
  run: async (payload: { name?: string }) => {
    const name = payload.name ?? 'Uyut'
    logger.info('greeting requested', { name })
    return { greeting: `Hello, ${name}` }
  },
})
