// Помощник: инструкция, протокол команд и поток ответа через fal. У fal нет встроенного вызова
// функций, поэтому модель отвечает либо текстом, либо одной командой в JSON, а сервер выполняет
// команду своим кодом и возвращает результат следующим ходом.

export type ToolSpec = {
  name: string
  description: string
  /** Аргументы человеческим языком: модель заполняет их сама */
  args: Record<string, string>
}

export const chatTools: ToolSpec[] = [
  {
    name: 'search_catalog',
    description:
      'Найти товары в каталоге. Используй, когда просят подобрать, заменить, найти дешевле или в другом цвете.',
    args: {
      category: 'одно из: sofa, chair, table, storage, lamp, rug, bed, decor',
      query: 'что ищем на английском, например "grey fabric sofa"',
      maxPriceRub: 'потолок цены в рублях, число, необязательно',
      objectId: 'id предмета на рендере, если речь о нём, необязательно',
    },
  },
  {
    name: 'replace_match',
    description:
      'Поставить товар лучшим совпадением у предмета на рендере. Только после согласия человека.',
    args: { objectId: 'id предмета', catalogItemId: 'id товара из результатов поиска' },
  },
  {
    name: 'estimate',
    description: 'Смета по лайкнутым концептам комнаты: сумма лучших совпадений против бюджета.',
    args: { roomId: 'id комнаты, необязательно, по умолчанию текущая' },
  },
  {
    name: 'propose_regeneration',
    description:
      'Предложить новую генерацию с правками. Генерация платная и стартует только по кнопке, которую увидит человек.',
    args: {
      roomId: 'id комнаты',
      revision: 'что изменить, на английском, одной-двумя фразами',
      summaryRu: 'что изменится, по-русски, для человека',
    },
  },
]

export const ASSISTANT_PERSONA = `Ты помощник сервиса «Домица». Помогаешь человеку обустроить его квартиру:
объясняешь концепты, подбираешь мебель из каталога, считаешь смету и предлагаешь правки.
Ты ИИ, не скрывай этого, если спросят.

Говори по-русски, коротко и по делу, без восторгов и канцелярита. Обращайся на «вы».
О себе говори в мужском роде: «нашёл», «подобрал», «посчитал».
Один ответ обычно два-четыре предложения; если предлагаешь товары, они придут карточками,
не перечисляй их названия и цены словами.

Опирайся только на данные проекта ниже: стиль, семью, бюджет, комнаты, лайкнутые концепты
и подобранные товары. Не выдумывай размеры, цены и названия. Если данных нет, скажи, каких,
и спроси.

Про размеры честно: рендер это концепт, а не проект. Если у комнаты нет размеров, спроси их
перед советом про габариты. Если товар из каталога явно не помещается по габаритам из карточки,
предупреди.

Платные действия (новая генерация) только через подтверждение кнопкой: опиши, что изменится,
и жди. Никогда не удаляй ничего и не меняй аккаунт: таких возможностей у тебя нет, спокойно
скажи об этом и вернись к интерьеру.

Не по теме (медицина, право, политика, чужие проекты): вежливо откажи одним предложением
и предложи вернуться к квартире.`

const PROTOCOL = `Formatting protocol (technical, never show it to the user).
You may call at most one tool per turn. To call a tool, reply with ONLY a JSON object on a single line:
{"tool":"<name>","args":{...}}
Otherwise reply with plain text for the user in Russian. Never mix JSON and text.
After a tool result arrives (marked "Результат инструмента"), continue: either call another tool or answer the user.
Do not call tools for questions you can answer from the project data below.

Available tools:
`

export function buildSystemPrompt(projectContext: string): string {
  const tools = chatTools
    .map(
      (tool) =>
        `- ${tool.name}: ${tool.description} Аргументы: ${Object.entries(tool.args)
          .map(([key, hint]) => `${key} (${hint})`)
          .join('; ')}`,
    )
    .join('\n')
  return `${ASSISTANT_PERSONA}\n\n${PROTOCOL}${tools}\n\nДанные проекта:\n${projectContext}`
}

export type TranscriptTurn = { role: 'user' | 'assistant' | 'tool'; content: string }

/** Последние сообщения в виде текста: у fal один текстовый prompt, а не список сообщений. */
export function buildTranscript(turns: TranscriptTurn[], limit = 20): string {
  const recent = turns.slice(-limit)
  return recent
    .map((turn) => {
      if (turn.role === 'user') return `Пользователь: ${turn.content}`
      if (turn.role === 'tool') return `Результат инструмента: ${turn.content}`
      return `Помощник: ${turn.content}`
    })
    .join('\n\n')
    .concat('\n\nПомощник:')
}

export type AgentReply =
  | { type: 'tool'; name: string; args: Record<string, unknown> }
  | { type: 'text'; text: string }

/** Команда распознаётся только если весь ответ — один JSON-объект с полем tool. */
export function parseAgentReply(raw: string): AgentReply {
  const text = raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')
  if (text.startsWith('{') && text.endsWith('}')) {
    try {
      const parsed = JSON.parse(text) as { tool?: unknown; args?: unknown }
      if (typeof parsed.tool === 'string' && chatTools.some((tool) => tool.name === parsed.tool)) {
        const args =
          parsed.args && typeof parsed.args === 'object'
            ? (parsed.args as Record<string, unknown>)
            : {}
        return { type: 'tool', name: parsed.tool, args }
      }
    } catch {
      // не JSON — обычный текст
    }
  }
  return { type: 'text', text: text || 'Не получилось ответить, попробуйте переформулировать.' }
}

/** Ответ похож на начало команды: первые непробельные символы — открывающая скобка. */
export function looksLikeToolCall(prefix: string): boolean {
  return prefix.trimStart().startsWith('{')
}

type StreamEvent = { output?: string; partial?: boolean; error?: string | null }

/** Дельта, начинающаяся с этого символа, означает «замени весь текст», а не «добавь». */
export const RESET_MARK = '\u0000'

/**
 * Поток ответа модели через fal: отдаёт только прирост текста. fal присылает накопленный
 * output в каждом событии, поэтому дельта считается по длине предыдущего.
 */
export async function* streamFalLlm(
  apiKey: string,
  input: { system: string; prompt: string; model?: string; signal?: AbortSignal },
): AsyncGenerator<string, void, void> {
  const response = await fetch('https://fal.run/fal-ai/any-llm/stream', {
    method: 'POST',
    headers: {
      Authorization: `Key ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      model: input.model ?? 'anthropic/claude-sonnet-4.5',
      system_prompt: input.system,
      prompt: input.prompt,
    }),
    signal: input.signal,
  })
  if (!response.ok || !response.body) {
    throw new Error(`fal stream: ${response.status} ${(await response.text()).slice(0, 200)}`)
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let emitted = ''

  // Каждая строка data: несёт полный JSON события, поэтому разбираем построчно, не дожидаясь
  // пустой строки-разделителя: у fal она бывает не после каждого события.
  function* consume(line: string): Generator<string, void, void> {
    const trimmed = line.replace(/\r$/, '')
    if (!trimmed.startsWith('data:')) {
      return
    }
    let event: StreamEvent
    try {
      event = JSON.parse(trimmed.slice(5).trim()) as StreamEvent
    } catch {
      return
    }
    if (event.error) {
      throw new Error(`fal stream: ${event.error}`)
    }
    const output = event.output ?? ''
    if (output.length > emitted.length && output.startsWith(emitted)) {
      const delta = output.slice(emitted.length)
      emitted = output
      yield delta
    } else if (output !== emitted && output.length > 0) {
      // Модель переписала начало: отдаём весь текст заново, помеченный RESET_MARK
      emitted = output
      yield `${RESET_MARK}${output}`
    }
  }

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      yield* consume(line)
    }
  }
  buffer += decoder.decode()
  if (buffer.trim() !== '') {
    yield* consume(buffer)
  }
}

/** Полный ответ без потока, для служебных вызовов вроде подписей к концептам. */
export async function completeFalLlm(
  apiKey: string,
  input: { system: string; prompt: string; model?: string },
): Promise<string> {
  let text = ''
  for await (const delta of streamFalLlm(apiKey, input)) {
    if (delta.startsWith(RESET_MARK)) {
      text = delta.slice(1)
    } else {
      text += delta
    }
  }
  return text
}
