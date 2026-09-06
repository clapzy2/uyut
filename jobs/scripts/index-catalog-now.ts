// Ручной запуск ночной индексации каталога, не дожидаясь 03:00 UTC:
// bun run --filter @uyut/jobs index-now
import { tasks } from '@trigger.dev/sdk'

const now = new Date()
const handle = await tasks.trigger('index-catalog', {
  type: 'DECLARATIVE',
  scheduleId: 'manual',
  timestamp: now,
  lastTimestamp: undefined,
  timezone: 'UTC',
  upcoming: [],
})
console.log(`запущен ${handle.id}`)
process.exit(0)
