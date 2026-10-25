import { parseFloorPlan } from '@uyut/ai'
import type { PlanReading } from '@uyut/db'
import {
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useState,
  useTransition,
} from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import nativeAreas from '../../../docs/qa/fixtures/basis-native-total-area.json'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/actions/projects', () => ({
  confirmPlanRooms: vi.fn(),
  forgetPlanReading: vi.fn(),
  readPlan: vi.fn(),
}))
vi.mock('react', async (original) => {
  const actual = await original<typeof import('react')>()
  return {
    ...actual,
    useState: vi.fn(actual.useState),
    useTransition: vi.fn(actual.useTransition),
  }
})

import { type ExistingRoom, planRows } from '@/lib/projects/plan-rows'
import { PlanReadingCard } from './plan-reading-card'

type CardNodeProps = {
  children?: ReactNode
  onClick?: () => void
  onChange?: (event: { currentTarget: { value: string } }) => void
  onSaved?: (data: { reading: PlanReading; revision: string }) => void
  onClose?: () => void
  reading?: PlanReading
  sourceRevision?: string
  pageNumber?: number
  value?: string
  message?: string
  'aria-label'?: string
}

function cardNodes(node: ReactNode): ReactElement<CardNodeProps>[] {
  if (Array.isArray(node)) return node.flatMap(cardNodes)
  if (!isValidElement<CardNodeProps>(node)) return []
  return [node, ...cardNodes(node.props.children)]
}

function cardHarness(initial: PlanReading, revision = 'r1') {
  const state: unknown[] = []
  let cursor = 0
  let changed = false
  vi.mocked(useState).mockImplementation((initial?: unknown): ReturnType<typeof useState> => {
    const index = cursor++
    if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial
    return [
      state[index],
      (next: unknown) => {
        state[index] = typeof next === 'function' ? next(state[index]) : next
        changed = true
      },
    ]
  })
  vi.mocked(useTransition).mockReturnValue([false, vi.fn()])
  let props = {
    projectId: 'project',
    sourceRevision: revision,
    reading: initial,
    hasPlan: true,
    planIsPdf: true,
    roomCount: 0,
    existing: [],
  }
  return (reading = props.reading, sourceRevision = props.sourceRevision) => {
    props = { ...props, reading, sourceRevision }
    let tree: ReactNode
    do {
      changed = false
      cursor = 0
      tree = PlanReadingCard(props)
    } while (changed)
    return cardNodes(tree)
  }
}

describe('source refresh while the reading card stays mounted', () => {
  afterEach(async () => {
    const actual = await vi.importActual<typeof import('react')>('react')
    vi.mocked(useState).mockImplementation(actual.useState)
    vi.mocked(useTransition).mockImplementation(actual.useTransition)
  })

  const reading: PlanReading = {
    readAt: '2026-10-24',
    confirmedAt: '2026-10-24',
    sourcePage: 1,
    planState: 'existing',
    rooms: [{ sourceNumber: 5, name: 'Спальня', kind: 'bedroom' }],
  }
  const withDraft: PlanReading = {
    ...reading,
    geometry: {
      version: 1,
      source: 'manual',
      status: 'draft',
      widthCm: 400,
      heightCm: 300,
      walls: [],
      openings: [],
      rooms: [],
      warnings: [],
    },
  }

  function open(nodes: ReactElement<CardNodeProps>[]) {
    const button = nodes.find((node) => node.props.children === 'Разметить комнаты и объекты')
    expect(button?.props.onClick).toBeTypeOf('function')
    button?.props.onClick?.()
  }

  function editor(nodes: ReactElement<CardNodeProps>[]) {
    return nodes.find((node) => node.props.pageNumber === 1 && node.props.onClose)
  }

  it('opens the latest saved geometry and revision after the sibling 2D importer refreshes', () => {
    const render = cardHarness(reading)
    render()
    open(render(withDraft, 'r2'))
    const mounted = editor(render())
    expect(mounted?.props.sourceRevision).toBe('r2')
    expect(mounted?.props.reading).toBe(withDraft)
  })

  it('preserves edited room rows and asks for explicit reload instead of discarding them', () => {
    const render = cardHarness({ ...reading, confirmedAt: undefined })
    const name = render().find((node) => node.props['aria-label'] === 'Название комнаты 1')
    name?.props.onChange?.({ currentTarget: { value: 'Моя спальня' } })
    render()
    open(render(withDraft, 'r2'))
    const nodes = render()
    expect(editor(nodes)).toBeUndefined()
    expect(
      nodes.find((node) => node.props['aria-label'] === 'Название комнаты 1')?.props.value,
    ).toBe('Моя спальня')
    expect(nodes.some((node) => node.props.message?.includes('Ваши правки остались в форме'))).toBe(
      true,
    )
  })

  it('does not replace an already open contour editor when new server props arrive', () => {
    const render = cardHarness(reading)
    open(render())
    const mounted = editor(render(withDraft, 'r2'))
    expect(mounted?.props.sourceRevision).toBe('r1')
    expect(mounted?.props.reading).toBe(reading)
  })

  it('opens the current source sheet rather than retaining the previous page selector', () => {
    const render = cardHarness(reading)
    render()
    const newer = { ...withDraft, sourcePage: 2 }
    open(render(newer, 'r2'))
    const mounted = render().find((node) => node.props.onClose)
    expect(mounted?.props.pageNumber).toBe(2)
    expect(mounted?.props.sourceRevision).toBe('r2')
    expect(mounted?.props.reading).toBe(newer)
  })

  it('keeps a successful local save while its router refresh has not returned yet', () => {
    const render = cardHarness(reading)
    open(render())
    editor(render())?.props.onSaved?.({ reading: withDraft, revision: 'r2' })
    open(render())
    const mounted = editor(render())
    expect(mounted?.props.sourceRevision).toBe('r2')
    expect(mounted?.props.reading).toBe(withDraft)
  })
})

function render(
  reading: PlanReading | null,
  roomCount = 0,
  existing: ExistingRoom[] = [],
  planIsPdf = true,
) {
  return renderToStaticMarkup(
    createElement(PlanReadingCard, {
      projectId: 'project',
      sourceRevision: 'revision',
      reading,
      hasPlan: true,
      planIsPdf,
      planSourceUrl: planIsPdf ? '/source-plan.pdf?signature=synthetic' : '/source-image',
      roomCount,
      existing,
    }),
  )
}

describe('plan review form', () => {
  it('keeps a bathroom as a reference row without requiring missing dimensions for furnishing', () => {
    const html = render({
      readAt: '2026-10-25T00:00:00.000Z',
      rooms: [{ name: 'Душевая', kind: 'bath', sourceNumber: 2 }],
    })
    expect(html).toContain('Санузел сохраняем на плане справочно')
    expect(html).toContain('Готовую отделку по плану не определяем')
    expect(html).not.toContain('Укажите недостающие стороны или подтвердите контур комнаты')
  })

  it('requires a separate unchecked architecture review before AI notes reach concepts', () => {
    const html = render({
      readAt: '2026-10-17',
      rooms: [{ name: 'Кухня', kind: 'kitchen', layoutNotes: 'Двери ванной справа.' }],
    })
    expect(html).toContain('Сверил окна, двери и форму комнаты')
    expect(html).toContain('Проёмы соседних помещений сюда не включены')
    expect(html).toContain('не попадёт в задание для концептов')
    expect(html).toContain('Это не подтверждение обмеров')
    expect(html.match(/type="checkbox"[^>]*checked=""/g)).toHaveLength(1)
  })
  it('does not present a stale area-product warning without current side measurements', () => {
    const reading = parseFloorPlan(
      JSON.stringify({
        planState: 'existing',
        rooms: [{ name: 'Комната', kind: 'living', areaM2: 14.19 }],
      }),
    )
    const room = reading.rooms[0]
    if (!room) throw new Error('Missing room')
    room.suspicious = true
    const html = render({ ...reading, readAt: '2026-10-16' })
    expect(html).not.toContain('Площадь отличается от произведения сторон')
    expect(html).toContain('14,19')
  })

  it('shows source total-area ambiguity while retaining individual area input values', () => {
    const reading = parseFloorPlan(
      JSON.stringify({
        planState: 'existing',
        totalAreaM2: 48.22,
        rooms: [
          { name: 'Помещение', sourceNumber: 1, areaM2: 40.13 },
          { name: 'Балкон 01', sourceNumber: 2, areaM2: 4.75 },
          { name: 'Балкон 02', sourceNumber: 3, areaM2: 3.34 },
        ],
      }),
      { planText: JSON.stringify(nativeAreas.items) },
    )
    const html = render({ ...reading, readAt: '2026-10-09' })
    expect(html).toContain('Общая площадь: в экспликации 48,22 м², в подписи квартиры 47,4 м²')
    expect(html).toContain('какие помещения включены')
    expect(html).toContain('value="40,13"')
    expect(html).toContain('value="4,75"')
    expect(html).toContain('value="3,34"')
    expect(reading.totalAreaM2).toBeUndefined()
  })
  it('requires separate unchecked source-axis review for raster dimensions and offers explicit omission', () => {
    const reading: PlanReading = {
      readAt: '2026-10-08',
      rooms: [{ name: 'Гостиная', kind: 'living', widthCm: 600, depthCm: 320 }],
    }
    const html = render(reading, 0, [], false)
    expect(html).toContain('Сверил горизонтальную ширину')
    expect(html).toContain('Сверил вертикальную глубину')
    expect(html).toContain('Очистить неподтверждённые оси')
    expect(html).toContain('href="/source-image"')
    expect(html).toContain('не обнаруживает перестановку осей')
    // The room-selection checkbox is checked; neither source-axis acknowledgment is.
    expect(html.match(/type="checkbox"[^>]*checked=""/g)).toHaveLength(1)
  })
  it('offers an unmeasured outdoor zone only as a human-checked addition', () => {
    const html = render(
      {
        readAt: '2026-10-13',
        rooms: [
          {
            name: 'Гостиная',
            kind: 'living',
            layoutNotes: 'Внизу балконный проём.',
          },
        ],
      },
      0,
      [],
      false,
    )
    expect(html).toContain('Если на плане есть балкон или лоджия без подписи')
    expect(html).toContain('Добавить балкон без размеров')
    expect(html).toContain('Добавить лоджию без размеров')
    expect(html).toContain('Одна балконная дверь его не доказывает')
  })
  it('lets the reviewer remove an unlabeled outdoor row', () => {
    const html = render({
      readAt: '2026-10-13',
      rooms: [
        { name: 'Гостиная', kind: 'living' },
        { name: 'Балкон', kind: 'living', spaceKind: 'balcony', utility: true },
      ],
    })
    expect(html).toContain('Убрать неподписанную зону')
  })
  it('requires separate unchecked source-axis review for PDF dimensions and links the read sheet', () => {
    const reading: PlanReading = {
      readAt: '2026-10-09',
      sourcePage: 6,
      rooms: [{ name: 'Гостиная', kind: 'living', widthCm: 600, depthCm: 320 }],
    }
    const html = render(reading)
    expect(html).toContain('Сверил горизонтальную ширину')
    expect(html).toContain('Сверил вертикальную глубину')
    expect(html).toContain('с исходным листом')
    expect(html).toContain('Очистить неподтверждённые оси')
    expect(html).toContain('href="/source-plan.pdf?signature=synthetic#page=6"')
    expect(html).toContain('Открыть исходный лист PDF для сверки · страница 6')
    expect(html).toContain('не обнаруживает перестановку осей')
    expect(html).toContain('Подставить после сверки: ширина 600 см')
    expect(html).toContain('Подставить после сверки: глубина 320 см')
    expect(html).toContain('Поэтому они не подставлены автоматически')
    expect(html).not.toContain('value="600"')
    expect(html).not.toContain('value="320"')
    expect(html.match(/type="checkbox"[^>]*checked=""/g)).toHaveLength(1)
  })
  it('reopens saved dimension candidates without carrying source-axis acknowledgments', () => {
    const saved: PlanReading = {
      readAt: '2026-10-09',
      confirmedAt: '2026-10-09',
      sourcePage: 6,
      rooms: [
        {
          name: 'Гостиная',
          kind: 'living',
          widthCm: 600,
          depthCm: 320,
          dimensionSources: {
            widthCm: { valueCm: 600, source: 'plan' },
            depthCm: { valueCm: 320, source: 'entered' },
          },
        },
      ],
    }
    const [reopened] = planRows(saved)
    expect(reopened).toMatchObject({ width: '600', depth: '320' })
    expect(reopened?.widthReviewed).not.toBe(true)
    expect(reopened?.depthReviewed).not.toBe(true)
  })
  it('leads an unread plan to the selected sheet and explains the review before room transfer', () => {
    const html = render(null)
    expect(html).toContain('Прочитайте нужный лист')
    expect(html).toContain('Прочитать выбранный лист')
    expect(html).toContain('сверите результат с исходным листом')
    expect(html).not.toContain('Прочитать другой лист или повторить чтение')
  })

  it('leads transferred rooms to measurements while keeping rereading optional', () => {
    const html = render(
      {
        readAt: '2026-10-03',
        confirmedAt: '2026-10-03',
        sourcePage: 6,
        planState: 'proposed',
        rooms: [{ name: 'Спальня', kind: 'bedroom' }],
      },
      1,
      [{ id: 'room', name: 'Спальня', kind: 'bedroom', notes: null }],
    )
    expect(html).toContain('href="/projects/project/rooms/room#room-measurements"')
    expect(html).toContain('Открыть мерки комнаты')
    expect(html).toContain('aria-label="Открыть мерки комнаты Спальня"')
    expect(html).toContain('Перенос не подтверждает обмер')
    expect(html).toContain('Прочитан лист 6')
    expect(html).toContain('Проектное состояние — вариант после изменений, не исходный обмер')
    expect(html).toMatch(/<details[^>]*><summary[^>]*>Прочитать другой лист или повторить чтение/)
    expect(html).toContain('использует AI и заменит данные в форме')
  })

  it('opens a room matched to this reading before an unrelated older room', () => {
    const html = render(
      {
        readAt: '2026-10-11',
        confirmedAt: '2026-10-11',
        sourcePage: 6,
        planState: 'existing',
        rooms: [{ name: 'Кухня', kind: 'kitchen', sourceNumber: 2 }],
      },
      2,
      [
        { id: 'older-control', name: 'Синтетический контроль', kind: 'living', notes: null },
        { id: 'source-kitchen', name: 'Кухня', kind: 'kitchen', notes: null },
      ],
    )
    expect(html).toContain('href="/projects/project/rooms/source-kitchen#room-measurements"')
    expect(html).toContain('aria-label="Открыть мерки комнаты Кухня"')
    expect(html).not.toContain('/rooms/older-control#room-measurements')
  })

  it('names room transfer explicitly and labels each room selection for assistive technology', () => {
    const html = render({
      readAt: '2026-10-03',
      rooms: [{ name: 'Спальня', kind: 'bedroom' }],
    })
    expect(html).toContain('Сверьте данные перед переносом')
    expect(html).toContain(
      'Для выбора стиля и создания концептов не нужно доказывать каждый контур пола',
    )
    expect(html).toContain('Неизвестные размеры оставьте пустыми')
    expect(html).toContain('Перенести комнаты: 1')
    expect(html).toContain('aria-label="Перенести комнату Спальня"')
    expect(html).toContain('включая несохранённые правки')
    expect(html).toContain('Очистить сохранённое чтение')
    expect(html).toContain('Очистка удалит сохранённое чтение, разметку листа и 2D-схему')
    expect(html).toContain('aria-describedby="plan-forget-hint"')
  })

  it('opens a confirmation dialog before clearing saved reading and geometry', () => {
    const html = render({
      readAt: '2026-10-03',
      rooms: [{ name: 'Спальня', kind: 'bedroom' }],
    })
    const trigger = html.match(/<button[^>]*>Очистить сохранённое чтение<\/button>/)?.[0]
    expect(trigger).toBeDefined()
    expect(trigger).toContain('aria-haspopup="dialog"')
    expect(trigger).toContain('aria-expanded="false"')
    expect(trigger).toContain('data-state="closed"')
    expect(trigger).toContain('aria-describedby="plan-forget-hint"')
    expect(html).not.toContain('Да, очистить чтение')
  })

  it('offers editing saved rows without requiring another AI read', () => {
    const html = render({
      readAt: '2026-10-03',
      confirmedAt: '2026-10-03',
      rooms: [{ name: 'Спальня', sourceNumber: 4, kind: 'bedroom' }],
    })
    expect(html).toContain('Изменить данные с чертежа')
  })

  it('offers missing schedule identities separately with no preselected purpose or dimensions', () => {
    const html = render({
      readAt: '2026-10-03',
      sourcePage: 2,
      planState: 'existing',
      rooms: [{ name: 'Спальня 4', sourceNumber: 4, kind: 'bedroom' }],
      pageReview: {
        version: 1,
        savedAt: '2026-10-03',
        sourceRooms: [
          { name: 'Спальня 4', sourceNumber: 4 },
          { name: 'Спальня 6', sourceNumber: 6 },
        ],
        contours: {
          source: { sha256: 'a'.repeat(64), pdfPage: 2, state: 'existing' },
          coordinateSystem: 'page-0-1000',
          review: 'manual-source-review',
          pageWidth: 1000,
          pageHeight: 1000,
          rooms: [
            {
              roomSourceNumber: 4,
              polygon: [
                { x: 0, y: 0 },
                { x: 20, y: 0 },
                { x: 0, y: 20 },
              ],
            },
          ],
        },
      },
    })
    expect(html).toContain('Добавить помещение из экспликации')
    expect(html).toContain('№06 · Спальня 6')
    expect(html).toContain('размеры останутся пустыми')
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Добавить строку/)
  })
  it('does not claim rooms were imported when the project has none', () => {
    const reading: PlanReading = {
      readAt: '2026-10-02',
      confirmedAt: '2026-10-02',
      rooms: [{ name: 'Гостиная', kind: 'living' }],
    }

    expect(render(reading)).toContain('комнат проекта сейчас нет')
    expect(render(reading)).not.toContain('Комнаты перенесены')
    expect(render(reading)).not.toContain('Данные с плана уже перенесены в комнаты')
    expect(render(reading, 1)).toContain('Данные с плана уже перенесены в комнаты')
  })

  it('shows a PDF page selector instead of promising to read the first three pages', () => {
    const html = render(null)
    expect(html).toContain('Страница PDF с планом')
    expect(html).toContain('Читаем только выбранную страницу')
    expect(html).not.toContain('первые три страницы')
  })

  it('shows individual ceilings and source numbers while keeping PDF dimensions as suggestions', () => {
    const html = render({
      sourcePage: 6,
      pageCount: 48,
      planState: 'existing',
      readAt: '2026-09-26',
      rooms: [
        {
          name: 'Спальня 4',
          kind: 'bedroom',
          sourceNumber: 4,
          widthCm: 298.5,
          depthCm: 515.6,
          ceilingCm: 266.3,
          areaM2: 15.39,
        },
      ],
    })
    expect(html).toContain('Помещение №4')
    expect(html).toContain('Подставить после сверки: ширина 298.5 см')
    expect(html).toContain('Подставить после сверки: глубина 515.6 см')
    expect(html).not.toContain('value="298.5"')
    expect(html).toContain('value="266.3"')
    expect(html).toContain('существующее состояние')
    expect(html).toContain('max="48"')
  })

  it('warns about proposed changes and never offers an area-derived correction button', () => {
    const html = render({
      readAt: '2026-09-26',
      planState: 'proposed',
      rooms: [{ name: 'Кухня', kind: 'kitchen', widthCm: 300, depthCm: 500, areaM2: 10 }],
    })
    expect(html).toContain('Проектное состояние — вариант после изменений, не исходный обмер')
    expect(html).toContain('Сверьте числа и границы на исходном листе')
    expect(html).not.toContain('Ширина 200 см')
    expect(html).not.toContain('Глубина 333 см')
  })

  it('explains confirmation and gives a next step for unknown sides without inventing them', () => {
    const html = render({
      readAt: '2026-09-27',
      rooms: [{ name: 'Спальня', kind: 'bedroom', areaM2: 12 }],
    })
    expect(html).toContain('замеры на месте подтверждаются отдельно')
    expect(html).toContain('Дополните ширину и глубину по размерным линиям')
    expect(html).toContain('Пока неизвестные размеры оставлены пустыми')
    expect(html).not.toContain('Модель не может')
  })

  it('offers sheet annotation without automatically rereading or confirming measurements', () => {
    const html = render({
      sourcePage: 6,
      planState: 'existing',
      readAt: '2026-09-27',
      confirmedAt: '2026-09-27',
      rooms: [{ name: 'Спальня', kind: 'bedroom', sourceNumber: 4 }],
    })
    expect(html).toContain('Разметить комнаты и объекты')
    expect(html).toContain('Разметка не меняет ваши мерки и не запускает генерацию')
    expect(html).not.toContain('Прочитать со сверкой контуров')
  })

  it('requires a known sheet state and printed room identity before offering annotation', () => {
    const html = render({
      sourcePage: 6,
      planState: 'unknown',
      readAt: '2026-09-27',
      rooms: [{ name: 'Спальня', kind: 'bedroom', sourceNumber: 4 }],
    })
    expect(html).not.toContain('Разметить комнаты и объекты')
    const unnumbered = render({
      sourcePage: 6,
      planState: 'existing',
      readAt: '2026-09-27',
      rooms: [{ name: 'Спальня', kind: 'bedroom' }],
    })
    expect(unnumbered).not.toContain('Разметить комнаты и объекты')
  })

  it('makes AI rereading explicit only for a saved review on the selected sheet', () => {
    const html = render({
      sourcePage: 6,
      planState: 'existing',
      readAt: '2026-09-27',
      rooms: [{ name: 'Спальня', kind: 'bedroom', sourceNumber: 4 }],
      pageReview: {
        version: 1,
        savedAt: '2026-09-27',
        contours: {
          source: { sha256: 'a'.repeat(64), pdfPage: 6, state: 'existing' },
          coordinateSystem: 'page-0-1000',
          review: 'manual-source-review',
          pageWidth: 842,
          pageHeight: 1191,
          rooms: [
            {
              roomSourceNumber: 4,
              polygon: [
                { x: 100, y: 100 },
                { x: 200, y: 100 },
                { x: 200, y: 200 },
              ],
            },
          ],
        },
      },
    })
    expect(html).toContain('Изменить разметку листа')
    expect(html).toContain('Прочитать со сверкой контуров')
    expect(html).toContain('Повторное чтение')
    expect(html).toContain('использует AI и заменит данные в форме')
  })
})
