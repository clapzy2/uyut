import { type StyleEntry, styleLibrary } from './styles'
import type { ConceptBrief, PromptBuilder, PromptPlan } from './types'

const roomNouns: Record<ConceptBrief['roomKind'], string> = {
  living: 'living room',
  bedroom: 'bedroom',
  kitchen: 'kitchen',
  bath: 'bathroom',
  kid: "children's room",
}

const TAIL =
  'Realistic interior photograph, natural daylight, no people, no text, no watermarks, no logos.'

function budgetHint(kopecks: number | null): string {
  if (kopecks === null) {
    return 'affordable, widely available furniture'
  }
  const rubles = kopecks / 100
  if (rubles < 400_000) {
    return 'affordable mass-market furniture, simple materials'
  }
  if (rubles < 1_200_000) {
    return 'mid-range furniture, solid wood accents'
  }
  return 'premium furniture, natural stone and solid wood'
}

function householdNeeds(brief: ConceptBrief): string[] {
  const household = brief.household
  if (!household) {
    return []
  }
  const needs: string[] = []
  if ((household.kids ?? 0) > 0) {
    needs.push('a low shelf with books and a safe corner for a child')
  }
  if (household.pets) {
    needs.push('a cosy spot for a pet')
  }
  if (household.wfh && brief.roomKind !== 'bath') {
    needs.push('a compact desk for working from home')
  }
  if (household.receiveGuests && (brief.roomKind === 'living' || brief.roomKind === 'kitchen')) {
    needs.push('seating for several guests')
  }
  if (household.cookHome && brief.roomKind === 'kitchen') {
    needs.push('generous worktop space')
  }
  return needs
}

/**
 * Постоянная рамка задания: ракурс, геометрия и объём ремонта. Её пишем мы, а не модель,
 * потому что на тестах именно эти фразы удерживали комнату похожей на исходную фотографию.
 */
export function fixedPreamble(brief: ConceptBrief): string {
  const noun = roomNouns[brief.roomKind]
  if (!brief.hasPhoto) {
    const area = brief.areaM2 ? ` of about ${Math.round(brief.areaM2)} square metres` : ''
    return `Interior photograph of a ${noun}${area} in a city apartment, one large window on the left, wide framing.`
  }
  // Точечная правка: комната на фотографии остаётся собой, меняется только то, о чём попросили.
  // Здесь нельзя говорить «renovate» или «redesign» — модель понимает это как «снеси и построй заново».
  if (brief.condition === 'keep') {
    return [
      `This photograph shows a real ${noun} that the client wants to keep.`,
      'Preserve it exactly: the same camera angle, the same room proportions, the same windows and doors,',
      'the same wall, floor and ceiling finishes, the same cabinets, appliances and furniture,',
      'the same colours and materials.',
      'Change only what the client asks for below and nothing else.',
      'Everything the client did not mention stays exactly as it is in the photograph.',
    ].join(' ')
  }
  if (brief.condition === 'bare') {
    return [
      `Renovate this unfinished room and furnish it as a ${noun}.`,
      'Keep the exact camera angle, the room proportions and the window opening in the same place:',
      'the same window shape, the same number of sashes, the same wall around it.',
      'Finish the ceiling: smooth, painted matte white, no cables, no exposed concrete.',
      'Remove the protective film and stickers from the window: clean glass, soft daylight,',
      'a calm view outside.',
    ].join(' ')
  }
  // Технику и радиаторы при смене интерьера не покупают заново, а мы их стирали.
  // Владелец заметил это первым: в гостиной исчез телевизор, хотя меняли обстановку, а не технику.
  return [
    `Redesign and furnish this room as a ${noun}.`,
    'Keep the exact camera angle, the room proportions and the window and door openings in the same place:',
    'the same window shape, the same number of sashes, the same wall around it.',
    'Keep the appliances and fixed equipment that are already in the room and stay when furniture changes:',
    'the television, the radiators, the air conditioner, the built-in kitchen appliances,',
    'the sockets and switches, in the same places and of the same size.',
  ].join(' ')
}

function stylePart(brief: ConceptBrief): string {
  const parts = [`Finishes: ${brief.primaryStyle.finish}.`]
  const needs = householdNeeds(brief)
  if (needs.length > 0) {
    parts.push(`Include ${needs.join(', ')}.`)
  }
  parts.push(`Furniture level: ${budgetHint(brief.budgetKopecks)}.`)
  return parts.join(' ')
}

/**
 * В режиме «оставить как есть» стиля в задании нет вовсе: любая фраза про отделку
 * и палитру перекрашивает комнату, которую нас попросили сохранить.
 */
function styleSentence(brief: ConceptBrief, style?: string): string {
  if (brief.condition === 'keep') {
    return ''
  }
  return style?.trim() || stylePart(brief)
}

/**
 * Прямая просьба человека одной фразой. Собирает два источника: заметки комнаты и правку из чата.
 *
 * Заметка раньше шла только в анкете для LLM и терялась во всех запасных путях, а там, где доходила, модель
 * пересказывала её своими словами: «перемести шкаф под окно» становилось столом и барной стойкой.
 * Поэтому просьба идёт отдельно и дословно, а если перевода не дали — по-русски. Перевод лучше, чем кириллица
 * в задании, но кириллица в задании лучше, чем потерянная просьба.
 */
export function mandateSentence(brief: ConceptBrief, translatedNotes?: string): string {
  const wishes = [translatedNotes?.trim() || brief.notes?.trim(), brief.revision?.trim()]
    .filter((wish): wish is string => Boolean(wish))
    .map((wish) => wish.replace(/\s+/g, ' ').replace(/[.\s]+$/, ''))
  if (wishes.length === 0) {
    return ''
  }
  return [
    `The client asks for the following, and it overrides everything above, including the arrangement: ${wishes.join('; ')}.`,
    'Follow it literally: the object the client named stays that object, the place they named stays that place.',
    'Do not substitute a different piece of furniture for the one they asked about.',
  ].join(' ')
}

function sharedPrompt(brief: ConceptBrief, style?: string): string {
  return [fixedPreamble(brief), styleSentence(brief, style), TAIL].filter(Boolean).join(' ')
}

/**
 * Пять способов выполнить одну просьбу, а не пять разных интерьеров.
 *
 * В режиме «оставить как есть» обычные вариации вредны: они диктуют новую расстановку
 * («мебель вдоль окна», «открытые полки вдоль длинной стены») и тем самым отменяют просьбу
 * сохранить комнату. Здесь варьируется только то, как именно выполнить сказанное.
 */
function keepVariationPrompts(count: number): string[] {
  const blocks = [
    'Make the requested change in the most straightforward way and leave everything else untouched.',
    'Make the requested change and close the gap it leaves using the same finishes and units already in the room.',
    'Make the requested change, placing the item as close to the window wall as it physically fits.',
    'Make the requested change while keeping the walking space in the middle of the room clear.',
    'Make the requested change; if the item does not fit as it is, use a lower or narrower unit of the same kind and material.',
  ]
  const result: string[] = []
  for (let index = 0; index < count; index += 1) {
    result.push(blocks[index % blocks.length] as string)
  }
  return result
}

function variationPrompts(brief: ConceptBrief, count: number): string[] {
  if (brief.condition === 'keep') {
    return keepVariationPrompts(count)
  }
  const primary = brief.primaryStyle
  const second = brief.secondaryStyles[0] ?? primary
  const third = brief.secondaryStyles[1] ?? second
  const blocks = [
    `Arrangement: ${primary.descriptor}. Balanced daytime composition.`,
    `Arrangement: main furniture along the window wall, a low storage unit on the opposite wall with a framed artwork above it. ${second.descriptor}.`,
    `Evening version: lamps switched on, warm pools of light, deeper accent colours in the textiles. ${primary.descriptor}.`,
    `Bolder version: one accent wall, open shelving along the long wall, a patterned rug. ${third.descriptor}.`,
    `Calmer version: fewer objects, a wide plain rug, one large artwork, more empty floor. ${primary.descriptor}.`,
  ]
  const result: string[] = []
  for (let index = 0; index < count; index += 1) {
    result.push(blocks[index % blocks.length] as string)
  }
  return result
}

/** Работает без ключей: собирает промпт из полей, которые мы контролируем сами. */
export function buildTemplatePlan(brief: ConceptBrief, count: number): PromptPlan {
  return {
    shared: sharedPrompt(brief),
    variations: variationPrompts(brief, count),
    mandate: mandateSentence(brief),
    source: 'template',
  }
}

export function createTemplatePromptBuilder(): PromptBuilder {
  return { build: async (brief, count) => buildTemplatePlan(brief, count) }
}

const SYSTEM_PROMPT = `Ты помогаешь сервису дизайна интерьера превращать анкету клиента в задание для генеративной модели изображений.

Про ракурс, геометрию комнаты и объём ремонта сервис пишет сам, отдельной фразой перед твоей. Твоя часть — только стиль, материалы и потребности семьи.

Правила:
- Отвечай ТОЛЬКО JSON вида {"style": "...", "request": "...", "variations": ["...", "..."]} без пояснений и без markdown.
- Весь текст внутри JSON на английском языке. Заметки клиента приходят по-русски: переведи смысл, не копируй кириллицу и никогда не переводи строительные термины дословно.
- В "style" две-четыре фразы: отделка стен, пола и потолка, палитра, материалы, уровень мебели и то, что нужно этой семье. Ничего про камеру, ракурс, окна и переделку стен.
- В "request" дословный перевод просьбы клиента, если она есть, иначе пустая строка. Здесь запреты выше не действуют: если человек просит передвинуть или убрать предмет, так и переводи. Сохраняй названный предмет и названное место: «шкаф под окно» — это cabinet under the window, а не стол, не барная стойка и не полка. Ничего не добавляй от себя.
- В "variations" ровно столько блоков, сколько просят. Каждый — одна-две фразы про расстановку мебели, свет и настроение. Блоки заметно отличаются друг от друга, но остаются одной и той же комнатой в одном стиле. Ни один блок не должен противоречить "request".
- Никаких брендов, никаких имён людей, никаких архитектурных переделок.`

type AnthropicResponse = { content?: Array<{ type?: string; text?: string }> }

type ParsedPlan = { style?: unknown; request?: unknown; variations?: unknown }

function extractJson(text: string): ParsedPlan | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) {
    return null
  }
  try {
    return JSON.parse(text.slice(start, end + 1)) as ParsedPlan
  } catch {
    return null
  }
}

function planFromText(
  text: string,
  brief: ConceptBrief,
  fallback: PromptPlan,
  count: number,
): PromptPlan {
  const parsed = extractJson(text)
  const style = typeof parsed?.style === 'string' ? parsed.style.trim() : ''
  const request = typeof parsed?.request === 'string' ? parsed.request.trim() : ''
  const variations = Array.isArray(parsed?.variations)
    ? parsed.variations.filter(
        (item): item is string => typeof item === 'string' && item.trim() !== '',
      )
    : []
  // В режиме «оставить как есть» стиль не нужен и его отсутствие не повод откатываться к шаблону:
  // оттуда мы потеряем перевод просьбы, ради которого всё и затеяно.
  const needsStyle = brief.condition !== 'keep'
  if ((needsStyle && style.length < 30) || variations.length === 0) {
    return fallback
  }
  while (variations.length < count) {
    variations.push(fallback.variations[variations.length] as string)
  }
  return {
    shared: sharedPrompt(brief, style),
    variations: variations.slice(0, count),
    mandate: mandateSentence(brief, request),
    source: 'claude',
  }
}

/** Что сообщаем модели о состоянии комнаты: отсюда она понимает, сочинять отделку или беречь её. */
function conditionLine(condition: ConceptBrief['condition']): string {
  if (condition === 'bare') {
    return 'Комната сдана без отделки: голые стены, бетонный потолок, пола нет. Не переводи это состояние в ответ, просто опиши, какой должна стать готовая отделка.'
  }
  if (condition === 'keep') {
    return 'ВАЖНО: комната остаётся как есть. Существующая отделка, мебель и техника сохраняются, меняется только то, о чём просит клиент. Отдай пустой "style" и всё внимание отдай полю "request".'
  }
  return 'Ремонт в комнате уже сделан, меняем только обстановку.'
}

function briefForClaude(brief: ConceptBrief, count: number): string {
  const style = brief.primaryStyle
  const others = brief.secondaryStyles.map((entry) => `${entry.ru} (${entry.descriptor})`)
  const household = brief.household
  const lines = [
    `Комната: ${brief.roomName}, тип ${roomNouns[brief.roomKind]}.`,
    brief.areaM2 ? `Площадь: ${brief.areaM2} м².` : 'Площадь не указана.',
    conditionLine(brief.condition),
    `Ведущий стиль: ${style.ru}. Отделка: ${style.finish}. Мебель и настроение: ${style.descriptor}.`,
    others.length > 0 ? `Близкие стили: ${others.join('; ')}.` : '',
    household
      ? `Семья: взрослых ${household.adults ?? '?'}, детей ${household.kids ?? 0}, животные ${household.pets ? 'есть' : 'нет'}, готовят дома ${household.cookHome ? 'да' : 'нет'}, принимают гостей ${household.receiveGuests ? 'да' : 'нет'}, работают из дома ${household.wfh ? 'да' : 'нет'}.`
      : 'Про семью ничего не известно.',
    brief.budgetKopecks
      ? `Бюджет на всю квартиру: ${Math.round(brief.budgetKopecks / 100).toLocaleString('ru-RU')} ₽.`
      : 'Бюджет не указан.',
    brief.notes ? `Пожелания клиента своими словами: «${brief.notes}»` : '',
    brief.revision
      ? `Правка после первой генерации (уже на английском, учти её в стиле): ${brief.revision}`
      : '',
    `Нужно ${count} вариаций.`,
  ]
  return lines.filter(Boolean).join('\n')
}

/**
 * Claude собирает задание живым текстом и переводит русские пожелания клиента на английский.
 * Любая ошибка означает откат к шаблону: генерация не должна падать из-за внешнего сервиса.
 */
export function createClaudePromptBuilder(
  apiKey: string,
  options: { model?: string; timeoutMs?: number } = {},
): PromptBuilder {
  const model = options.model ?? 'claude-sonnet-5'
  const timeoutMs = options.timeoutMs ?? 30_000
  return {
    async build(brief: ConceptBrief, count: number): Promise<PromptPlan> {
      const fallback = buildTemplatePlan(brief, count)
      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model,
            max_tokens: 1200,
            system: SYSTEM_PROMPT,
            messages: [{ role: 'user', content: briefForClaude(brief, count) }],
          }),
          signal: AbortSignal.timeout(timeoutMs),
        })
        if (!response.ok) {
          return fallback
        }
        const payload = (await response.json()) as AnthropicResponse
        const text = (payload.content ?? [])
          .filter((block) => block.type === 'text')
          .map((block) => block.text ?? '')
          .join('')
        return planFromText(text, brief, fallback, count)
      } catch {
        return fallback
      }
    },
  }
}

type FalLlmResponse = { output?: string }

/**
 * Тот же Claude, но через fal: аккаунт Anthropic требует проверки документов, а ключ fal уже есть.
 * Стоит доли цента за генерацию и так же переводит русские пожелания клиента на английский.
 */
export function createFalLlmPromptBuilder(
  apiKey: string,
  options: { model?: string; timeoutMs?: number } = {},
): PromptBuilder {
  const model = options.model ?? 'anthropic/claude-sonnet-4.5'
  const timeoutMs = options.timeoutMs ?? 45_000
  return {
    async build(brief: ConceptBrief, count: number): Promise<PromptPlan> {
      const fallback = buildTemplatePlan(brief, count)
      try {
        const submit = await fetch('https://queue.fal.run/fal-ai/any-llm', {
          method: 'POST',
          headers: { Authorization: `Key ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            system_prompt: SYSTEM_PROMPT,
            prompt: briefForClaude(brief, count),
          }),
          signal: AbortSignal.timeout(timeoutMs),
        })
        if (!submit.ok) {
          return fallback
        }
        const { status_url, response_url } = (await submit.json()) as {
          status_url: string
          response_url: string
        }
        const deadline = Date.now() + timeoutMs
        while (Date.now() < deadline) {
          const status = (await fetch(status_url, {
            headers: { Authorization: `Key ${apiKey}` },
          }).then((response) => response.json())) as { status?: string }
          if (status.status === 'COMPLETED') {
            const response = await fetch(response_url, {
              headers: { Authorization: `Key ${apiKey}` },
            })
            if (!response.ok) {
              return fallback
            }
            const payload = (await response.json()) as FalLlmResponse
            return planFromText(payload.output ?? '', brief, fallback, count)
          }
          if (status.status && ['FAILED', 'ERROR', 'CANCELLED'].includes(status.status)) {
            return fallback
          }
          await new Promise((resolve) => setTimeout(resolve, 1000))
        }
        return fallback
      } catch {
        return fallback
      }
    },
  }
}

/**
 * Порядок предпочтений: прямой ключ Anthropic, затем тот же Claude через fal, затем шаблон.
 * Шаблон работает всегда и не отправляет русский текст в модель, поэтому картинка остаётся ровной.
 */
export function createPromptBuilder(keys: {
  anthropicKey?: string | undefined
  falKey?: string | undefined
}): PromptBuilder {
  if (keys.anthropicKey) {
    return createClaudePromptBuilder(keys.anthropicKey)
  }
  if (keys.falKey) {
    return createFalLlmPromptBuilder(keys.falKey)
  }
  return createTemplatePromptBuilder()
}

/** Стиль по идентификатору с безопасным запасным вариантом: библиотека не бывает пустой. */
export function styleOrDefault(id: string | undefined): StyleEntry {
  const fallback = styleLibrary[0] as StyleEntry
  if (!id) {
    return fallback
  }
  return styleLibrary.find((entry) => entry.id === id) ?? fallback
}
