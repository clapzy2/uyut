import type { BriefInput } from '@uyut/ai'
import { estimateProject, type WorksRates } from '@uyut/catalog'
import {
  type CatalogCategory,
  type Concept,
  catalogItems,
  conceptObjects,
  concepts,
  type ExportKind,
  type ExportOptions,
  type Project,
  projects,
  type Room,
  type RoomKind,
  rooms,
  shoppingListItems,
  shoppingLists,
} from '@uyut/db'
import type { PdfData, PdfImage, PdfRoom, PdfShoppingGroup } from '@uyut/pdf'
import { formatArea, formatPrice } from '@uyut/pdf'
import { and, desc, eq, inArray } from 'drizzle-orm'
import sharp from 'sharp'
import { db } from './db'
import { optionalEnv, requireEnv } from './env'
import { clampText } from './text'

export { clampText }

import { readObject } from './s3'

const categoryLabels: Record<CatalogCategory, string> = {
  sofa: 'Диван',
  chair: 'Кресло',
  table: 'Стол',
  storage: 'Хранение',
  lamp: 'Светильник',
  rug: 'Ковёр',
  bed: 'Кровать',
  decor: 'Декор',
}

const roomKindLabels: Record<RoomKind, string> = {
  living: 'гостиная',
  bedroom: 'спальня',
  kitchen: 'кухня',
  bath: 'ванная',
  kid: 'детская',
}

const styleLabels: Record<string, string> = {
  scandi: 'сканди',
  modern: 'современный',
  loft: 'лофт',
  classic: 'классика',
}

const sourceLabels: Record<string, string> = {
  ozon: 'Ozon',
  wb: 'Wildberries',
  ikea: 'IKEA',
  leroy: 'Леруа Мерлен',
  divan: 'Divan.ru',
  hoff: 'Hoff',
  askona: 'Askona',
  dump: 'Каталог',
}

function conditionLabel(room: Room): string {
  return room.condition === 'bare' ? 'Черновая отделка' : 'Отделка есть'
}

/** Ключ объекта в нашем bucket, если ссылка ведёт в него; иначе null */
function ownKey(url: string): string | null {
  const endpoint = optionalEnv('S3_ENDPOINT')
  const bucket = optionalEnv('S3_BUCKET')
  if (!url.startsWith('http')) {
    return url
  }
  if (endpoint && bucket && url.startsWith(`${endpoint}/${bucket}/`)) {
    return url.slice(`${endpoint}/${bucket}/`.length)
  }
  return null
}

async function fetchExternal(url: string): Promise<Buffer | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8_000) })
    if (!response.ok) {
      return null
    }
    return Buffer.from(await response.arrayBuffer())
  } catch {
    return null
  }
}

/**
 * Картинка для PDF: читается из нашего bucket или скачивается, ужимается до нужной ширины
 * и вшивается data URI. Любая ошибка даёт null — документ собирается без картинки, а не падает.
 */
export async function pdfImage(
  source: string | null | undefined,
  width: number,
  alt?: string,
): Promise<PdfImage | null> {
  if (!source) {
    return null
  }
  try {
    const key = ownKey(source)
    const bytes = key ? (await readObject(key)).body : await fetchExternal(source)
    if (!bytes) {
      return null
    }
    const jpeg = await sharp(bytes)
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer()
    return { src: `data:image/jpeg;base64,${jpeg.toString('base64')}`, alt }
  } catch (error) {
    console.warn('pdf image skipped', source, String(error))
    return null
  }
}

type ShoppingRow = {
  item: typeof shoppingListItems.$inferSelect
  product: typeof catalogItems.$inferSelect
  roomName: string | null
}

export type ProjectSnapshot = {
  project: Project
  rooms: Room[]
  shopping: ShoppingRow[]
  /** Главный концепт комнаты и остальные понравившиеся */
  concepts: Map<string, { main: Concept; alternates: Concept[] }>
  objects: Map<
    string,
    Array<{
      index: number
      category: CatalogCategory
      product: string | null
      priceKopecks: number | null
    }>
  >
}

/** Всё, что нужно документу, одним проходом по базе; картинки читаются позже */
export async function loadSnapshot(projectId: string): Promise<ProjectSnapshot | null> {
  const database = db()
  const [projectRow] = await database
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
  if (!projectRow) {
    return null
  }
  const roomRows = await database
    .select()
    .from(rooms)
    .where(eq(rooms.projectId, projectId))
    .orderBy(rooms.orderIndex)
  const shopping = await database
    .select({ item: shoppingListItems, product: catalogItems, roomName: rooms.name })
    .from(shoppingListItems)
    .innerJoin(shoppingLists, eq(shoppingLists.id, shoppingListItems.listId))
    .innerJoin(catalogItems, eq(catalogItems.id, shoppingListItems.catalogItemId))
    .leftJoin(rooms, eq(rooms.id, shoppingListItems.roomId))
    .where(eq(shoppingLists.projectId, projectId))
    .orderBy(rooms.orderIndex, shoppingListItems.createdAt)

  // Концепт, из которого добавляли товары, становится главным; иначе последний понравившийся
  const objectIds = shopping
    .map((row) => row.item.conceptObjectId)
    .filter((id): id is string => id !== null)
  const objectConcepts = objectIds.length
    ? await database
        .select({ id: conceptObjects.id, conceptId: conceptObjects.conceptId })
        .from(conceptObjects)
        .where(inArray(conceptObjects.id, objectIds))
    : []
  const votes = new Map<string, number>()
  for (const row of objectConcepts) {
    votes.set(row.conceptId, (votes.get(row.conceptId) ?? 0) + 1)
  }

  const conceptMap: ProjectSnapshot['concepts'] = new Map()
  const objectsMap: ProjectSnapshot['objects'] = new Map()
  for (const room of roomRows) {
    const liked = await database
      .select()
      .from(concepts)
      .where(
        and(
          eq(concepts.roomId, room.id),
          eq(concepts.status, 'ready'),
          eq(concepts.likedByOwner, true),
        ),
      )
      .orderBy(desc(concepts.createdAt))
    const voted = [...liked].sort((a, b) => (votes.get(b.id) ?? 0) - (votes.get(a.id) ?? 0))
    const main = voted.find((concept) => (votes.get(concept.id) ?? 0) > 0) ?? liked[0]
    if (!main) {
      continue
    }
    conceptMap.set(room.id, {
      main,
      alternates: liked.filter((concept) => concept.id !== main.id).slice(0, 3),
    })
    const rows = await database
      .select({ object: conceptObjects, product: catalogItems })
      .from(conceptObjects)
      .leftJoin(catalogItems, eq(catalogItems.id, conceptObjects.matchedCatalogItemId))
      .where(eq(conceptObjects.conceptId, main.id))
      .orderBy(conceptObjects.orderIndex)
    objectsMap.set(
      room.id,
      rows.map(({ object, product }) => ({
        index: object.orderIndex + 1,
        category: object.category,
        product: product?.title ?? null,
        priceKopecks: product?.priceKopecks ?? null,
      })),
    )
  }
  return {
    project: projectRow,
    rooms: roomRows,
    shopping,
    concepts: conceptMap,
    objects: objectsMap,
  }
}

export function briefInput(snapshot: ProjectSnapshot): BriefInput {
  const { project } = snapshot
  const notes = snapshot.rooms
    .map((room) => room.notes?.trim())
    .filter((note): note is string => Boolean(note))
  return {
    project: {
      title: project.title,
      style: project.styleTags.map((tag) => styleLabels[tag] ?? tag),
      budgetRub: project.budgetKopecks ? Math.round(project.budgetKopecks / 100) : null,
      household: project.household ?? null,
      clientNotes: notes.length ? notes.join(' ') : null,
    },
    rooms: snapshot.rooms.map((room) => {
      const entry = snapshot.concepts.get(room.id)
      return {
        name: room.name,
        kind: roomKindLabels[room.kind],
        condition: room.condition === 'bare' ? 'черновая отделка' : 'отделка есть',
        areaM2: room.areaM2,
        concept: entry
          ? {
              note: entry.main.note,
              revision: null,
              finishes: entry.main.prompt.slice(0, 600),
              objects: (snapshot.objects.get(room.id) ?? []).map((object) => ({
                category: categoryLabels[object.category].toLowerCase(),
                product: object.product,
                priceRub:
                  object.priceKopecks !== null ? Math.round(object.priceKopecks / 100) : null,
              })),
            }
          : null,
      }
    }),
  }
}

function household(project: Project): string | null {
  const h = project.household
  if (!h) {
    return null
  }
  const parts: string[] = []
  if (h.adults) {
    parts.push(
      h.adults === 1 ? 'один взрослый' : h.adults === 2 ? 'двое взрослых' : `${h.adults} взрослых`,
    )
  }
  if (h.kids) {
    parts.push(h.kids === 1 ? 'ребёнок' : `${h.kids} детей`)
  }
  if (h.pets) {
    parts.push('питомец')
  }
  if (parts.length === 0) {
    return null
  }
  const line = parts.join(', ')
  return line.charAt(0).toUpperCase() + line.slice(1)
}

/**
 * Собирает данные документа: картинки ужимаются параллельно, смета считается той же функцией,
 * что и на странице итогов. ТЗ приходит снаружи — его считает задача, чтобы кэшировать.
 */
export async function buildPdfData(input: {
  snapshot: ProjectSnapshot
  kind: ExportKind
  options: ExportOptions
  rates: WorksRates
  brief: PdfData['brief']
  summary: string | null
}): Promise<PdfData> {
  const { snapshot, kind, options, rates } = input
  const { project } = snapshot
  // Без адреса ссылки вшились бы в купленный PDF ведущими на чужой домен: лучше упасть
  const appUrl = requireEnv('APP_URL')

  const estimate = estimateProject({
    rooms: snapshot.rooms,
    items: snapshot.shopping.map(({ item, product }) => ({
      priceKopecks: product.priceKopecks,
      quantity: item.quantity,
      variantPriceKopecks: item.selectedVariant?.priceKopecks ?? null,
    })),
    budgetKopecks: project.budgetKopecks,
    rates,
  })

  const roomsWithConcept = snapshot.rooms.filter((room) => snapshot.concepts.has(room.id))
  const pdfRooms: PdfRoom[] = await Promise.all(
    roomsWithConcept.map(async (room): Promise<PdfRoom> => {
      const entry = snapshot.concepts.get(room.id)
      if (!entry) {
        throw new Error('концепт пропал между запросами')
      }
      const [render, before, alternates] = await Promise.all([
        pdfImage(entry.main.editedRenderUrl ?? entry.main.renderUrl, 1400, `${room.name}, концепт`),
        pdfImage(room.photoUrl, 700, `${room.name} до ремонта`),
        Promise.all(
          entry.alternates.map(async (concept, index) => {
            const image = await pdfImage(concept.editedRenderUrl ?? concept.renderUrl, 700)
            return image ? { ...image, caption: `Вариант ${index + 2}` } : null
          }),
        ),
      ])
      return {
        id: room.id,
        name: room.name,
        areaM2: room.areaM2,
        conditionLabel: conditionLabel(room),
        render,
        before,
        alternates: alternates.filter((alt): alt is PdfImage & { caption: string } => alt !== null),
        note: clampText(entry.main.note, 330),
        objects: (snapshot.objects.get(room.id) ?? []).map((object) => ({
          ...object,
          category: categoryLabels[object.category],
        })),
      }
    }),
  )

  const groups = new Map<string, PdfShoppingGroup>()
  for (const row of snapshot.shopping) {
    const key = row.item.roomId ?? 'none'
    const group = groups.get(key) ?? { roomName: row.roomName ?? 'Без комнаты', items: [] }
    const price = row.item.selectedVariant?.priceKopecks ?? row.product.priceKopecks
    group.items.push({
      title: row.product.title,
      meta: [
        sourceLabels[row.product.source] ?? row.product.source,
        row.product.brand,
        row.item.selectedVariant?.color,
      ]
        .filter(Boolean)
        .join(' · '),
      image: await pdfImage(row.product.images[0]?.url, 360),
      quantity: row.item.quantity,
      priceKopecks: price,
      totalKopecks: price * row.item.quantity,
      adDisclosure: row.product.attributes?.adDisclosure?.trim() || undefined,
    })
    groups.set(key, group)
  }

  const cover = pdfRooms[0]?.render ?? null
  const bandSource = pdfRooms[0]?.alternates[0] ?? pdfRooms[1]?.render ?? null
  const areaTotal =
    project.totalAreaM2 ?? (estimate.works.areaM2 > 0 ? estimate.works.areaM2 : null)
  const roomNames = snapshot.rooms.map((room) => room.name.toLowerCase())
  const subtitleParts = [
    roomNames.length ? roomNames.join(', ').replace(/^./, (c) => c.toUpperCase()) : null,
    formatArea(areaTotal),
    project.budgetKopecks ? `бюджет ${formatPrice(project.budgetKopecks)}` : null,
  ].filter((part): part is string => Boolean(part))
  const family = household(project)

  const contact = project.contact ?? {}
  return {
    kind,
    generatedAt: new Date(),
    project: {
      title: project.title,
      subtitle: [subtitleParts.join(' · '), family ? `Для семьи: ${family.toLowerCase()}.` : null]
        .filter(Boolean)
        .join('. '),
      facts: [
        {
          label: 'Стиль',
          value: project.styleTags.map((tag) => styleLabels[tag] ?? tag).join(', ') || 'не выбран',
        },
        { label: 'Семья', value: family ?? 'не указана' },
        {
          label: 'Комнаты',
          value: snapshot.rooms
            .map((room) => `${room.name} ${formatArea(room.areaM2) ?? ''}`.trim())
            .join(', '),
        },
        {
          label: 'Состояние',
          value: [...new Set(snapshot.rooms.map(conditionLabel))].join(', ') || '—',
        },
      ],
      contact: {
        ...(options.includeClientName && contact.clientName
          ? { clientName: contact.clientName }
          : {}),
        ...(options.includeAddress && contact.address ? { address: contact.address } : {}),
        ...(options.includePhone && contact.phone ? { phone: contact.phone } : {}),
      },
      projectUrl: `${appUrl.replace(/^https?:\/\//, '')}/projects/${project.id}`,
    },
    summary: input.summary,
    cover,
    band: bandSource
      ? {
          src: bandSource.src,
          alt: `${pdfRooms[0]?.name ?? 'Комната'}, ещё один понравившийся вариант.`,
        }
      : null,
    rooms: pdfRooms,
    roomsWithoutConcept: snapshot.rooms
      .filter((room) => !snapshot.concepts.has(room.id))
      .map((room) => room.name),
    shopping: [...groups.values()],
    estimate,
    rates,
    brief: input.brief,
  }
}
