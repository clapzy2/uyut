import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getPage: vi.fn(),
  destroy: vi.fn(),
  render: vi.fn(),
  viewport: vi.fn(),
  text: vi.fn(),
  operators: vi.fn(),
  getDocument: vi.fn(),
  jpeg: vi.fn(),
}))

vi.mock('pdfjs-dist/legacy/build/pdf.worker.mjs', () => ({}))
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  OPS: { constructPath: 6, stroke: 7 },
  getDocument: mocks.getDocument,
}))
vi.mock('@napi-rs/canvas', () => ({
  createCanvas: (width: number, height: number) => ({
    width,
    height,
    getContext: () => ({ fillRect: vi.fn() }),
    toBuffer: () => Buffer.from('rendered page'),
  }),
}))
vi.mock('sharp', () => ({
  default: () => ({
    resize: () => ({ jpeg: () => ({ toBuffer: mocks.jpeg }) }),
  }),
}))

import { preparePlanPage } from './plan-document'
import { bindObservedRegionLabels } from './plan-raster-region-labels'

describe('selected PDF page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.jpeg.mockResolvedValue({ data: Buffer.from('jpeg'), info: { width: 1000, height: 2000 } })
    mocks.getDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: 48, getPage: mocks.getPage }),
      destroy: mocks.destroy,
    })
    mocks.getPage.mockResolvedValue({
      getViewport: mocks.viewport,
      render: mocks.render,
      getTextContent: mocks.text,
      getOperatorList: mocks.operators,
    })
    mocks.text.mockResolvedValue({ items: [] })
    mocks.operators.mockResolvedValue({
      fnArray: [6],
      argsArray: [[7, [[0, 100, 200, 1, 300, 400]], []]],
    })
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
    expect(result.image).toMatchObject({ width: 1000, height: 2000 })
    expect(mocks.jpeg).toHaveBeenCalledWith({ resolveWithObject: true })
    expect(mocks.destroy).toHaveBeenCalledTimes(1)
  })

  it('loads installed standard fonts through runtime resolution and the Node data factory', async () => {
    const builtinAccess = vi.spyOn(process, 'getBuiltinModule')
    try {
      await preparePlanPage(Buffer.from('pdf'), true, 6)
      expect(builtinAccess).toHaveBeenCalledWith('module')
      const options = mocks.getDocument.mock.calls[0]?.[0]
      expect(options).toMatchObject({ disableFontFace: true, useWorkerFetch: false })
      expect(options.standardFontDataUrl).toMatch(/\/standard_fonts\/$/)
      const font = await readFile(`${options.standardFontDataUrl}LiberationSans-Regular.ttf`)
      expect(font.length).toBeGreaterThan(100_000)
    } finally {
      builtinAccess.mockRestore()
    }
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
  it('does not expose experimental native anchors by default', async () => {
    const result = await preparePlanPage(Buffer.from('pdf'), true, 6)
    expect(result).not.toHaveProperty('nativeTextAnchors')
    expect(result).not.toHaveProperty('lineworkRasterSource')
  })
  it('binds opt-in native linework to the same rendered raster frame and exact scale', async () => {
    const result = await preparePlanPage(Buffer.from('pdf'), true, 6, true, true)
    expect(result.lineworkRasterSource).toEqual(result.nativeTextAnchors?.source)
    expect(result.nativeTextAnchors?.pageNormalizedScale).toEqual({ x: 1, y: 2 })
  })
  it('preserves fractional native origins and separate IDs for repeated captions', async () => {
    mocks.text.mockResolvedValue({
      items: [
        { str: 'Спальня', transform: [1, 0, 0, 1, 250.25, 400.75] },
        { str: 'Спальня', transform: [1, 0, 0, 1, 650.5, 800.25] },
      ],
    })
    const result = await preparePlanPage(Buffer.from('pdf'), true, 6, false, true)
    expect(result.nativeTextAnchors).toMatchObject({
      complete: true,
      source: { page: 6, width: 1000, height: 2000 },
      labels: [
        { id: 'native-text-0', name: 'Спальня' },
        { id: 'native-text-1', name: 'Спальня' },
      ],
    })
    expect(result.nativeTextAnchors?.labels[0]?.point.x).toBeCloseTo(250.25)
    expect(result.nativeTextAnchors?.labels[0]?.point.y).toBeCloseTo(400.75)
    expect(result.nativeTextAnchors?.labels[1]?.point.x).toBeCloseTo(650.5)
    expect(result.nativeTextAnchors?.labels[1]?.point.y).toBeCloseTo(800.25)
    expect(result.nativeTextAnchors?.source.sha256).toBe(
      createHash('sha256').update(result.image.body).digest('hex'),
    )
    const native = result.nativeTextAnchors
    if (!native) throw new Error('Native anchors missing')
    const binding = bindObservedRegionLabels({
      regionSource: native.source,
      labelSource: native.source,
      labels: native.labels,
      regions: [
        {
          id: 'left',
          polygon: [
            { x: 100, y: 100 },
            { x: 400, y: 100 },
            { x: 400, y: 1000 },
            { x: 100, y: 1000 },
          ],
        },
        {
          id: 'right',
          polygon: [
            { x: 500, y: 100 },
            { x: 900, y: 100 },
            { x: 900, y: 1000 },
            { x: 500, y: 1000 },
          ],
        },
      ],
    })
    expect(binding.assignments.map(({ labelId, regionId }) => ({ labelId, regionId }))).toEqual([
      { labelId: 'native-text-0', regionId: 'left' },
      { labelId: 'native-text-1', regionId: 'right' },
    ])
  })
  it('uses the rendered viewport orientation and final raster size for native origins', async () => {
    mocks.viewport.mockImplementation(({ scale }: { scale: number }) => ({
      width: 800 * scale,
      height: 600 * scale,
      convertToViewportPoint: (x: number, y: number) => [y * scale, (600 - x) * scale],
    }))
    mocks.jpeg.mockResolvedValue({ data: Buffer.from('jpeg'), info: { width: 1600, height: 1200 } })
    mocks.text.mockResolvedValue({ items: [{ str: 'Кухня', transform: [1, 0, 0, 1, 100, 200] }] })
    const result = await preparePlanPage(Buffer.from('pdf'), true, 6, false, true)
    expect(result.nativeTextAnchors?.labels[0]?.point.x).toBeCloseTo(
      ((200 * (150 / 72)) / 1667) * 1600,
    )
    expect(result.nativeTextAnchors?.labels[0]?.point.y).toBeCloseTo(1000)
  })
  it('marks unavailable, truncated, and out-of-frame native layers incomplete', async () => {
    mocks.text.mockRejectedValueOnce(new Error('no layer'))
    const missing = await preparePlanPage(Buffer.from('pdf'), true, 6, false, true)
    expect(missing.nativeTextAnchors).toMatchObject({ complete: false, labels: [] })
    mocks.text.mockResolvedValue({
      items: [
        { str: 'x'.repeat(201), transform: [1, 0, 0, 1, 100, 100] },
        { str: 'Кухня', transform: [1, 0, 0, 1, -10, 100] },
      ],
    })
    const invalid = await preparePlanPage(Buffer.from('pdf'), true, 6, false, true)
    expect(invalid.nativeTextAnchors).toMatchObject({ complete: false, labels: [] })
  })
  it('does not extract vectors for the default reading path', async () => {
    const page = await preparePlanPage(Buffer.from('pdf'), true, 6)
    expect(page).not.toHaveProperty('linework')
    expect(mocks.operators).not.toHaveBeenCalled()
  })
  it('marks a native text byte-budget cutoff incomplete', async () => {
    mocks.text.mockResolvedValue({
      items: Array.from({ length: 1000 }, (_, index) => ({
        str: `Подпись-${index}`,
        transform: [1, 0, 0, 1, 100, 100],
      })),
    })
    const result = await preparePlanPage(Buffer.from('pdf'), true, 6, false, true)
    expect(result.nativeTextAnchors?.complete).toBe(false)
    expect(result.nativeTextAnchors?.labels.length).toBeLessThan(1000)
  })
  it('maps native anchors through the large-page pixel budget and downsampling', async () => {
    mocks.viewport.mockImplementation(({ scale }: { scale: number }) => ({
      width: 4000 * scale,
      height: 4000 * scale,
      convertToViewportPoint: (x: number, y: number) => [x * scale, (4000 - y) * scale],
    }))
    mocks.jpeg.mockResolvedValue({ data: Buffer.from('jpeg'), info: { width: 2000, height: 2000 } })
    mocks.text.mockResolvedValue({ items: [{ str: 'Кухня', transform: [1, 0, 0, 1, 1000, 3000] }] })
    const result = await preparePlanPage(Buffer.from('pdf'), true, 6, false, true)
    const renderSide = Math.sqrt(12_000_000)
    const expected = (renderSide / 4 / Math.ceil(renderSide)) * 2000
    expect(result.nativeTextAnchors?.labels[0]?.point.x).toBeCloseTo(expected)
    expect(result.nativeTextAnchors?.labels[0]?.point.y).toBeCloseTo(expected)
  })
  it('uses viewport crop offsets instead of treating PDF origins as raster coordinates', async () => {
    mocks.viewport.mockImplementation(({ scale }: { scale: number }) => ({
      width: 800 * scale,
      height: 600 * scale,
      convertToViewportPoint: (x: number, y: number) => [(x - 50) * scale, (650 - y) * scale],
    }))
    mocks.jpeg.mockResolvedValue({ data: Buffer.from('jpeg'), info: { width: 1600, height: 1200 } })
    mocks.text.mockResolvedValue({ items: [{ str: 'Кухня', transform: [1, 0, 0, 1, 150, 550] }] })
    const result = await preparePlanPage(Buffer.from('pdf'), true, 6, false, true)
    expect(result.nativeTextAnchors?.labels[0]?.point.x).toBeCloseTo(
      ((100 * (150 / 72)) / 1667) * 1600,
    )
    expect(result.nativeTextAnchors?.labels[0]?.point.y).toBeCloseTo(200)
  })
  it('extracts the requested vector layer on the same selected page using the physical page format', async () => {
    mocks.viewport.mockImplementation(({ scale }: { scale: number }) => ({
      width: 842 * scale,
      height: 1191 * scale,
      convertToViewportPoint: (x: number, y: number) => [x * scale, (1191 - y) * scale],
    }))
    const page = await preparePlanPage(Buffer.from('pdf'), true, 6, true)
    expect(mocks.getPage.mock.calls).toEqual([[6]])
    expect(mocks.operators).toHaveBeenCalledTimes(1)
    expect(mocks.viewport).toHaveBeenCalledWith({ scale: 1 })
    expect(page.linework).toMatchObject({ pageWidth: 842, pageHeight: 1191, truncated: false })
    expect(page.linework?.paths).toHaveLength(1)
    expect(mocks.destroy).toHaveBeenCalledOnce()
  })
  it('renders the page after vector extraction fails but does not fabricate an empty valid layer', async () => {
    mocks.operators.mockRejectedValue(new Error('missing vector layer'))
    const page = await preparePlanPage(Buffer.from('pdf'), true, 6, true)
    expect(page).not.toHaveProperty('linework')
    expect(mocks.render).toHaveBeenCalledOnce()
    expect(mocks.destroy).toHaveBeenCalledOnce()
  })
  it('does not produce vectors for a raster image even if review extraction was requested', async () => {
    const page = await preparePlanPage(Buffer.from('image'), false, 1, true)
    expect(page).not.toHaveProperty('linework')
    expect(mocks.operators).not.toHaveBeenCalled()
  })
})
