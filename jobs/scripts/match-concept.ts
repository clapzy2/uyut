// Перезапуск подбора предметов для готовых концептов без новой генерации:
// bun run --filter @uyut/jobs match-concept <conceptId> [ещё id...]
import { tasks } from '@trigger.dev/sdk'

const ids = process.argv.slice(2)
if (ids.length === 0) {
  console.error('укажите id концептов')
  process.exit(1)
}
for (const conceptId of ids) {
  const handle = await tasks.trigger('segment-and-match', { conceptId })
  console.log(`запущен ${handle.id} для ${conceptId}`)
}
process.exit(0)
