import { createHash } from 'node:crypto'
import type { ContractorBrief } from '@uyut/db'
import { completeFalLlm } from './chat'

/** Данные одной комнаты для ТЗ: только то, что мастеру нужно и что мы знаем наверняка */
export type BriefRoomInput = {
  name: string
  kind: string
  condition: 'черновая отделка' | 'отделка есть'
  areaM2: number | null
  concept: {
    note: string | null
    revision: string | null
    finishes: string | null
    objects: Array<{ category: string; product: string | null; priceRub: number | null }>
  } | null
}

export type BriefProjectInput = {
  title: string
  style: string[]
  budgetRub: number | null
  household: {
    adults?: number
    kids?: number
    pets?: boolean
    wfh?: boolean
    cookHome?: boolean
    receiveGuests?: boolean
  } | null
  clientNotes: string | null
}

export type BriefInput = { project: BriefProjectInput; rooms: BriefRoomInput[] }

export const BRIEF_SECTIONS = [
  'Демонтаж и черновые работы',
  'Электрика и свет',
  'Стены',
  'Пол',
  'Потолок',
  'Мебель и монтаж',
] as const

export const BRIEF_SYSTEM_PROMPT = [
  'Ты технический писатель сервиса дизайна интерьера Uyut. По утверждённому концепту комнаты ты составляешь техническое задание для бригады отделочников.',
  'Документ читают мастера, а не заказчик: без обращения на «вы», без восторгов и маркетинга, спокойный редакторский русский язык, короткие абзацы.',
  `Структура для каждой комнаты, ровно шесть разделов в этом порядке: ${BRIEF_SECTIONS.map((title) => `«${title}»`).join(', ')}.`,
  'Правила. Единственный точный размер — площадь комнаты из данных; остальные размеры и расстояния не выдумывай, пиши «уточнить по месту». Количество материалов давай диапазоном с запасом около 10 % от площади. Точки электрики привязывай к мебели на рендере (например, розетка у торшера слева от дивана). Материалы называй по описанию концепта и списку покупок, бренды сверх списка не придумывай. Если комната отмечена как «отделка есть», разделы черновых работ сокращай до «не требуется» с одной фразой почему. Учитывай семью: дети — безопасные углы и розетки с защитой, животные — стойкие покрытия, работа из дома — розетки и свет у рабочего места.',
  'Если у комнаты нет концепта, дай только базовые черновые и чистовые работы по типу комнаты и отметь, что расстановка мебели не утверждена.',
  'Объём: до 350 слов на комнату. В конце общий блок «Что уточнить у заказчика» — не больше пяти пунктов. Отдельно поле summary: два-три предложения о доме для первой страницы документа, для заказчика, на «вы», без восторгов.',
  'Отвечай строго JSON без пояснений и без markdown-обёртки, по схеме: {"summary":string,"rooms":[{"name":string,"sections":[{"title":string,"items":[string]}]}],"questions":[string]}. В items — законченные предложения, по одному пункту работ на элемент.',
].join('\n')

export function buildBriefPrompt(input: BriefInput): string {
  return `Данные проекта в JSON:\n${JSON.stringify(input, null, 2)}\n\nСоставь ТЗ по всем комнатам из данных.`
}

/** Хэш входных данных: тот же проект без изменений не требует нового обращения к модели */
export function briefHash(input: BriefInput): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 32)
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(asString).filter((item): item is string => item !== null)
    : []
}

/**
 * Разбор ответа модели. Терпим обёртку ```json, лишние поля и пустые разделы,
 * но требуем хотя бы одну комнату с разделами — иначе документу нечего печатать.
 */
export function parseBrief(output: string): ContractorBrief {
  const raw = output
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1) {
    throw new Error('ТЗ: в ответе модели нет JSON')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.slice(start, end + 1))
  } catch (error) {
    throw new Error(`ТЗ: JSON не разобрался (${String(error)})`)
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('ТЗ: ответ модели не объект')
  }
  const data = parsed as Record<string, unknown>
  const rooms = Array.isArray(data.rooms) ? data.rooms : []
  const cleanRooms = rooms
    .map((room) => {
      const record = (room ?? {}) as Record<string, unknown>
      const sections = Array.isArray(record.sections) ? record.sections : []
      return {
        name: asString(record.name) ?? 'Комната',
        sections: sections
          .map((section) => {
            const entry = (section ?? {}) as Record<string, unknown>
            return { title: asString(entry.title) ?? '', items: asStringList(entry.items) }
          })
          .filter((section) => section.title !== '' && section.items.length > 0),
      }
    })
    .filter((room) => room.sections.length > 0)
  if (cleanRooms.length === 0) {
    throw new Error('ТЗ: модель не вернула ни одной комнаты с разделами')
  }
  return {
    summary: asString(data.summary) ?? undefined,
    rooms: cleanRooms,
    questions: asStringList(data.questions).slice(0, 5),
  }
}

export type BriefGenerator = (input: BriefInput) => Promise<ContractorBrief>

/**
 * ТЗ считается по комнатам параллельно: одним запросом две комнаты занимали 45 секунд,
 * по одной — вдвое быстрее. Итоговый документ собирается из ответов, summary берётся из первого.
 */
export function createFalBriefGenerator(apiKey: string, model?: string): BriefGenerator {
  return async (input) => {
    if (input.rooms.length === 0) {
      throw new Error('ТЗ: в проекте нет комнат')
    }
    const parts = await Promise.all(
      input.rooms.map(async (room) => {
        const text = await completeFalLlm(apiKey, {
          system: BRIEF_SYSTEM_PROMPT,
          prompt: buildBriefPrompt({ project: input.project, rooms: [room] }),
          ...(model ? { model } : {}),
        })
        return parseBrief(text)
      }),
    )
    const questions = [...new Set(parts.flatMap((part) => part.questions))].slice(0, 5)
    return {
      summary: parts.find((part) => part.summary)?.summary,
      rooms: parts.flatMap((part) => part.rooms),
      questions,
    }
  }
}
