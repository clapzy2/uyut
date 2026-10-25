import { randomUUID } from 'node:crypto'
import { projectedGeometryKey } from '@uyut/catalog/projected-room-layout'
import { type PlanGeometry, projectCollaborators, users } from '@uyut/db'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '@/lib/db'
import { NotFoundError, OwnerOnlyError } from './access'
import {
  createProject,
  createRoom,
  getRoom,
  setPlanReading,
  setRoomProjectedContour,
  updateRoom,
} from './repository'

const geometry: PlanGeometry = {
  version: 1,
  status: 'draft',
  source: 'manual',
  widthCm: 600,
  heightCm: 400,
  walls: [],
  openings: [],
  warnings: [],
  rooms: [
    {
      name: 'Общая зона',
      sourceNumbers: [1, 2, 3],
      polygon: [
        { xCm: 0, yCm: 0 },
        { xCm: 600, yCm: 0 },
        { xCm: 600, yCm: 400 },
        { xCm: 0, yCm: 400 },
      ],
    },
  ],
  pdfCalibration: {
    sourceSha256: 'a'.repeat(64),
    pdfPage: 2,
    sourceState: 'proposed',
    cmPerPoint: 1,
    origin: { x: 0, y: 0 },
    anchorRoomNumbers: [],
    labelIndexes: [],
    derivedOpeningIds: [],
  },
}

describe('owner-scoped projected furnishing bindings', () => {
  const userIds: string[] = []
  let owner = ''
  let partner = ''
  let stranger = ''
  beforeAll(async () => {
    for (const name of ['owner', 'partner', 'stranger']) {
      const [user] = await getDb()
        .insert(users)
        .values({
          email: `projected-binding-${name}-${randomUUID()}@example.test`,
          displayName: name,
        })
        .returning({ id: users.id })
      if (!user) throw new Error('Missing user')
      userIds.push(user.id)
    }
    ;[owner, partner, stranger] = userIds as [string, string, string]
  })
  afterAll(async () => {
    if (userIds.length) await getDb().delete(users).where(inArray(users.id, userIds))
  })

  async function fixture() {
    const project = await createProject(owner, { title: 'Синтетическая проектная связь' })
    await setPlanReading(owner, project.id, {
      readAt: new Date().toISOString(),
      rooms: [],
      geometry,
    })
    const first = await createRoom(owner, project.id, { name: 'Старая гостиная', kind: 'living' })
    const second = await createRoom(owner, project.id, { name: 'Другая гостиная', kind: 'living' })
    await updateRoom(owner, first.id, {
      measurements: { widthCm: 320, depthCm: 600, ceilingCm: 270 },
    })
    return { project, first, second }
  }

  it('holds source changes, owner permissions and one physical region under concurrent writes', async () => {
    const { project, first, second } = await fixture()
    await getDb().insert(projectCollaborators).values({ projectId: project.id, userId: partner })
    const input = { roomIndex: 0, expectedGeometryKey: projectedGeometryKey(geometry) as string }
    await expect(setRoomProjectedContour(partner, first.id, input)).rejects.toBeInstanceOf(
      OwnerOnlyError,
    )
    await expect(setRoomProjectedContour(stranger, first.id, input)).rejects.toBeInstanceOf(
      NotFoundError,
    )
    await expect(
      setRoomProjectedContour(owner, first.id, { ...input, expectedGeometryKey: 'stale' }),
    ).rejects.toThrow('изменился')
    const results = await Promise.allSettled([
      setRoomProjectedContour(owner, first.id, input),
      setRoomProjectedContour(owner, second.id, input),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const current = await Promise.all([getRoom(owner, first.id), getRoom(owner, second.id)])
    expect(current.filter((room) => room.measurements?.projectedContour)).toHaveLength(1)
  })

  it('preserves binding across a measurement form update and detaches without inventing values', async () => {
    const { first } = await fixture()
    const key = projectedGeometryKey(geometry) as string
    await setRoomProjectedContour(owner, first.id, { roomIndex: 0, expectedGeometryKey: key })
    expect((await getRoom(owner, first.id)).measurements).toMatchObject({
      widthCm: 320,
      depthCm: 600,
      ceilingCm: 270,
    })
    await updateRoom(owner, first.id, { measurements: { widthCm: 321 } })
    expect((await getRoom(owner, first.id)).measurements?.projectedContour?.geometryKey).toBe(key)
    await expect(
      setRoomProjectedContour(owner, first.id, {
        roomIndex: null,
        expectedGeometryKey: key,
        expectedRoomIndex: 1,
      }),
    ).rejects.toThrow('Связь изменилась')
    await setRoomProjectedContour(owner, first.id, {
      roomIndex: null,
      expectedGeometryKey: key,
      expectedRoomIndex: 0,
    })
    expect((await getRoom(owner, first.id)).measurements).toEqual({ widthCm: 321 })
  })

  it('does not restore a detached binding from an old measurement patch during concurrent saves', async () => {
    const { first } = await fixture()
    const key = projectedGeometryKey(geometry) as string
    await setRoomProjectedContour(owner, first.id, { roomIndex: 0, expectedGeometryKey: key })
    const staleMeasurements = (await getRoom(owner, first.id)).measurements
    await Promise.all([
      updateRoom(owner, first.id, { measurements: staleMeasurements }),
      setRoomProjectedContour(owner, first.id, {
        roomIndex: null,
        expectedGeometryKey: key,
        expectedRoomIndex: 0,
      }),
    ])
    expect((await getRoom(owner, first.id)).measurements?.projectedContour).toBeUndefined()
    await updateRoom(owner, first.id, { measurements: staleMeasurements })
    expect((await getRoom(owner, first.id)).measurements?.projectedContour).toBeUndefined()
    await Promise.all([
      updateRoom(owner, first.id, { measurements: staleMeasurements }),
      setRoomProjectedContour(owner, first.id, { roomIndex: 0, expectedGeometryKey: key }),
    ])
    expect((await getRoom(owner, first.id)).measurements?.projectedContour?.geometryKey).toBe(key)
  })
})
