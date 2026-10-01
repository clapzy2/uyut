import { accounts, createDb, type PlanGeometry, projects, users } from '@uyut/db'
import { hashPassword } from '../lib/password'

// Синтетический пример для браузерного теста, только в локальной базе.
const connection = process.env.DATABASE_URL
if (!connection || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(connection).hostname))
  throw new Error('Этот тест разрешён только в локальной базе')
const db = createDb(connection)
const id = crypto.randomUUID()
const email = `route-${id}@example.test`
const point = (xCm: number, yCm: number) => ({ xCm, yCm })
const box = (left: number, top: number, right: number, bottom: number) => [
  point(left, top),
  point(right, top),
  point(right, bottom),
  point(left, bottom),
]
const geometry: PlanGeometry = {
  version: 1,
  source: 'manual',
  status: 'draft',
  widthCm: 410,
  heightCm: 200,
  warnings: ['Синтетическая схема для локального теста, не обмер квартиры.'],
  footprint: box(0, 0, 410, 200),
  rooms: [
    { name: 'Коридор', polygon: box(5, 5, 200, 195) },
    { name: 'Гостиная', polygon: box(210, 5, 405, 195) },
  ],
  walls: [
    { id: 'top', kind: 'outer', start: point(0, 0), end: point(410, 0), thicknessCm: 10 },
    { id: 'right', kind: 'outer', start: point(410, 0), end: point(410, 200), thicknessCm: 10 },
    { id: 'bottom', kind: 'outer', start: point(410, 200), end: point(0, 200), thicknessCm: 10 },
    { id: 'left', kind: 'outer', start: point(0, 200), end: point(0, 0), thicknessCm: 10 },
    { id: 'middle', kind: 'inner', start: point(205, 0), end: point(205, 200), thicknessCm: 10 },
  ],
  openings: [
    {
      id: 'entry',
      type: 'door',
      wallId: 'top',
      offsetCm: 50,
      widthCm: 100,
      clearance: { side: 'left', depthCm: 100, shape: 'rectangle' },
    },
    { id: 'between', type: 'door', wallId: 'middle', offsetCm: 60, widthCm: 80 },
  ],
  routeWidthCm: 70,
  routeStartOpeningId: 'entry',
}
if (process.argv.includes('--pdf-faces')) {
  // Имитируем контракт доказательств, а не распознавание реального PDF.
  geometry.rooms = [
    { name: 'Коридор', polygon: box(0, 0, 200, 200) },
    { name: 'Гостиная', polygon: box(210, 0, 410, 200) },
  ]
  geometry.walls = [
    { id: 'top', kind: 'inner', start: point(0, 0), end: point(200, 0) },
    { id: 'middle', kind: 'inner', start: point(200, 0), end: point(200, 200) },
    { id: 'opposite', kind: 'inner', start: point(210, 0), end: point(210, 200) },
  ]
  geometry.openings.push({
    id: 'opposite-door',
    type: 'door',
    wallId: 'opposite',
    offsetCm: 60,
    widthCm: 80,
  })
  const binding = (
    openingId: string,
    cut: [{ xCm: number; yCm: number }, { xCm: number; yCm: number }],
  ) => {
    const opening = geometry.openings.find((item) => item.id === openingId)
    const wall = geometry.walls.find((item) => item.id === opening?.wallId)
    if (!opening || !wall) throw new Error('Неполный локальный пример проёма')
    return structuredClone({ opening, wall, cut })
  }
  geometry.pdfCalibration = {
    sourceSha256: 'a'.repeat(64),
    pdfPage: 1,
    cmPerPoint: 1,
    origin: { x: 0, y: 0 },
    anchorRoomNumbers: [],
    labelIndexes: [],
    derivedOpeningIds: [],
    openingWidthProofs: [{ ...binding('entry', [point(50, 0), point(150, 0)]), labelIndex: 0 }],
    openingFacePairs: [
      {
        bindings: [
          binding('between', [point(200, 60), point(200, 140)]),
          binding('opposite-door', [point(210, 60), point(210, 140)]),
        ],
        jambs: [
          { operationIndex: 0, subpathIndex: 0, segmentIndex: 0 },
          { operationIndex: 0, subpathIndex: 0, segmentIndex: 1 },
        ],
      },
    ],
    wallFaceRoomPolygons: structuredClone(geometry.rooms.map((room) => room.polygon)),
  }
  geometry.pdfCalibration.sourceOpeningFacePairs = structuredClone(
    geometry.pdfCalibration.openingFacePairs,
  )
}
await db.transaction(async (tx) => {
  await tx
    .insert(users)
    .values({ id, email, emailVerified: true, displayName: 'Локальная проверка проходов' })
  await tx.insert(accounts).values({
    userId: id,
    accountId: id,
    providerId: 'credential',
    password: await hashPassword('lampa-u-okna-2026'),
  })
  await tx.insert(projects).values({
    id,
    ownerId: id,
    title: 'Локальный тест проходов — синтетические данные',
    planUrl: 'qa/synthetic-route.svg',
    planReading: {
      rooms: [
        { name: 'Коридор', kind: 'living', utility: true },
        { name: 'Гостиная', kind: 'living' },
      ],
      readAt: new Date().toISOString(),
      confirmedAt: new Date().toISOString(),
      geometry,
    },
  })
})
console.log(
  JSON.stringify({ email, projectId: id, projectUrl: `http://127.0.0.1:3107/projects/${id}` }),
)
process.exit(0)
