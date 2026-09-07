import { createHash } from 'node:crypto'
import { completeFalLlm } from './chat'

// «Варианты на двоих»: два человека в одной комнате ни разу не совпали, модель читает,
// что понравилось и не понравилось каждому, и предлагает три компромиссных варианта.

export type DuoConcept = {
  /** Порядковый номер концепта в интерфейсе, чтобы модель могла на него сослаться */
  index: number
  title: string | null
  note: string | null
  /** Особенность варианта по-английски: хвост промпта рендера */
  variation: string
}

export type DuoSide = { name: string; liked: DuoConcept[]; disliked: DuoConcept[] }

export type DuoInput = {
  roomName: string
  roomKind: string
  styleTags: string[]
  household: {
    adults?: number
    kids?: number
    pets?: boolean
    wfh?: boolean
  } | null
  owner: DuoSide
  partner: DuoSide
}

export type DuoBridge = { title: string; idea: string; revision: string }

export type DuoProposal = { summary: string; bridges: DuoBridge[] }

export const DUO_MODEL = 'anthropic/claude-haiku-4.5'
export const DUO_BRIDGES = 3

export const DUO_SYSTEM_PROMPT = [
  'Ты часть сервиса дизайна интерьера Uyut. Два человека выбирают интерьер одной комнаты и пока ни разу не совпали: ни один вариант не понравился обоим.',
  'По их отметкам «нравится» и «не нравится» найди, где вкусы сходятся, и предложи три компромиссных варианта комнаты. Не повторяй то, что один из них отверг. Русский язык, спокойный тон, на «вы», без восторгов и без обращений по имени.',
  'Ответ строго в JSON без пояснений и без markdown:',
  '{"summary": "одно предложение по-русски о том, где сходятся вкусы, с именами людей",',
  ' "bridges": [{"title": "название до пяти слов", "idea": "два предложения по-русски, что за вариант и почему устроит обоих", "revision": "one or two sentences in English for the image model: materials, colours, furniture, light"}]}',
  'Ровно три элемента в bridges.',
].join('\n')

function describe(side: DuoSide): string[] {
  const list = (items: DuoConcept[]) =>
    items.length === 0
      ? ['  — ничего']
      : items.map(
          (item) =>
            `  — концепт ${item.index}${item.title ? ` «${item.title}»` : ''}: ${(item.note ?? 'без описания').replace(/[.\s]+$/, '')}. Особенность рендера: ${item.variation}`,
        )
  return [
    `${side.name} — нравится:`,
    ...list(side.liked),
    `${side.name} — не нравится:`,
    ...list(side.disliked),
  ]
}

export function buildDuoPrompt(input: DuoInput): string {
  const household = input.household
    ? `Семья: взрослых ${input.household.adults ?? '?'}, детей ${input.household.kids ?? 0}, животные ${input.household.pets ? 'есть' : 'нет'}, работа из дома ${input.household.wfh ? 'да' : 'нет'}.`
    : null
  return [
    `Комната: ${input.roomName} (${input.roomKind}).`,
    input.styleTags.length > 0
      ? `Стиль проекта по онбордингу: ${input.styleTags.join(', ')}.`
      : null,
    household,
    '',
    ...describe(input.owner),
    '',
    ...describe(input.partner),
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
}

/** Предложение кэшируется по тому, что видела модель: те же отметки — тот же ответ */
export function duoHash(input: DuoInput): string {
  const digest = createHash('sha256')
  digest.update(
    JSON.stringify({
      room: [input.roomName, input.roomKind],
      owner: [input.owner.liked.map((c) => c.index), input.owner.disliked.map((c) => c.index)],
      partner: [
        input.partner.liked.map((c) => c.index),
        input.partner.disliked.map((c) => c.index),
      ],
    }),
  )
  return digest.digest('hex').slice(0, 32)
}

function clean(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

/** Разбор ответа модели: терпит ограждение ```json и текст вокруг, но требует три варианта */
export function parseDuoProposal(output: string): DuoProposal {
  const start = output.indexOf('{')
  const end = output.lastIndexOf('}')
  if (start === -1 || end <= start) {
    throw new Error('в ответе модели нет JSON')
  }
  const raw = JSON.parse(output.slice(start, end + 1)) as {
    summary?: unknown
    bridges?: unknown
  }
  const bridges = Array.isArray(raw.bridges) ? raw.bridges : []
  const parsed = bridges
    .map((item): DuoBridge => {
      const record = (item ?? {}) as Record<string, unknown>
      return {
        title: clean(record.title, 60),
        idea: clean(record.idea, 400),
        revision: clean(record.revision, 400),
      }
    })
    .filter((item) => item.title && item.idea && item.revision)
    .slice(0, DUO_BRIDGES)
  if (parsed.length < DUO_BRIDGES) {
    throw new Error(`модель вернула ${parsed.length} вариантов вместо ${DUO_BRIDGES}`)
  }
  return {
    summary: clean(raw.summary, 300) || 'Мы нашли, где ваши вкусы сходятся.',
    bridges: parsed,
  }
}

export type DuoProposer = { propose(input: DuoInput): Promise<DuoProposal> }

export function createFalDuoProposer(apiKey: string, model = DUO_MODEL): DuoProposer {
  return {
    async propose(input) {
      const text = await completeFalLlm(apiKey, {
        system: DUO_SYSTEM_PROMPT,
        prompt: buildDuoPrompt(input),
        model,
      })
      return parseDuoProposal(text)
    },
  }
}
