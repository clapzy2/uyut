import { type ComponentProps, type EffectCallback, isValidElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Проверяем обработчики настоящих компонентов без браузерного DOM.
// Состояние сохраняется между вызовами компонента, как между рендерами React.
const hooks = vi.hoisted(() => ({
  state: [] as unknown[],
  refs: [] as Array<{ current: unknown }>,
  stateIndex: 0,
  refIndex: 0,
  effects: [] as EffectCallback[],
  effectDependencies: [] as Array<readonly unknown[] | undefined>,
  transitions: [] as Promise<void>[],
  refresh: vi.fn(),
  toast: vi.fn(),
  request: vi.fn(),
  vote: vi.fn(),
  checkGeneration: vi.fn(),
  refreshConcepts: vi.fn(),
  saveMeasurements: vi.fn(),
  startPdf: vi.fn(),
  loadPdf: vi.fn(),
  loadPdfs: vi.fn(),
}))

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useState: (initial: unknown) => {
    const index = hooks.stateIndex++
    if (!(index in hooks.state)) {
      hooks.state[index] = typeof initial === 'function' ? initial() : initial
    }
    return [
      hooks.state[index],
      (next: unknown) => {
        hooks.state[index] = typeof next === 'function' ? next(hooks.state[index]) : next
      },
    ]
  },
  useRef: (initial: unknown) => {
    const index = hooks.refIndex++
    hooks.refs[index] ??= { current: initial }
    return hooks.refs[index]
  },
  useMemo: (compute: () => unknown) => compute(),
  useEffect: (effect: EffectCallback, dependencies?: readonly unknown[]) => {
    hooks.effects.push(effect)
    hooks.effectDependencies.push(dependencies)
  },
  useTransition: () => [false, (action: () => Promise<void>) => hooks.transitions.push(action())],
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: hooks.refresh, push: vi.fn() }) }))
vi.mock('@uyut/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@uyut/ui')>()),
  toast: hooks.toast,
}))
vi.mock('motion/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('motion/react')>()),
  useReducedMotion: () => true,
}))
vi.mock('@/actions/concepts', () => ({
  requestConcepts: hooks.request,
  setConceptLike: hooks.vote,
  checkGeneration: hooks.checkGeneration,
  refreshConcepts: hooks.refreshConcepts,
}))
vi.mock('@/actions/rooms', () => ({ updateRoomMeasurements: hooks.saveMeasurements }))
vi.mock('@uyut/ai', () => ({ findSwatch: vi.fn(), isApproximate: vi.fn() }))
vi.mock('@/actions/recolor', () => ({ resetRecolor: vi.fn(), saveRecolor: vi.fn() }))
vi.mock('@/actions/shopping', () => ({ addItem: vi.fn() }))
vi.mock('@/components/concepts/swatch-picker', () => ({ SwatchPicker: () => null }))
vi.mock('@/lib/recolor/client', () => ({ applySwatch: vi.fn(), prepareRecolor: vi.fn() }))
vi.mock('@/actions/billing', () => ({
  startProjectPurchase: vi.fn(),
  startProSubscription: vi.fn(),
}))
vi.mock('@/actions/exports', () => ({
  exportProjectPdf: hooks.startPdf,
  loadExport: hooks.loadPdf,
  loadExports: hooks.loadPdfs,
}))
vi.mock('@/lib/collaboration/live-client', () => ({
  useProjectLive: () => ({ likes: null, presence: null }),
}))
vi.mock('@/lib/queue/use-run-watch', () => ({
  useRunWatch: () => ({ progress: {}, slow: false, lost: false }),
}))

import type { ExportView } from '@/lib/exports/repository'
import { ConceptViewer } from './concepts/concept-viewer'
import { ConceptsPanel } from './concepts/concepts-panel'
import { FormError } from './form-error'
import { RoomMeasurementsForm } from './room-measurements-form'
import { ExportCard } from './summary/export-card'

type Props = Record<string, unknown> & { children?: ReactNode }

function find(node: ReactNode, match: (props: Props) => boolean): Props {
  if (Array.isArray(node)) {
    for (const child of node) {
      try {
        return find(child, match)
      } catch {}
    }
  }
  if (isValidElement<Props>(node)) {
    if (match(node.props)) return node.props
    return find(node.props.children, match)
  }
  throw new Error('Element not found')
}

function errorMessage(node: ReactNode) {
  const errors: string[] = []
  function visit(child: ReactNode) {
    if (Array.isArray(child)) child.forEach(visit)
    else if (isValidElement<Props>(child)) {
      if (child.type === FormError && typeof child.props.message === 'string') {
        errors.push(child.props.message)
      }
      visit(child.props.children)
    }
  }
  visit(node)
  return errors.join(' ')
}

function render<T>(component: (props: T) => ReactNode, props: T) {
  hooks.stateIndex = 0
  hooks.refIndex = 0
  hooks.effects = []
  hooks.effectDependencies = []
  return component(props)
}

function progressComponent(node: ReactNode): (props: Props) => ReactNode {
  if (Array.isArray(node)) {
    for (const child of node) {
      try {
        return progressComponent(child)
      } catch {}
    }
  }
  if (isValidElement<Props>(node)) {
    if (typeof node.type === 'function' && node.type.name === 'RunProgress') {
      return node.type as (props: Props) => ReactNode
    }
    return progressComponent(node.props.children)
  }
  throw new Error('Progress not found')
}

const panelProps: ComponentProps<typeof ConceptsPanel> = {
  roomId: 'room',
  projectId: 'project',
  hasPhoto: false,
  keepsFurniture: false,
  onboarded: true,
  role: 'owner',
  other: null,
  latestBatchId: 'batch',
  items: [],
}

const viewerData: ComponentProps<typeof ConceptViewer>['data'] = {
  role: 'owner',
  other: null,
  concept: {
    id: 'concept',
    status: 'ready',
    objectsStatus: 'ready',
    objectsError: null,
    liked: null,
    renderSrc: '/concept.jpg',
    renderKey: 'concept.jpg',
    editedRenderKey: null,
    note: null,
    qualityReview: null,
    orderIndex: 0,
    batchId: 'batch',
  },
  room: {
    id: 'room',
    name: 'Гостиная',
    projectId: 'project',
    projectTitle: 'Квартира',
    budgetKopecks: null,
  },
  plan: null,
  shopping: { byCatalogItem: {}, count: 0 },
  objects: [],
}

const exportProps: ComponentProps<typeof ExportCard> = {
  projectId: 'project',
  exports: [],
  contact: null,
  isPaid: false,
  plan: 'free',
  hasRooms: true,
  projectPriceKopecks: 99000,
  proPriceKopecks: 199000,
}

const pdf: ExportView = {
  id: 'existing-pdf',
  kind: 'free',
  status: 'running',
  options: {},
  pdfUrl: null,
  pages: null,
  durationMs: null,
  error: null,
  runId: 'run',
  createdAt: new Date(),
  finishedAt: null,
}

async function click(node: ReactNode, label: string) {
  const button = find(node, (props) => props.children === label)
  await (button.onClick as () => void | Promise<void>)()
  await Promise.all(hooks.transitions)
  hooks.transitions = []
}

beforeEach(() => {
  vi.clearAllMocks()
  hooks.state = []
  hooks.refs = []
  hooks.transitions = []
})
afterEach(() => vi.useRealTimers())

describe('восстановление после отказа серверного действия', () => {
  it.each([
    [true, false],
    [true, true],
    [false, false],
    [false, true],
    [null, false],
    [null, true],
  ] as const)(
    'возвращает прежнюю отметку открытого концепта: liked=%s, reject=%s',
    async (liked, reject) => {
      const props = { data: { ...viewerData, concept: { ...viewerData.concept, liked } } }
      const label = liked === true ? 'Не нравится' : '♥ Нравится'
      if (reject) hooks.vote.mockRejectedValueOnce(new Error('private transport details'))
      else hooks.vote.mockResolvedValueOnce({ ok: false, error: 'Сессия закончилась' })

      await click(render(ConceptViewer, props), label)

      const recovered = render(ConceptViewer, props)
      const yes = find(recovered, (props) => props.children === '♥ Нравится')
      const no = find(recovered, (props) => props.children === 'Не нравится')
      expect(yes['aria-pressed']).toBe(liked === true)
      expect(no['aria-pressed']).toBe(liked === false)
      expect(yes.disabled).toBe(false)
      expect(no.disabled).toBe(false)
      expect(hooks.refresh).not.toHaveBeenCalled()
      expect(hooks.toast).toHaveBeenCalledOnce()
      expect(hooks.toast.mock.calls[0]?.[0].title).not.toContain('private transport details')
    },
  )

  it('блокирует обе отметки и второй быстрый клик до ответа, затем обновляет только успешный выбор', async () => {
    let resolve: (result: { ok: true; data: undefined }) => void = () => {}
    hooks.vote.mockImplementationOnce(
      () =>
        new Promise((finish) => {
          resolve = finish
        }),
    )
    const props = { data: viewerData }
    const tree = render(ConceptViewer, props)
    const yes = find(tree, (props) => props.children === '♥ Нравится')
    const no = find(tree, (props) => props.children === 'Не нравится')
    const request = (yes.onClick as () => Promise<void>)()
    await (no.onClick as () => Promise<void>)()
    expect(hooks.vote).toHaveBeenCalledExactlyOnceWith('concept', true)
    const pending = render(ConceptViewer, props)
    expect(find(pending, (props) => props.children === '♥ Нравится').disabled).toBe(true)
    expect(find(pending, (props) => props.children === 'Не нравится').disabled).toBe(true)
    expect(hooks.refresh).not.toHaveBeenCalled()

    resolve({ ok: true, data: undefined })
    await request

    const saved = find(render(ConceptViewer, props), (props) => props.children === '♥ Нравится')
    expect(saved['aria-pressed']).toBe(true)
    expect(saved.disabled).toBe(false)
    expect(hooks.refresh).toHaveBeenCalledOnce()
    expect(hooks.toast).not.toHaveBeenCalled()
  })

  it('останавливает резервные проверки генерации через восемь минут', async () => {
    vi.useFakeTimers()
    const component = progressComponent(
      render(ConceptsPanel, {
        ...panelProps,
        initialRun: { runId: 'run', accessToken: 'token' },
      }),
    )
    hooks.state = []
    hooks.checkGeneration.mockResolvedValue({ ok: true, data: { running: true } })
    render(component, { runId: 'run', accessToken: 'token', roomId: 'room', onFinished: vi.fn() })
    hooks.effects[0]?.()
    const cleanup = hooks.effects[1]?.()
    await vi.advanceTimersByTimeAsync(8 * 60_000)
    expect(hooks.checkGeneration).toHaveBeenCalledTimes(32)
    await vi.advanceTimersByTimeAsync(2 * 60_000)
    expect(hooks.checkGeneration).toHaveBeenCalledTimes(32)
    if (typeof cleanup === 'function') cleanup()
  })

  it('не перекрывает долгую проверку и не обрабатывает ответ после ухода со страницы', async () => {
    vi.useFakeTimers()
    const component = progressComponent(
      render(ConceptsPanel, {
        ...panelProps,
        initialRun: { runId: 'run', accessToken: 'token' },
      }),
    )
    hooks.state = []
    const onFinished = vi.fn()
    let resolve: (value: unknown) => void = () => {}
    hooks.checkGeneration.mockImplementationOnce(
      () =>
        new Promise((finish) => {
          resolve = finish
        }),
    )
    render(component, { runId: 'run', accessToken: 'token', roomId: 'room', onFinished })
    hooks.effects[0]?.()
    const cleanup = hooks.effects[1]?.()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(hooks.checkGeneration).toHaveBeenCalledOnce()
    if (typeof cleanup === 'function') cleanup()
    resolve({ ok: true, data: { running: false } })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(onFinished).not.toHaveBeenCalled()
    expect(hooks.checkGeneration).toHaveBeenCalledOnce()
  })

  it('останавливает резервный опрос, когда сервер уже закончил генерацию', async () => {
    vi.useFakeTimers()
    const component = progressComponent(
      render(ConceptsPanel, {
        ...panelProps,
        initialRun: { runId: 'run', accessToken: 'token' },
      }),
    )
    hooks.state = []
    const onFinished = vi.fn()
    hooks.checkGeneration.mockResolvedValue({ ok: true, data: { running: false } })
    render(component, { runId: 'run', accessToken: 'token', roomId: 'room', onFinished })
    hooks.effects[0]?.()
    const cleanup = hooks.effects[1]?.()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(onFinished).toHaveBeenCalledExactlyOnceWith(false)
    expect(hooks.checkGeneration).toHaveBeenCalledOnce()
    if (typeof cleanup === 'function') cleanup()
  })

  it('показывает транспортный отказ резервной проверки вместо unhandled rejection', async () => {
    vi.useFakeTimers()
    const component = progressComponent(
      render(ConceptsPanel, {
        ...panelProps,
        initialRun: { runId: 'run', accessToken: 'token' },
      }),
    )
    hooks.state = []
    const props = { runId: 'run', accessToken: 'token', roomId: 'room', onFinished: vi.fn() }
    hooks.checkGeneration.mockRejectedValueOnce(new Error('Network'))
    render(component, props)
    hooks.effects[0]?.()
    const cleanup = hooks.effects[1]?.()
    await vi.advanceTimersByTimeAsync(15_000)
    const error = find(
      render(component, props),
      (props) =>
        props.role === 'status' &&
        typeof props.children === 'string' &&
        props.children.includes('Не удалось проверить статус'),
    )
    expect(error.children).toContain('Не удалось проверить статус')
    expect(props.onFinished).not.toHaveBeenCalled()
    if (typeof cleanup === 'function') cleanup()
  })

  it('не перезапускает polling при новом callback и завершает его через последний callback', async () => {
    vi.useFakeTimers()
    const component = progressComponent(
      render(ConceptsPanel, {
        ...panelProps,
        initialRun: { runId: 'run', accessToken: 'token' },
      }),
    )
    hooks.state = []
    const firstFinished = vi.fn()
    const latestFinished = vi.fn()
    const props = { runId: 'run', accessToken: 'token', roomId: 'room', onFinished: firstFinished }
    hooks.checkGeneration.mockResolvedValue({ ok: true, data: { running: false } })
    render(component, props)
    hooks.effects[0]?.()
    const cleanup = hooks.effects[1]?.()
    expect(hooks.effectDependencies[1]).toEqual(['room'])
    render(component, { ...props, onFinished: latestFinished })
    // Как React: обновляем callback-effect, но не повторяем polling с прежними deps.
    hooks.effects[0]?.()
    expect(hooks.effectDependencies[1]).toEqual(['room'])
    await vi.advanceTimersByTimeAsync(15_000)
    expect(firstFinished).not.toHaveBeenCalled()
    expect(latestFinished).toHaveBeenCalledExactlyOnceWith(false)
    if (typeof cleanup === 'function') cleanup()
  })

  it('не предлагает второй платный запуск после потери ответа и проверяет статус', async () => {
    hooks.request.mockRejectedValueOnce(new Error('Network'))
    await click(render(ConceptsPanel, panelProps), 'Сгенерировать концепты')
    let tree = render(ConceptsPanel, panelProps)
    expect(errorMessage(tree)).toContain('генерация могла начаться')
    hooks.refreshConcepts.mockResolvedValueOnce({ ok: true, data: { pending: 1 } })
    await click(tree, 'Проверить статус генерации')
    tree = render(ConceptsPanel, panelProps)
    expect(find(tree, (props) => props.children === 'Проверить статус генерации')).toBeTruthy()
    expect(hooks.request).toHaveBeenCalledTimes(1)
    expect(hooks.refresh).toHaveBeenCalledOnce()
  })

  it('сохраняет безопасную проверку, если повторный запрос статуса тоже не дошёл', async () => {
    hooks.request.mockRejectedValueOnce(new Error('Network'))
    await click(render(ConceptsPanel, panelProps), 'Сгенерировать концепты')
    hooks.refreshConcepts.mockRejectedValueOnce(new Error('Network'))
    await click(render(ConceptsPanel, panelProps), 'Проверить статус генерации')
    expect(errorMessage(render(ConceptsPanel, panelProps))).toContain('новая генерация не запущена')
    expect(hooks.request).toHaveBeenCalledTimes(1)
  })

  it('показывает проверку при серверном неопределённом ответе, а не только при транспортном сбое', async () => {
    hooks.request.mockResolvedValueOnce({
      ok: false,
      error: 'Статус запуска пока не подтверждён.',
      checkStatus: true,
    })
    await click(render(ConceptsPanel, panelProps), 'Сгенерировать концепты')
    const tree = render(ConceptsPanel, panelProps)
    expect(find(tree, (props) => props.children === 'Проверить статус генерации')).toBeTruthy()
    expect(hooks.request).toHaveBeenCalledOnce()
  })

  it('при возвращении к неподтверждённому запуску предлагает проверку вместо новой генерации', () => {
    const tree = render(ConceptsPanel, { ...panelProps, initialNeedsStatusCheck: true })
    expect(find(tree, (props) => props.children === 'Проверить статус генерации')).toBeTruthy()
    expect(hooks.request).not.toHaveBeenCalled()
  })

  it.each([true, false])(
    'возвращает несохранённый голос в исходное состояние: reject=%s',
    async (reject) => {
      const props: typeof panelProps = {
        ...panelProps,
        items: [
          {
            id: 'concept',
            batchId: 'batch',
            batchKind: 'regular',
            editRequest: null,
            title: null,
            status: 'ready',
            renderSrc: '/image',
            owner: null,
            partner: null,
            orderIndex: 0,
          },
        ],
      }
      if (reject) hooks.vote.mockRejectedValueOnce(new Error('Network'))
      else hooks.vote.mockResolvedValueOnce({ ok: false, error: 'Сессия закончилась' })
      const deck = find(render(ConceptsPanel, props), (props) => typeof props.onVote === 'function')
      await (deck.onVote as (card: { id: string }, liked: boolean) => Promise<void>)(
        { id: 'concept' },
        true,
      )
      const restored = find(
        render(ConceptsPanel, props),
        (props) => typeof props.onVote === 'function',
      )
      expect(restored.cards).toHaveLength(1)
      expect(hooks.toast).toHaveBeenCalledOnce()
    },
  )

  it('сохраняет дробные мерки и заметки после транспортной ошибки и позволяет повторить сохранение', async () => {
    const props = { roomId: 'room', measurements: null }
    let tree = render(RoomMeasurementsForm, props)
    const input = find(tree, (props) => props.id === 'room-width-room')
    const changeWidth = input.onChange as (event: unknown) => void
    changeWidth({ currentTarget: { value: '400,3' } })
    tree = render(RoomMeasurementsForm, props)
    hooks.saveMeasurements.mockRejectedValueOnce(new Error('Network'))
    const submit = find(tree, (props) => typeof props.onSubmit === 'function').onSubmit as (
      event: unknown,
    ) => Promise<void>
    await submit({ preventDefault: vi.fn() })
    tree = render(RoomMeasurementsForm, props)
    expect(find(tree, (props) => props.id === 'room-width-room').value).toBe('400,3')
    expect(errorMessage(tree)).toContain('Не удалось сохранить мерки')
    expect(find(tree, (props) => typeof props.disabled === 'boolean').disabled).toBe(false)
    hooks.saveMeasurements.mockResolvedValueOnce({ ok: true })
    await (find(tree, (props) => typeof props.onSubmit === 'function').onSubmit as typeof submit)({
      preventDefault: vi.fn(),
    })
    expect(hooks.saveMeasurements).toHaveBeenLastCalledWith(
      'room',
      expect.objectContaining({ widthCm: '400,3' }),
    )
    expect(hooks.refresh).toHaveBeenCalledOnce()
  })

  it('проверяет тот же выполняющийся PDF вместо нового экспорта', async () => {
    const props = { ...exportProps, exports: [pdf] }
    hooks.loadPdf.mockResolvedValueOnce({ ok: true, data: pdf })
    await click(render(ExportCard, props), 'Проверить статус PDF')
    expect(hooks.loadPdf).toHaveBeenCalledWith('existing-pdf')
    expect(hooks.startPdf).not.toHaveBeenCalled()
    expect(
      find(render(ExportCard, props), (props) => props['aria-label'] === 'Обложка PDF').disabled,
    ).toBe(true)
    expect(
      find(render(ExportCard, props), (props) => props.children === 'Проверить статус PDF'),
    ).toBeTruthy()
  })

  it('сохраняет идентификатор PDF после потери очереди и транспортной ошибки проверки', async () => {
    const props = {
      ...exportProps,
      initialRun: {
        runId: 'run',
        accessToken: 'token',
        exportId: 'started-pdf',
        kind: 'free' as const,
      },
    }
    hooks.loadPdf.mockRejectedValueOnce(new Error('Network'))
    const waiting = render(ExportCard, props)
    const finished = find(waiting, (props) => props.runId === 'run').onFinished as (
      failed: boolean,
    ) => Promise<void>
    await finished(false)
    expect(errorMessage(render(ExportCard, props))).toContain('новая сборка не запускается')
    hooks.loadPdf.mockResolvedValueOnce({ ok: true, data: { ...pdf, id: 'started-pdf' } })
    await click(render(ExportCard, props), 'Проверить статус PDF')
    expect(hooks.loadPdf).toHaveBeenLastCalledWith('started-pdf')
    expect(hooks.loadPdfs).not.toHaveBeenCalled()
    expect(hooks.startPdf).not.toHaveBeenCalled()
  })

  it('оставляет данные обложки после отказа запуска PDF и показывает серверную причину', async () => {
    const props = { ...exportProps, contact: { clientName: 'Анна', address: 'Адрес', phone: '' } }
    hooks.startPdf.mockResolvedValueOnce({ ok: false, error: 'Сессия закончилась. Войдите снова.' })
    await click(render(ExportCard, props), 'Бесплатно собрать PDF с водяным знаком')
    const tree = render(ExportCard, props)
    expect(errorMessage(tree)).toContain('Сессия закончилась')
    expect(hooks.state).toContain('Анна')
    expect(
      find(tree, (props) => props.children === 'Бесплатно собрать PDF с водяным знаком').pending,
    ).toBe(false)
  })

  it('проверяет список после неизвестного запуска, а не скачивает старый готовый PDF', async () => {
    const props = {
      ...exportProps,
      exports: [{ ...pdf, status: 'ready' as const, pdfUrl: '/old.pdf' }],
    }
    hooks.startPdf.mockRejectedValueOnce(new Error('Network'))
    await click(render(ExportCard, props), 'Бесплатно собрать PDF с водяным знаком')
    hooks.loadPdfs.mockResolvedValueOnce({ ok: true, data: [pdf] })
    await click(render(ExportCard, props), 'Проверить статус PDF')
    expect(hooks.loadPdfs).toHaveBeenCalledWith('project')
    expect(hooks.loadPdf).not.toHaveBeenCalled()
    expect(hooks.startPdf).toHaveBeenCalledTimes(1)
  })

  it('показывает ошибку проверки PDF рядом с формой, не сбрасывая контакт', async () => {
    const props = {
      ...exportProps,
      contact: { clientName: 'Анна', address: 'Адрес', phone: '' },
      exports: [pdf],
    }
    hooks.loadPdf.mockRejectedValueOnce(new Error('Network'))
    await click(render(ExportCard, props), 'Проверить статус PDF')
    const tree = render(ExportCard, props)
    expect(errorMessage(tree)).toContain('новая сборка не запускается')
    expect(hooks.state).toContain('Анна')
    expect(hooks.startPdf).not.toHaveBeenCalled()
  })
})
