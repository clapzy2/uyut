import type { LayoutItem } from '@uyut/catalog'
import type { PlanGeometry, PlanPoint, PlanReading, PlanWall, RoomMeasurements } from '@uyut/db'

/**
 * Synthetic regression apartment, not an actual survey or a reconstruction of a user's PDF.
 * All centimetre values below are deliberately supplied test inputs. No AI or database access.
 */
const description =
  'СИНТЕТИЧЕСКАЯ ТЕСТОВАЯ КВАРТИРА. Это правдоподобный набор заданных размеров, а не натурный обмер и не проект перепланировки. Не использовать для ремонта или заказа мебели.'

function rectangle(x: number, y: number, width: number, depth: number): PlanPoint[] {
  return [
    { xCm: x, yCm: y },
    { xCm: x + width, yCm: y },
    { xCm: x + width, yCm: y + depth },
    { xCm: x, yCm: y + depth },
  ]
}

function areaM2(polygon: readonly PlanPoint[]): number {
  let doubledArea = 0
  for (const [index, point] of polygon.entries()) {
    const next = polygon[(index + 1) % polygon.length]
    if (next) doubledArea += point.xCm * next.yCm - next.xCm * point.yCm
  }
  return Math.abs(doubledArea) / 20_000
}

function wall(
  id: string,
  start: PlanPoint,
  end: PlanPoint,
  thicknessCm: number,
  kind: PlanWall['kind'],
): PlanWall {
  return { id, start, end, kind, thicknessCm, measuredThicknessCm: thicknessCm, heightCm: 270 }
}

const balconyFloor: PlanPoint[] = [
  { xCm: 390, yCm: 670 },
  { xCm: 640, yCm: 670 },
  { xCm: 640, yCm: 740 },
  { xCm: 590, yCm: 790 },
  { xCm: 390, yCm: 790 },
]

// Main floor envelope is 600 × 600 cm. The 80 × 30 cm reveal connects the balcony floor.
// This envelope also contains partition footprints; it is not the sum of usable room areas.
const footprint: PlanPoint[] = [
  { xCm: 40, yCm: 40 },
  { xCm: 640, yCm: 40 },
  { xCm: 640, yCm: 640 },
  { xCm: 520, yCm: 640 },
  { xCm: 520, yCm: 670 },
  { xCm: 640, yCm: 670 },
  { xCm: 640, yCm: 740 },
  { xCm: 590, yCm: 790 },
  { xCm: 390, yCm: 790 },
  { xCm: 390, yCm: 670 },
  { xCm: 440, yCm: 670 },
  { xCm: 440, yCm: 640 },
  { xCm: 40, yCm: 640 },
]

// The diagonal wall axis is 10 cm outside its room-facing floor edge, not that floor edge.
const diagonalOffset = 10 * Math.SQRT2
const geometry: PlanGeometry = {
  version: 1,
  source: 'manual',
  status: 'confirmed',
  confirmedAt: '2026-10-08T00:00:00.000Z',
  widthCm: 680,
  heightCm: 830,
  imageCalibration: {
    imageWidthPx: 680,
    imageHeightPx: 830,
    pixelStart: { x: 40, y: 40 },
    pixelEnd: { x: 640, y: 40 },
    worldStart: { xCm: 40, yCm: 40 },
    lengthCm: 600,
    direction: 'right',
    verificationLines: [
      { pixelStart: { x: 40, y: 40 }, pixelEnd: { x: 40, y: 640 }, lengthCm: 600 },
    ],
  },
  routeWidthCm: 70,
  routeStartOpeningId: 'entrance',
  footprint,
  walls: [
    wall('outer-top', { xCm: 25, yCm: 25 }, { xCm: 655, yCm: 25 }, 30, 'outer'),
    wall('outer-right', { xCm: 655, yCm: 25 }, { xCm: 655, yCm: 655 }, 30, 'outer'),
    wall('balcony-junction', { xCm: 655, yCm: 655 }, { xCm: 650, yCm: 655 }, 20, 'outer'),
    wall(
      'balcony-right',
      { xCm: 650, yCm: 655 },
      { xCm: 650, yCm: 730 + diagonalOffset },
      20,
      'outer',
    ),
    wall(
      'balcony-diagonal',
      { xCm: 650, yCm: 730 + diagonalOffset },
      { xCm: 580 + diagonalOffset, yCm: 800 },
      20,
      'outer',
    ),
    wall(
      'balcony-bottom',
      { xCm: 580 + diagonalOffset, yCm: 800 },
      { xCm: 380, yCm: 800 },
      20,
      'outer',
    ),
    wall('balcony-left', { xCm: 380, yCm: 800 }, { xCm: 380, yCm: 655 }, 20, 'outer'),
    wall('outer-bottom-left', { xCm: 380, yCm: 655 }, { xCm: 25, yCm: 655 }, 30, 'outer'),
    wall('outer-left', { xCm: 25, yCm: 655 }, { xCm: 25, yCm: 25 }, 30, 'outer'),
    wall('room-divider', { xCm: 310, yCm: 25 }, { xCm: 310, yCm: 655 }, 20, 'inner'),
    wall('hall-bath', { xCm: 25, yCm: 230 }, { xCm: 310, yCm: 230 }, 20, 'inner'),
    wall('bath-kitchen', { xCm: 25, yCm: 410 }, { xCm: 310, yCm: 410 }, 20, 'inner'),
    wall('balcony-separator', { xCm: 380, yCm: 655 }, { xCm: 650, yCm: 655 }, 30, 'inner'),
  ],
  openings: [
    {
      id: 'entrance',
      type: 'door',
      wallId: 'outer-top',
      offsetCm: 105,
      widthCm: 90,
      bottomCm: 0,
      heightCm: 210,
      clearance: { side: 'left', depthCm: 90, shape: 'swing', hinge: 'start' },
    },
    {
      id: 'living-door',
      type: 'door',
      wallId: 'room-divider',
      offsetCm: 55,
      widthCm: 80,
      bottomCm: 0,
      heightCm: 205,
      clearance: { side: 'right', depthCm: 80, shape: 'swing', hinge: 'end' },
    },
    {
      id: 'bath-door',
      type: 'door',
      wallId: 'hall-bath',
      offsetCm: 105,
      widthCm: 70,
      bottomCm: 0,
      heightCm: 200,
      clearance: { side: 'left', depthCm: 70, shape: 'swing', hinge: 'start' },
    },
    {
      id: 'kitchen-door',
      type: 'door',
      wallId: 'room-divider',
      offsetCm: 435,
      widthCm: 80,
      bottomCm: 0,
      heightCm: 205,
      clearance: { side: 'left', depthCm: 80, shape: 'swing', hinge: 'start' },
    },
    {
      id: 'balcony-door',
      type: 'balcony',
      wallId: 'balcony-separator',
      offsetCm: 60,
      widthCm: 80,
      bottomCm: 0,
      heightCm: 215,
      clearance: { side: 'right', depthCm: 80, shape: 'swing', hinge: 'start' },
    },
    {
      id: 'living-window',
      type: 'window',
      wallId: 'outer-right',
      offsetCm: 35,
      widthCm: 120,
      bottomCm: 85,
      heightCm: 145,
      sillHeightCm: 90,
    },
    {
      id: 'kitchen-window',
      type: 'window',
      wallId: 'outer-left',
      offsetCm: 95,
      widthCm: 100,
      bottomCm: 105,
      heightCm: 125,
      sillHeightCm: 110,
    },
    {
      id: 'balcony-glazing',
      type: 'window',
      wallId: 'balcony-bottom',
      offsetCm: 20 + diagonalOffset,
      widthCm: 160,
      bottomCm: 40,
      heightCm: 220,
      sillHeightCm: 45,
    },
  ],
  rooms: [
    { name: 'Прихожая', sourceNumber: 1, polygon: rectangle(40, 40, 260, 180) },
    { name: 'Санузел', sourceNumber: 2, polygon: rectangle(40, 240, 260, 160) },
    { name: 'Кухня', sourceNumber: 3, polygon: rectangle(40, 420, 260, 220) },
    { name: 'Гостиная', sourceNumber: 4, polygon: rectangle(320, 40, 320, 600) },
    { name: 'Балкон', sourceNumber: 5, spaceKind: 'balcony', polygon: balconyFloor },
  ],
  kitchenItems: [
    {
      id: 'fridge',
      kind: 'fridge',
      xCm: 45,
      yCm: 425,
      widthCm: 60,
      depthCm: 65,
      heightCm: 200,
      front: 'right',
      openingDepthCm: 65,
      passageCm: 80,
      installationGaps: { top: 5, right: 0, bottom: 0, left: 5 },
    },
    {
      id: 'sink',
      kind: 'sink',
      xCm: 45,
      yCm: 578,
      widthCm: 60,
      depthCm: 60,
      heightCm: 90,
      front: 'top',
      openingDepthCm: 55,
      passageCm: 80,
    },
    {
      id: 'dishwasher',
      kind: 'dishwasher',
      xCm: 105,
      yCm: 578,
      widthCm: 60,
      depthCm: 60,
      heightCm: 82,
      front: 'top',
      openingDepthCm: 60,
      passageCm: 80,
    },
    {
      id: 'worktop',
      kind: 'cabinet',
      xCm: 165,
      yCm: 578,
      widthCm: 60,
      depthCm: 60,
      heightCm: 90,
      front: 'top',
      openingDepthCm: 55,
      passageCm: 80,
    },
    {
      id: 'hob',
      kind: 'hob',
      xCm: 225,
      yCm: 578,
      widthCm: 60,
      depthCm: 60,
      heightCm: 90,
      front: 'top',
      openingDepthCm: 0,
      passageCm: 80,
    },
  ],
  utilityPoints: [
    { id: 'kitchen-water', kind: 'water', xCm: 60, yCm: 630, heightCm: 55, reachCm: 150 },
    { id: 'kitchen-drain', kind: 'drain', xCm: 70, yCm: 630, heightCm: 45, reachCm: 150 },
    { id: 'kitchen-vent', kind: 'vent', xCm: 270, yCm: 630, heightCm: 240, reachCm: 180 },
    { id: 'hob-socket', kind: 'socket', xCm: 260, yCm: 625, heightCm: 35, reachCm: 120 },
    { id: 'fridge-socket', kind: 'socket', xCm: 50, yCm: 430, heightCm: 35, reachCm: 120 },
    { id: 'bath-water', kind: 'water', xCm: 60, yCm: 350, heightCm: 55, reachCm: 120 },
    { id: 'bath-drain', kind: 'drain', xCm: 70, yCm: 350, heightCm: 30, reachCm: 120 },
    { id: 'living-radiator', kind: 'radiator', xCm: 630, yCm: 110, heightCm: 55, reachCm: 30 },
    { id: 'kitchen-radiator', kind: 'radiator', xCm: 48, yCm: 525, heightCm: 55, reachCm: 25 },
  ],
  warnings: [description],
}

const kinds = ['living', 'bath', 'kitchen', 'living', 'living'] as const
const reading: PlanReading = {
  planState: 'existing',
  ceilingCm: 270,
  readAt: '2026-10-08T00:00:00.000Z',
  confirmedAt: '2026-10-08T00:00:00.000Z',
  geometry,
  rooms: geometry.rooms.map((room, index) => ({
    name: room.name,
    sourceNumber: room.sourceNumber,
    kind: kinds[index] ?? 'living',
    ...(room.spaceKind ? { spaceKind: room.spaceKind } : {}),
    utility: index === 0,
    ceilingCm: 270,
    widthCm:
      Math.max(...room.polygon.map((point) => point.xCm)) -
      Math.min(...room.polygon.map((point) => point.xCm)),
    depthCm:
      Math.max(...room.polygon.map((point) => point.yCm)) -
      Math.min(...room.polygon.map((point) => point.yCm)),
    areaM2: areaM2(room.polygon),
    layoutNotes:
      index === 4
        ? 'Балкон с диагональным углом 50 × 50 см; ширина и глубина — только габарит контура.'
        : 'Синтетические размеры после отделки; положения проёмов заданы отдельной геометрией.',
  })),
}
reading.totalAreaM2 = reading.rooms
  .filter((room) => room.spaceKind !== 'balcony' && room.spaceKind !== 'loggia')
  .reduce((sum, room) => sum + (room.areaM2 ?? 0), 0)

const measurementsBySourceNumber: Record<number, RoomMeasurements> = Object.fromEntries(
  reading.rooms.map((room) => [
    room.sourceNumber,
    {
      widthCm: room.widthCm,
      depthCm: room.depthCm,
      ceilingCm: room.ceilingCm,
      finishStage: 'after',
      toleranceCm: 0,
      layoutNotes: room.layoutNotes,
      // Zero tolerance is exact synthetic input, not a claim about a real measuring instrument.
      verification: {
        widthCm: room.widthCm ?? 0,
        depthCm: room.depthCm ?? 0,
        finishStage: 'after',
        toleranceCm: 0,
        confirmedAt: '2026-10-08T00:00:00.000Z',
      },
    },
  ]),
)

const furnitureByRoom: Array<{ sourceNumber: number; items: LayoutItem[] }> = [
  {
    sourceNumber: 1,
    items: [
      {
        id: 'hall-bench',
        title: 'Тестовая тумба в прихожей',
        category: 'storage',
        dimensions: { width: 80, depth: 35, height: 45 },
        quantity: 1,
        placement: { xCm: 0, yCm: 100, rotation: 0, frontDirection: 'right' },
      },
    ],
  },
  {
    sourceNumber: 4,
    items: [
      {
        id: 'divan-263961',
        title: 'Контрольный диван 223 × 150 × 90',
        category: 'sofa',
        dimensions: { width: 223, depth: 150, height: 90 },
        quantity: 1,
        operationClearance: { front: 80 },
        placement: { xCm: 160, yCm: 260, rotation: 90, frontDirection: 'left' },
      },
      {
        id: 'divan-302613',
        title: 'Контрольный комод 160 × 41 × 82',
        category: 'storage',
        dimensions: { width: 160, depth: 41, height: 82 },
        quantity: 1,
        operationClearance: { front: 70 },
        placement: { xCm: 110, yCm: 0, rotation: 90, frontDirection: 'right' },
      },
    ],
  },
]

export const realisticBalconyApartment = {
  synthetic: true as const,
  description,
  coordinateSystem: 'centimetres; X right, Y down; room placements local from minimum X/Y',
  areaConvention:
    'Площади комнат — чистые контуры без стен. Балкон показан отдельно без коэффициента. Общий footprint — оболочка пола, включающая перегородки и дверные пороги, не площадь экспликации.',
  geometry,
  reading,
  measurementsBySourceNumber,
  furnitureByRoom,
  areas: {
    roomsM2: reading.rooms.reduce((sum, room) => sum + (room.areaM2 ?? 0), 0),
    interiorM2: reading.rooms.slice(0, 4).reduce((sum, room) => sum + (room.areaM2 ?? 0), 0),
    balconyM2: areaM2(balconyFloor),
    footprintM2: areaM2(footprint),
  },
}
