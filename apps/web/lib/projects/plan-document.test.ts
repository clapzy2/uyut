import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getPage: vi.fn(),
  destroy: vi.fn(),
  render: vi.fn(),
  viewport: vi.fn(),
  text: vi.fn(),
}))

vi.mock('pdfjs-dist/legacy/build/pdf.worker.mjs', () => ({}))
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  getDocument: () => ({
    promise: Promise.resolve({ numPages: 48, getPage: mocks.getPage }),
    destroy: mocks.destroy,
  }),
}))
vi.mock('@napi-rs/canvas', () => ({
  createCanvas: () => ({
    width: 100,
    height: 100,
    getContext: () => ({ fillRect: vi.fn() }),
    toBuffer: () => Buffer.from('rendered page'),
  }),
}))
vi.mock('sharp', () => ({
  default: () => ({
    resize: () => ({ jpeg: () => ({ toBuffer: async () => Buffer.from('jpeg') }) }),
  }),
}))

import { preparePlanPage } from './plan-document'

describe('selected PDF page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getPage.mockResolvedValue({
      getViewport: mocks.viewport,
      render: mocks.render,
      getTextContent: mocks.text,
    })
    mocks.text.mockResolvedValue({ items: [] })
    mocks.viewport.mockReturnValue({
      width: 1000,
      height: 2000,
      convertToViewportPoint: (x: number, y: number) => [x, y],
    })
    mocks.render.mockReturnValue({ promise: Promise.resolve() })
    mocks.destroy.mockResolvedValue(undefined)
  })

  it('renders page 6, not the first three pages, and releases the document', async () => {
    const result = await preparePlanPage(Buffer.from('pdf'), true, 6)
    expect(mocks.getPage.mock.calls).toEqual([[6]])
    expect(mocks.render).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ pageNumber: 6, pageCount: 48 })
    expect(mocks.destroy).toHaveBeenCalledTimes(1)
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid page %s',
    async (page) => {
      await expect(preparePlanPage(Buffer.from('pdf'), true, page)).rejects.toThrow(
        'Номер страницы',
      )
      expect(mocks.getPage).not.toHaveBeenCalled()
    },
  )

  it('rejects a page outside the document before rendering', async () => {
    await expect(preparePlanPage(Buffer.from('pdf'), true, 49)).rejects.toThrow('48 страниц')
    expect(mocks.getPage).not.toHaveBeenCalled()
    expect(mocks.destroy).toHaveBeenCalledOnce()
  })

  it('does not silently fall back to another page after a rendering error', async () => {
    mocks.render.mockReturnValue({ promise: Promise.reject(new Error('broken page')) })
    await expect(preparePlanPage(Buffer.from('pdf'), true, 6)).rejects.toThrow('broken page')
    expect(mocks.getPage.mock.calls).toEqual([[6]])
    expect(mocks.destroy).toHaveBeenCalledOnce()
  })

  it('rejects page 6 for an image', async () => {
    await expect(preparePlanPage(Buffer.from('image'), false, 6)).rejects.toThrow('одна страница')
    expect(mocks.getPage).not.toHaveBeenCalled()
  })

  it('extracts the native text layer from the selected page, not another sheet', async () => {
    mocks.text.mockResolvedValue({ items: [{ str: '2964', transform: [1, 0, 0, 1, 250, 400] }] })
    const result = await preparePlanPage(Buffer.from('pdf'), true, 6)
    expect('planText' in result.image && result.image.planText).toBe(
      '[{"text":"2964","x":250,"y":200,"rotation":0}]',
    )
    expect(mocks.getPage.mock.calls).toEqual([[6]])
  })

  it('can still render a scanned PDF without a native text layer', async () => {
    mocks.text.mockRejectedValue(new Error('no text'))
    const result = await preparePlanPage(Buffer.from('pdf'), true, 6)
    expect(result.image).not.toHaveProperty('planText')
  })
})
