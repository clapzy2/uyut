import { describe, expect, it } from 'vitest'
import { readFurnitureReference, signFurnitureReference } from './furniture-reference-token'

const secret = 'test-secret'
const context = {
  userId: 'owner',
  roomId: '10000000-0000-4000-8000-000000000001',
  photoRevision: 3,
}
const key = `projects/20000000-0000-4000-8000-000000000001/rooms/${context.roomId}/furniture-references/30000000-0000-4000-8000-000000000001.webp`
const now = 1_000_000

describe('signed furniture photo reference', () => {
  it('returns only the signed room photo reference', () => {
    const token = signFurnitureReference(secret, context, key, now)
    expect(readFurnitureReference(secret, context, token, now)).toEqual({ key, photoRevision: 3 })
  })
  it.each([
    { ...context, userId: 'another-owner' },
    { ...context, roomId: '10000000-0000-4000-8000-000000000002' },
    { ...context, photoRevision: 4 },
  ])('rejects another owner, room or photo revision', (other) => {
    expect(
      readFurnitureReference(secret, other, signFurnitureReference(secret, context, key, now), now),
    ).toBeNull()
  })
  it('expires exactly after one hour', () => {
    const token = signFurnitureReference(secret, context, key, now)
    expect(readFurnitureReference(secret, context, token, now + 3_599_999)).not.toBeNull()
    expect(readFurnitureReference(secret, context, token, now + 3_600_000)).toBeNull()
  })
  it('rejects tampering and a different signing secret', () => {
    const token = signFurnitureReference(secret, context, key, now)
    const [payload, mac] = token.split('.')
    const receipt = JSON.parse(Buffer.from(payload ?? '', 'base64url').toString())
    receipt.key = key.replace('30000000', '40000000')
    const altered = `${Buffer.from(JSON.stringify(receipt)).toString('base64url')}.${mac}`
    expect(readFurnitureReference(secret, context, altered, now)).toBeNull()
    expect(readFurnitureReference('other-secret', context, token, now)).toBeNull()
  })
  it.each(['', '.', 'a.b.c', `a.${'x'.repeat(43)}`, 'x'.repeat(4097)])(
    'rejects malformed token',
    (token) => {
      expect(readFurnitureReference(secret, context, token, now)).toBeNull()
    },
  )
  it('does not sign arbitrary storage keys or another room', () => {
    expect(() => signFurnitureReference(secret, context, 'private/secret.webp', now)).toThrow()
    expect(() =>
      signFurnitureReference(
        secret,
        context,
        key.replace(context.roomId, '10000000-0000-4000-8000-000000000002'),
        now,
      ),
    ).toThrow()
  })
})
