import type { RoomCondition } from '@uyut/db'

/** Ставки работ, рублей за квадратный метр; берутся из env, по умолчанию 15 000 и 5 000 */
export type WorksRates = { roughRubPerM2: number; finishRubPerM2: number }

export type EstimateRoom = {
  id: string
  name: string
  areaM2: number | null
  condition: RoomCondition
  refreshFinish: boolean
}

export type EstimateItem = {
  priceKopecks: number
  quantity: number
  variantPriceKopecks?: number | null
}

export type RoomWorksKind = 'full' | 'finish' | 'none' | 'no-area'

export type RoomWorks = {
  id: string
  name: string
  areaM2: number | null
  kind: RoomWorksKind
  roughKopecks: number
  finishKopecks: number
  totalKopecks: number
}

export type Estimate = {
  furnitureKopecks: number
  works: {
    roughKopecks: number
    finishKopecks: number
    totalKopecks: number
    /** Площадь комнат, вошедших в расчёт */
    areaM2: number
    rooms: RoomWorks[]
    /** Комнаты без площади: их работы не посчитаны, страница просит указать метры */
    roomsWithoutArea: string[]
  }
  totalKopecks: number
  budgetKopecks: number | null
  /** Сколько остаётся от бюджета; отрицательное значение — перерасход */
  remainingKopecks: number | null
  overBudget: boolean
  /** Доли для BudgetBar от бюджета, а без бюджета — от итога; в сумме не больше единицы */
  shares: { furniture: number; works: number; free: number }
}

export function itemTotalKopecks(item: EstimateItem): number {
  const price = item.variantPriceKopecks ?? item.priceKopecks
  return Math.max(0, Math.round(price)) * Math.max(0, Math.round(item.quantity))
}

function roomWorks(room: EstimateRoom, rates: WorksRates): RoomWorks {
  const base = { id: room.id, name: room.name, areaM2: room.areaM2 }
  if (room.areaM2 === null || !(room.areaM2 > 0)) {
    return { ...base, kind: 'no-area', roughKopecks: 0, finishKopecks: 0, totalKopecks: 0 }
  }
  const area = room.areaM2
  const finish = Math.round(area * rates.finishRubPerM2 * 100)
  if (room.condition === 'bare') {
    const rough = Math.round(area * rates.roughRubPerM2 * 100)
    return {
      ...base,
      kind: 'full',
      roughKopecks: rough,
      finishKopecks: finish,
      totalKopecks: rough + finish,
    }
  }
  if (room.refreshFinish) {
    return { ...base, kind: 'finish', roughKopecks: 0, finishKopecks: finish, totalKopecks: finish }
  }
  return { ...base, kind: 'none', roughKopecks: 0, finishKopecks: 0, totalKopecks: 0 }
}

/**
 * Смета проекта: мебель по строкам списка покупок с учётом цены варианта,
 * работы по комнатам: черновая отделка → черновые и чистовые, готовая → ничего,
 * готовая с флагом «обновить отделку» → только чистовые. Чистая функция без обращений к базе.
 */
export function estimateProject(input: {
  rooms: EstimateRoom[]
  items: EstimateItem[]
  budgetKopecks: number | null
  rates: WorksRates
}): Estimate {
  const furnitureKopecks = input.items.reduce((sum, item) => sum + itemTotalKopecks(item), 0)
  const rooms = input.rooms.map((room) => roomWorks(room, input.rates))
  const counted = rooms.filter((room) => room.kind !== 'no-area')
  const roughKopecks = counted.reduce((sum, room) => sum + room.roughKopecks, 0)
  const finishKopecks = counted.reduce((sum, room) => sum + room.finishKopecks, 0)
  const worksTotal = roughKopecks + finishKopecks
  const totalKopecks = furnitureKopecks + worksTotal
  const budgetKopecks =
    input.budgetKopecks !== null && input.budgetKopecks > 0 ? input.budgetKopecks : null
  const remainingKopecks = budgetKopecks === null ? null : budgetKopecks - totalKopecks
  const base = budgetKopecks ?? totalKopecks
  const furnitureShare = base > 0 ? Math.min(1, furnitureKopecks / base) : 0
  const worksShare = base > 0 ? Math.min(1 - furnitureShare, worksTotal / base) : 0
  return {
    furnitureKopecks,
    works: {
      roughKopecks,
      finishKopecks,
      totalKopecks: worksTotal,
      areaM2: counted.reduce((sum, room) => sum + (room.areaM2 ?? 0), 0),
      rooms,
      roomsWithoutArea: rooms.filter((room) => room.kind === 'no-area').map((room) => room.name),
    },
    totalKopecks,
    budgetKopecks,
    remainingKopecks,
    overBudget: remainingKopecks !== null && remainingKopecks < 0,
    shares: {
      furniture: furnitureShare,
      works: worksShare,
      free: Math.max(0, 1 - furnitureShare - worksShare),
    },
  }
}
