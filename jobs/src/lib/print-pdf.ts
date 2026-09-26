import { footerTemplate } from '@uyut/pdf'
import { chromium } from 'playwright'

/** Один путь печати для production-задачи и бесплатного локального QA. */
export async function printPdf(html: string, title: string): Promise<Buffer> {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'load' })
    await page.emulateMedia({ media: 'print' })
    await page.evaluate('document.fonts.ready')
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: footerTemplate(title),
    })
  } finally {
    await browser.close()
  }
}
