import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { pdfStandardFontDataUrl } from './plan-pdf-standard-fonts'

describe('PDF standard fonts outside the original workspace', () => {
  it('requires the traced manifest and resolves fonts from an isolated standalone layout', async () => {
    const packagePath = process
      .getBuiltinModule('module')
      .createRequire(import.meta.url)
      .resolve('pdfjs-dist/package.json')
    const originalFont = join(dirname(packagePath), 'standard_fonts', 'LiberationSans-Regular.ttf')
    const standalone = await mkdtemp(join(tmpdir(), 'domitsa-pdf-font-test-'))
    try {
      const copiedPackage = join(standalone, 'apps/web/node_modules/pdfjs-dist')
      const copiedFonts = join(copiedPackage, 'standard_fonts')
      await mkdir(copiedFonts, { recursive: true })
      await copyFile(originalFont, join(copiedFonts, 'LiberationSans-Regular.ttf'))
      // The source file itself need not exist in standalone; its runtime URL anchors resolution.
      const moduleUrl = pathToFileURL(
        join(standalone, 'apps/web/lib/projects/plan-document.ts'),
      ).href
      expect(() => pdfStandardFontDataUrl(moduleUrl)).toThrow(/Cannot find module/)

      await copyFile(packagePath, join(copiedPackage, 'package.json'))
      const url = pdfStandardFontDataUrl(moduleUrl)
      expect(url).toBe(`${copiedFonts.replaceAll('\\', '/')}/`)
      expect(await readFile(`${url}LiberationSans-Regular.ttf`)).toEqual(
        await readFile(originalFont),
      )
    } finally {
      await rm(standalone, { recursive: true, force: true })
    }
  })
})
