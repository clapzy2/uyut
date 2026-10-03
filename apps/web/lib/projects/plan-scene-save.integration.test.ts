import { randomUUID } from 'node:crypto'
import { type PlanGeometry, type PlanReading, users } from '@uyut/db'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '@/lib/db'
import { buildPlanScene } from './plan-scene-geometry'
import { planVolume } from './plan-volume'
import { createProject, getProject, setPlanReading, setProjectPlan } from './repository'

// Синтетические мерки проверяют сохранение, а не точность распознавания квартиры.
function geometry(widthCm: number, heightCm: number): PlanGeometry {
  const start = { xCm: 0, yCm: 0 }
  const end = { xCm: widthCm, yCm: 0 }
  const floor = [start, end, { xCm: widthCm, yCm: 300 }, { xCm: 0, yCm: 300 }]
  return {
    version: 1,
    status: 'confirmed',
    source: 'manual',
    widthCm,
    heightCm: 300,
    footprint: floor,
    rooms: [{ name: 'Гостиная', polygon: floor }],
    walls: [{ id: 'top', kind: 'outer', start, end, heightCm }],
    openings: [
      {
        id: 'window',
        type: 'window',
        wallId: 'top',
        offsetCm: 100,
        widthCm: 120,
        bottomCm: 90,
        heightCm: 130,
      },
    ],
    warnings: [],
  }
}

function reading(source: PlanGeometry): PlanReading {
  return {
    readAt: '2026-10-03T00:00:00.000Z',
    planState: 'existing',
    rooms: [{ name: 'Гостиная', kind: 'living' }],
    geometry: source,
  }
}

describe('сохранение правок 2D в базе и повторное построение 3D', () => {
  let owner = ''

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL
    if (
      !databaseUrl ||
      !['localhost', '127.0.0.1', '[::1]'].includes(new URL(databaseUrl).hostname)
    ) {
      throw new Error('Проверка сохранения 3D разрешена только на локальной тестовой БД')
    }
    const [user] = await getDb()
      .insert(users)
      .values({ email: `scene-save-${randomUUID()}@example.test`, displayName: 'Тест 3D' })
      .returning({ id: users.id })
    if (!user) throw new Error('Missing test user')
    owner = user.id
  })

  afterAll(async () => {
    if (owner) await getDb().delete(users).where(eq(users.id, owner))
  })

  async function savedProject(source: PlanGeometry) {
    const project = await createProject(owner, { title: 'Синтетическая проверка сохранения 3D' })
    await setProjectPlan(owner, project.id, 'qa/scene-save.webp')
    const current = await getProject(owner, project.id)
    await setPlanReading(owner, project.id, reading(source), current)
    return getProject(owner, project.id)
  }

  it('читает новые размеры пола, стены и окна без возврата к прежней версии', async () => {
    const original = geometry(400, 270)
    const project = await savedProject(original)
    const changed = geometry(500, 310)
    const window = changed.openings[0]
    if (!window) throw new Error('Missing test window')
    Object.assign(window, { offsetCm: 200, bottomCm: 95, heightCm: 140 })
    await setPlanReading(owner, project.id, reading(changed), project)

    const restored = (await getProject(owner, project.id)).planReading?.geometry
    expect(restored).toEqual(changed)
    expect(project.planReading?.geometry).toEqual(original)
    const volume = restored && planVolume(restored)
    if (!volume) throw new Error('Saved model was not accepted for 3D')
    const scene = buildPlanScene(volume)
    try {
      const floor = scene.surfaces.find((surface) => surface.kind === 'floor')
      if (!floor) throw new Error('Missing floor')
      const points = floor.geometry.getAttribute('position')
      expect(Math.max(...Array.from({ length: points.count }, (_, i) => points.getX(i)))).toBe(5)
      expect(Math.max(...volume.walls.map((wall) => wall.topCm ?? 0))).toBe(310)
      expect(volume.openings[0]).toMatchObject({
        start: { xCm: 200, yCm: 0 },
        end: { xCm: 320, yCm: 0 },
        bottomCm: 95,
        heightCm: 140,
        cut: true,
      })
    } finally {
      for (const item of [...scene.surfaces, ...scene.lines]) item.geometry.dispose()
    }
  })

  it('после очистки высот не восстанавливает прежнюю стену и вырез окна', async () => {
    const project = await savedProject(geometry(400, 270))
    const changed = geometry(400, 270)
    const wall = changed.walls[0]
    const window = changed.openings[0]
    if (!wall || !window) throw new Error('Missing test wall or window')
    delete wall.heightCm
    delete window.heightCm
    delete window.bottomCm
    await setPlanReading(owner, project.id, reading(changed), project)

    const restored = (await getProject(owner, project.id)).planReading?.geometry
    expect(restored).toEqual(changed)
    const volume = restored && planVolume(restored)
    if (!volume) throw new Error('Saved model was not accepted for 3D')
    expect(volume.openings[0]?.cut).toBe(false)
    const scene = buildPlanScene(volume)
    try {
      expect(scene.surfaces.filter((surface) => surface.kind === 'wall')).toEqual([])
      expect(scene.lines.map((line) => line.kind).sort()).toEqual(['opening', 'wall'])
      for (const line of scene.lines) {
        expect(line.unknown).toBe(true)
        const points = line.geometry.getAttribute('position')
        expect(Array.from({ length: points.count }, (_, i) => points.getY(i))).toEqual(
          Array(points.count).fill(0),
        )
      }
    } finally {
      for (const item of [...scene.surfaces, ...scene.lines]) item.geometry.dispose()
    }
  })

  it('сохраняет правки и удаление кухонного модуля без старых габаритов в 3D', async () => {
    const original = geometry(400, 270)
    original.kitchenItems = [
      {
        id: 'cabinet',
        kind: 'cabinet',
        xCm: 100,
        yCm: 100,
        widthCm: 60,
        depthCm: 80,
        heightCm: 90,
      },
    ]
    const project = await savedProject(original)
    const changed = structuredClone(original)
    const cabinet = changed.kitchenItems?.[0]
    if (!cabinet) throw new Error('Missing test kitchen module')
    cabinet.xCm = 180
    cabinet.widthCm = 80
    delete cabinet.heightCm
    Object.assign(cabinet, {
      front: 'right',
      openingDepthCm: 10,
      passageCm: 20,
      installationGaps: { top: 0, right: 5, bottom: 0, left: 0 },
    })
    await setPlanReading(owner, project.id, reading(changed), project)

    const updated = await getProject(owner, project.id)
    const restored = updated.planReading?.geometry
    expect(restored).toEqual(changed)
    const model = restored && planVolume(restored)
    if (!model) throw new Error('Saved kitchen was not accepted for 3D')
    expect(model.floorZones).toHaveLength(2)
    expect(model.floorZones?.[0]).toMatchObject({
      floor: [
        { xCm: 260, yCm: 100 },
        { xCm: 290, yCm: 100 },
        { xCm: 290, yCm: 180 },
        { xCm: 260, yCm: 180 },
      ],
    })
    expect(model.furniture).toEqual([
      {
        id: 'kitchen:cabinet',
        title: 'Гарнитур',
        floor: [
          { xCm: 180, yCm: 100 },
          { xCm: 260, yCm: 100 },
          { xCm: 260, yCm: 180 },
          { xCm: 180, yCm: 180 },
        ],
      },
    ])
    const scene = buildPlanScene(model)
    try {
      const furniture = scene.surfaces.filter((surface) => surface.kind === 'furniture')
      expect(furniture).toHaveLength(1)
      expect(furniture[0]?.footprintOnly).toBe(true)
    } finally {
      for (const item of [...scene.surfaces, ...scene.lines]) item.geometry.dispose()
    }

    changed.kitchenItems = []
    await setPlanReading(owner, project.id, reading(changed), updated)
    const removed = (await getProject(owner, project.id)).planReading?.geometry
    expect(removed).toEqual(changed)
    expect(removed && planVolume(removed)?.furniture).toBeUndefined()
    expect(removed && planVolume(removed)?.floorZones).toBeUndefined()
  })
})
