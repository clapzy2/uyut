import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { bumpProjectVersion, clearPresence, readLive, touchPresence } from './live'

// Живой канал в настоящем Redis: версия растёт, присутствие появляется и снимается
describe('live channel keys', () => {
  const projectId = `it-live-${randomUUID()}`
  const me = `it-user-${randomUUID()}`
  const other = `it-user-${randomUUID()}`

  it('starts at zero and grows with every like', async () => {
    expect((await readLive(projectId, null)).version).toBe(0)
    expect(await bumpProjectVersion(projectId)).toBe(1)
    expect(await bumpProjectVersion(projectId)).toBe(2)
    expect((await readLive(projectId, other)).version).toBe(2)
  })

  it('shows the other member while their page is open and remembers when they left', async () => {
    const roomId = randomUUID()
    expect((await readLive(projectId, other)).presence).toBeNull()

    await touchPresence(projectId, other, roomId)
    const live = await readLive(projectId, other)
    expect(live.presence?.roomId).toBe(roomId)
    expect(live.presence?.at).toBeGreaterThan(Date.now() - 5_000)

    await clearPresence(projectId, other)
    const gone = await readLive(projectId, other)
    expect(gone.presence).toBeNull()
    expect(gone.lastSeenAt).toBeGreaterThan(Date.now() - 5_000)

    await touchPresence(projectId, me, null)
    expect((await readLive(projectId, me)).presence?.roomId).toBeNull()
    await clearPresence(projectId, me)
  })
})
