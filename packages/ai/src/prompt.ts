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
  return [
    `Redesign and furnish this room as a ${noun}.`,
    'Keep the exact camera angle, the room proportions and the window and door openings in the same place:',
    'the same window shape, the same number of sashes, the same wall around it.',
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

function sharedPrompt(brief: ConceptBrief, style?: string): string {
  return [fixedPreamble(brief), style?.trim() || stylePart(brief), TAIL].join(' ')
}

function variationPrompts(brief: ConceptBrief, count: number): string[] {
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
    source: 'template',
  }
}

export function createTemplatePromptBuilder(): PromptBuilder {
  return { build: async (brief, count) => buildTemplatePlan(brief, count) }
}

const SYSTEM_PROMPT = `Ты помогаешь сервису дизайна интерьера превращать анкету клиента в задание для генеративной модели изображений.

Про ракурс, геометрию комнаты и объём ремонта сервис пишет сам, отдельной фразой перед твоей. Твоя часть — только стиль, материалы и потребности семьи.

Правила:
- Отвечай ТОЛЬКО JSON вида {"style": "...", "variations": ["...", "..."]} без пояснений и без markdown.
- Весь текст внутри JSON на английском языке. Заметки клиента приходят по-русски: переведи смысл, не копируй кириллицу и никогда не переводи строительные термины дословно.
- В "style" две-четыре фразы: отделка стен, пола и потолка, палитра, материалы, уровень мебели и то, что нужно этой семье. Ничего про камеру, ракурс, окна и переделку стен.
- В "variations" ровно столько блоков, сколько просят. Каждый — одна-две фразы про расстановку мебели, свет и настроение. Блоки заметно отличаются друг от друга, но остаются одной и той же комнатой в одном стиле.
- Никаких брендов, никаких имён людей, никаких архитектурных переделок.`

type AnthropicResponse = { content?: Array<{ type?: string; text?: string }> }

function extractJson(text: string): { style?: unknown; variations?: unknown } | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) {
    return null
  }
  try {
    return JSON.parse(text.slice(start, end + 1)) as { style?: unknown; variations?: unknown }
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
  const variations = Array.isArray(parsed?.variations)
    ? parsed.variations.filter(
        (item): item is string => typeof item === 'string' && item.trim() !== '',
      )
    : []
  if (style.length < 30 || variations.length === 0) {
    return fallback
  }
  while (variations.length < count) {
    variations.push(fallback.variations[variations.length] as string)
  }
  return {
    shared: sharedPrompt(brief, style),
    variations: variations.slice(0, count),
    source: 'claude',
  }
}

function briefForClaude(brief: ConceptBrief, count: number): string {
  const style = brief.primaryStyle
  const others = brief.secondaryStyles.map((entry) => `${entry.ru} (${entry.descriptor})`)
  const household = brief.household
  const lines = [
    `Комната: ${brief.roomName}, тип ${roomNouns[brief.roomKind]}.`,
    brief.areaM2 ? `Площадь: ${brief.areaM2} м².` : 'Площадь не указана.',
    brief.condition === 'bare'
      ? 'Комната сдана без отделки: голые стены, бетонный потолок, пола нет. Не переводи это состояние в ответ, просто опиши, какой должна стать готовая отделка.'
      : 'Ремонт в комнате уже сделан, меняем только обстановку.',
    `Ведущий стиль: ${style.ru}. Отделка: ${style.finish}. Мебель и настроение: ${style.descriptor}.`,
    others.length > 0 ? `Близкие стили: ${others.join('; ')}.` : '',
    household
      ? `Семья: взрослых ${household.adults ?? '?'}, детей ${household.kids ?? 0}, животные ${household.pets ? 'есть' : 'нет'}, готовят дома ${household.cookHome ? 'да' : 'нет'}, принимают гостей ${household.receiveGuests ? 'да' : 'нет'}, работают из дома ${household.wfh ? 'да' : 'нет'}.`
      : 'Про семью ничего не известно.',
    brief.budgetKopecks
      ? `Бюджет на всю квартиру: ${Math.round(brief.budgetKopecks / 100).toLocaleString('ru-RU')} ₽.`
      : 'Бюджет не указан.',
    brief.notes ? `Пожелания клиента своими словами: «${brief.notes}»` : '',
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
