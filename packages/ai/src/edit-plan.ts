import { completeFalLlm } from './chat'

/**
 * Разбор просьбы человека на шаги для модели правки.
 *
 * Выведено опытом на живой кухне владельца. Просьба «перемести шкаф справа под окно» одним
 * заданием не выполняется никогда: модель не переносит предметы, потому что не держит их как
 * вещи с гранями. Она дорисовывает плоскую картинку. Зато «убери шкаф» и «поставь шкаф»
 * по отдельности выполняются оба, и комната за четыре шага не расползается.
 *
 * Правила, по которым здесь режется просьба:
 *   одна команда за шаг;
 *   переноса нет, есть «убрать» и потом «поставить»;
 *   место освобождает отдельный шаг, сама модель не догадается;
 *   место называется соседями, а не предлогами;
 *   что сохранить, перечисляем вслух.
 */

export type EditStep = {
  /** Что делаем, по-русски, для показа человеку до траты денег */
  titleRu: string
  /** Задание модели, по-английски, одна команда */
  prompt: string
  /** Нужен ли этому шагу отдельный кадр предмета */
  needsObject: boolean
}

export type EditPlan = {
  steps: EditStep[]
  /** Чего сделать нельзя и почему, по-русски. Пустая строка, если всё выполнимо. */
  warningRu: string
}

export const EDIT_PLANNER_PROMPT = `Ты готовишь задания для модели, которая правит фотографии комнат.

Модель умеет ровно четыре вещи, и каждую только по отдельности:
- убрать предмет и дорисовать стену и пол за ним;
- поставить предмет на свободное место;
- заменить предмет на другой на том же месте;
- сменить цвет или материал поверхности.

Модель НЕ умеет переносить предметы. «Перемести шкаф под окно» она не выполняет.
Это всегда два шага: сначала убрать шкаф, потом поставить шкаф в новом месте.
Модель ничего не додумывает: если место занято, освободить его нужно отдельным шагом.

Правила:
- Отвечай ТОЛЬКО JSON вида {"steps":[{"titleRu":"...","prompt":"...","needsObject":false}],"warningRu":"..."}.
- Шагов от одного до четырёх. Больше не бывает: длинные цепочки уводят картинку.
- В "prompt" одна команда по-английски, повелительным наклонением, без перечисления того, что сохранить: это сервис допишет сам.
- В "titleRu" та же команда по-русски, коротко, для человека: «Убрать шкаф справа», «Поставить тумбу под окном».
- Место называй соседями: "between the kitchen run and the fridge", "against the wall under the window". Не ограничивайся предлогом.
- needsObject ставь true, если на этом шаге надо поставить предмет, который уже есть у человека в комнате. Тогда сервис приложит его фотографию.
- В "warningRu" пиши только то, чего модель сделать не сможет: перепланировку, перенос окна или двери, изменение размеров комнаты. Если всё выполнимо, пустая строка.
- Ничего не выдумывай сверх просьбы. Человек просил одно — не добавляй второго.`

/** Разбор ответа модели-планировщика. Кривой ответ лучше отбросить, чем выполнить наполовину. */
export function parseEditPlan(text: string): EditPlan | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) {
    return null
  }
  let parsed: { steps?: unknown; warningRu?: unknown }
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
  if (!Array.isArray(parsed.steps)) {
    return null
  }
  const steps: EditStep[] = []
  for (const raw of parsed.steps) {
    const step = raw as { titleRu?: unknown; prompt?: unknown; needsObject?: unknown }
    const titleRu = typeof step.titleRu === 'string' ? step.titleRu.trim() : ''
    const prompt = typeof step.prompt === 'string' ? step.prompt.trim() : ''
    if (titleRu === '' || prompt === '') {
      continue
    }
    steps.push({ titleRu, prompt, needsObject: step.needsObject === true })
  }
  const warningRu = typeof parsed.warningRu === 'string' ? parsed.warningRu.trim() : ''
  // Пустой список с объяснением — это не поломка, а честный ответ «так мы не умеем».
  // Без этой ветки просьба перенести окно уходила в модель по-русски и тратила деньги впустую.
  if (steps.length === 0) {
    return warningRu === '' ? null : { steps: [], warningRu }
  }
  return { steps: steps.slice(0, 4), warningRu }
}

/**
 * Что дописывается к каждому шагу: перечень того, что обязано остаться.
 *
 * Молчание модель читает как разрешение поменять, поэтому список обязателен на каждом шаге,
 * а не один раз в начале цепочки.
 */
export const KEEP_THE_REST = [
  'Keep everything else in the photograph exactly as it is:',
  'the same camera angle, the same room proportions, the same windows and doors, the same daylight,',
  'the same wall, floor and ceiling finishes, the same furniture, appliances and objects,',
  'the same colours and materials.',
  'Realistic interior photograph, no people, no text, no watermarks, no logos.',
].join(' ')

/** Запасной план, когда планировщик недоступен: одна команда как есть. */
export function singleStepPlan(request: string): EditPlan {
  return {
    steps: [{ titleRu: request.slice(0, 120), prompt: request, needsObject: false }],
    warningRu: '',
  }
}

/**
 * Просьба человека на русском превращается в план шагов.
 *
 * Без ключа или при кривом ответе возвращается план из одного шага: лучше выполнить просьбу
 * буквально и посредственно, чем не выполнить вовсе.
 */
export async function buildEditPlan(
  falKey: string | undefined,
  request: string,
): Promise<EditPlan> {
  if (!falKey) {
    return singleStepPlan(request)
  }
  try {
    const text = await completeFalLlm(falKey, {
      system: EDIT_PLANNER_PROMPT,
      prompt: `Просьба человека: «${request}»`,
    })
    return parseEditPlan(text) ?? singleStepPlan(request)
  } catch {
    return singleStepPlan(request)
  }
}
