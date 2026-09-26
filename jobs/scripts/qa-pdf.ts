// Только синтетические данные: нет чтения базы, AI-вызовов, писем или загрузки в S3.
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { estimateProject, layoutRoom } from '@uyut/catalog'
import { fontFaceCss, type PdfData, renderProjectHtml } from '@uyut/pdf'
import { printPdf } from '../src/lib/print-pdf'

const rates = { roughRubPerM2: 15_000, finishRubPerM2: 5_000 }
const items = Array.from({ length: 18 }, (_, index) => ({
  title: `Диван с выбранной зелёной тканью, позиция ${index + 1}`,
  meta: 'Askona · зелёная ткань · ширина 210 см, глубина 90 см · размеры введены вами · нет в наличии',
  affiliateUrl: `https://example.com/sofa?fabric=green&item=${index + 1}`,
  image: null,
  quantity: 2,
  priceKopecks: 8_000_00,
  totalKopecks: 16_000_00,
  adDisclosure: 'ТЕСТОВЫЕ ДАННЫЕ. Не предложение покупки.',
}))
const data: PdfData = {
  kind: 'free',
  generatedAt: new Date('2026-09-26T10:00:00Z'),
  project: {
    title: 'Тест печати — не проект квартиры',
    subtitle: 'Синтетические данные для проверки переноса длинных строк',
    facts: [{ label: 'Проверка', value: 'Ткань, габариты, ссылки и многостраничный список' }],
    contact: null,
    projectUrl: 'example.com/test',
  },
  summary: null,
  cover: null,
  band: null,
  rooms: [
    {
      id: 'room',
      name: 'Гостиная',
      areaM2: 12,
      conditionLabel: 'Черновая отделка',
      render: null,
      before: null,
      alternates: [],
      note: null,
      objects: [],
      plan: {
        ...layoutRoom({ widthCm: 400, depthCm: 300 }, [
          {
            id: 'sofa',
            title: 'Диван',
            category: 'sofa',
            quantity: 1,
            dimensions: { width: 210, depth: 90 },
          },
        ]),
        measurementNote: 'Синтетический пример. Не подтверждает обмеры или безопасность квартиры.',
      },
    },
  ],
  roomsWithoutConcept: ['Кухня'],
  shopping: [{ roomName: 'Гостиная', items }],
  estimate: estimateProject({
    rooms: [{ id: 'room', name: 'Гостиная', areaM2: 12, condition: 'bare', refreshFinish: false }],
    items,
    budgetKopecks: 950_000_00,
    rates,
  }),
  rates,
  brief: null,
}
const outputDir = resolve(import.meta.dir, '../../output/pdf')
await mkdir(outputDir, { recursive: true })
const html = renderProjectHtml(data, { fontCss: fontFaceCss() })
const pdf = await printPdf(html, data.project.title)
const outputPath = resolve(outputDir, 'qa-shopping.pdf')
await Bun.write(outputPath, pdf)
console.log(`Проверочный PDF: ${outputPath}`)
