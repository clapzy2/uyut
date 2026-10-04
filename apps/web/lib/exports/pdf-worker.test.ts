import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type ExportPayload = { exportId: string }
type WorkerRun = (payload: ExportPayload) => Promise<unknown>

const mocks = vi.hoisted(() => ({
  run: undefined as WorkerRun | undefined,
  select: vi.fn(),
  selectLimit: vi.fn(),
  update: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
  loadSnapshot: vi.fn(),
  briefInput: vi.fn(),
  briefHash: vi.fn(),
  createBriefGenerator: vi.fn(),
  generateBrief: vi.fn(),
  buildPdfData: vi.fn(),
  renderHtml: vi.fn(),
  printPdf: vi.fn(),
  putObject: vi.fn(),
  publish: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  fetch: vi.fn(),
}))

vi.mock('@trigger.dev/sdk', () => ({
  task: (configuration: { run: WorkerRun }) => {
    mocks.run = configuration.run
    return configuration
  },
  metadata: { set: mocks.publish },
  logger: { info: mocks.info, warn: mocks.warn },
}))
vi.mock('@uyut/ai', () => ({
  briefHash: mocks.briefHash,
  createFalBriefGenerator: mocks.createBriefGenerator,
}))
vi.mock('@uyut/pdf', () => ({
  fontFaceCss: () => '',
  renderProjectHtml: mocks.renderHtml,
}))
vi.mock('../../../../jobs/src/lib/db', () => ({
  db: () => ({ select: mocks.select, update: mocks.update }),
}))
vi.mock('../../../../jobs/src/lib/pdf-data', () => ({
  loadSnapshot: mocks.loadSnapshot,
  briefInput: mocks.briefInput,
  buildPdfData: mocks.buildPdfData,
}))
vi.mock('../../../../jobs/src/lib/print-pdf', () => ({ printPdf: mocks.printPdf }))
vi.mock('../../../../jobs/src/lib/s3', () => ({ putObject: mocks.putObject }))

// Регистрируется настоящий обработчик задачи; подменены только его внешние зависимости.
import '../../../../jobs/src/export-pdf'

const exportId = '80c54522-3c6d-45cd-ae28-624f13214b33'
const projectId = 'f8e4e17d-9d75-4c8c-9c56-546758e3670c'
const pdf = Buffer.from('%PDF-1.7\n/Type /Page\n%%EOF')

function run() {
  if (!mocks.run) throw new Error('Не зарегистрирован обработчик PDF')
  return mocks.run({ exportId })
}

function exportRow(kind: 'free' | 'paid') {
  mocks.selectLimit.mockResolvedValueOnce([{ id: exportId, projectId, kind, options: {} }])
  mocks.selectLimit.mockResolvedValueOnce([])
}

function expectFailedWithoutFile(message: string) {
  expect(mocks.updateSet.mock.calls.map(([value]) => value.status)).toEqual(['running', 'failed'])
  expect(mocks.updateSet).toHaveBeenLastCalledWith({
    status: 'failed',
    error: expect.stringContaining(message),
    finishedAt: expect.any(Date),
  })
  expect(mocks.renderHtml).not.toHaveBeenCalled()
  expect(mocks.printPdf).not.toHaveBeenCalled()
  expect(mocks.putObject).not.toHaveBeenCalled()
  expect(mocks.fetch).not.toHaveBeenCalled()
}

describe('PDF-обработчик: обязательное задание в оплаченной версии', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('FAL_KEY', '')
    vi.stubEnv('WORKS_ROUGH_RUB_PER_M2', '')
    vi.stubEnv('WORKS_FINISH_RUB_PER_M2', '')
    vi.stubGlobal('fetch', mocks.fetch)
    mocks.fetch.mockRejectedValue(new Error('Внешние запросы в этом тесте запрещены'))

    const query = {
      from: vi.fn(),
      where: vi.fn(),
      orderBy: vi.fn(),
      limit: mocks.selectLimit,
    }
    query.from.mockReturnValue(query)
    query.where.mockReturnValue(query)
    query.orderBy.mockReturnValue(query)
    mocks.select.mockReturnValue(query)
    mocks.update.mockReturnValue({ set: mocks.updateSet })
    mocks.updateSet.mockReturnValue({ where: mocks.updateWhere })
    mocks.updateWhere.mockResolvedValue(undefined)

    mocks.loadSnapshot.mockResolvedValue({ project: { id: projectId } })
    mocks.briefInput.mockReturnValue({ project: { title: 'Тестовый проект' }, rooms: [] })
    mocks.briefHash.mockReturnValue('brief-hash')
    mocks.createBriefGenerator.mockReturnValue(mocks.generateBrief)
    mocks.buildPdfData.mockResolvedValue({
      project: { title: 'Тестовый проект' },
      brief: null,
      summary: null,
    })
    mocks.renderHtml.mockReturnValue('<html>Тестовый документ</html>')
    mocks.printPdf.mockResolvedValue(pdf)
    mocks.putObject.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('не печатает оплаченный документ без ключа и без сохранённого задания', async () => {
    exportRow('paid')
    await expect(run()).rejects.toThrow('ТЗ не собралось: нет FAL_KEY')
    expect(mocks.createBriefGenerator).not.toHaveBeenCalled()
    expectFailedWithoutFile('нет FAL_KEY')
  })

  it('не печатает оплаченный документ после отказа модели', async () => {
    exportRow('paid')
    vi.stubEnv('FAL_KEY', 'test-key-not-a-secret')
    mocks.generateBrief.mockRejectedValue(new Error('Модель не вернула задание'))
    await expect(run()).rejects.toThrow('ТЗ не собралось: Error: Модель не вернула задание')
    expect(mocks.createBriefGenerator).toHaveBeenCalledExactlyOnceWith('test-key-not-a-secret')
    expect(mocks.generateBrief).toHaveBeenCalledOnce()
    expectFailedWithoutFile('Модель не вернула задание')
  })

  it('собирает бесплатный предпросмотр без ключа, не вызывая модель или письмо', async () => {
    exportRow('free')
    const pdfKey = `projects/${projectId}/exports/${exportId}.pdf`
    await expect(run()).resolves.toMatchObject({ exportId, pdfKey, pages: 1 })
    expect(mocks.createBriefGenerator).not.toHaveBeenCalled()
    expect(mocks.renderHtml).toHaveBeenCalledWith(
      expect.objectContaining({ brief: null, summary: null }),
      { fontCss: '' },
    )
    expect(mocks.printPdf).toHaveBeenCalledExactlyOnceWith(
      '<html>Тестовый документ</html>',
      'Тестовый проект',
    )
    expect(mocks.putObject).toHaveBeenCalledExactlyOnceWith(
      pdfKey,
      pdf,
      'application/pdf',
      expect.any(AbortSignal),
    )
    expect(mocks.updateSet.mock.calls.map(([value]) => value.status)).toEqual(['running', 'ready'])
    expect(mocks.updateSet).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'ready', pdfKey, brief: null, pages: 1 }),
    )
    expect(mocks.publish).toHaveBeenLastCalledWith('progress', { stage: 'done' })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it.each(['free', 'paid'] as const)(
    'сохраняет отказ загрузки и не повторяет модель или письмо: %s',
    async (kind) => {
      const controller = new AbortController()
      const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
      const brief = { rooms: [], questions: [] }
      mocks.selectLimit.mockResolvedValueOnce([{ id: exportId, projectId, kind, options: {} }])
      mocks.selectLimit.mockResolvedValueOnce([{ brief }])
      mocks.putObject.mockImplementation(
        (_key, _body, _contentType, signal: AbortSignal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true })
          }),
      )
      const pending = run()
      const failure = expect(pending).rejects.toThrow('Истекло время загрузки PDF')
      await vi.waitFor(() => expect(mocks.putObject).toHaveBeenCalledOnce())
      controller.abort(new Error('Истекло время загрузки PDF'))
      await failure
      expect(timeout).toHaveBeenCalledExactlyOnceWith(60_000)
      expect(mocks.updateSet.mock.calls.map(([value]) => value.status)).toEqual([
        'running',
        'failed',
      ])
      expect(mocks.updateSet).toHaveBeenLastCalledWith({
        status: 'failed',
        error: expect.stringContaining('Истекло время загрузки PDF'),
        finishedAt: expect.any(Date),
      })
      expect(mocks.generateBrief).not.toHaveBeenCalled()
      expect(mocks.fetch).not.toHaveBeenCalled()
    },
  )
})
