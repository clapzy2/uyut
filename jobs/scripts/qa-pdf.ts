// Только синтетические данные: нет чтения базы, AI-вызовов, писем или загрузки в S3.
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { estimateProject, layoutRoom } from '@uyut/catalog'
import { layoutWithMeasurements } from '@uyut/catalog/layout-with-measurements'
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
  generatedAt: new Date('2026-09-27T10:00:00Z'),
  project: {
    title: 'Тест печати — не проект квартиры',
    subtitle: 'Синтетические данные для проверки переноса длинных строк',
    facts: [{ label: 'Проверка', value: 'Покупки, границы сметы и задание для мастеров' }],
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
    rooms: [
      { id: 'room', name: 'Гостиная', areaM2: 12, condition: 'bare', refreshFinish: false },
      { id: 'kitchen', name: 'Кухня', areaM2: null, condition: 'bare', refreshFinish: false },
    ],
    items,
    budgetKopecks: 950_000_00,
    rates,
  }),
  rates,
  brief: {
    summary: 'Тестовый текст для проверки печати, не задание на выполнение работ.',
    rooms: [
      {
        name: 'Гостиная — синтетический пример',
        sections: [
          { title: 'Отделка', items: ['Обсудить цвет стен и состав работ после осмотра объекта.'] },
          { title: 'Обстановка', items: ['Сверить выбранные товары с обмерами и зоной доступа.'] },
        ],
      },
    ],
    questions: ['Какие работы согласованы с мастерами?', 'Проверены ли размеры перед заказом?'],
  },
}

function layoutFlowData(): PdfData {
  const bedroomPlan = layoutWithMeasurements(
    'Спальня',
    { widthCm: 400, depthCm: 300 },
    {
      version: 1,
      status: 'draft',
      widthCm: 400,
      heightCm: 300,
      walls: [],
      openings: [],
      warnings: [],
      rooms: [
        {
          name: 'Спальня',
          polygon: [
            { xCm: 0, yCm: 0 },
            { xCm: 400, yCm: 0 },
            { xCm: 400, yCm: 300 },
            { xCm: 0, yCm: 300 },
          ],
        },
      ],
    },
    [
      {
        id: 'bedroom-bed',
        title: 'Кровать',
        category: 'bed',
        quantity: 1,
        dimensions: { width: 140, depth: 200 },
      },
    ],
    'bedroom',
  )
  const childPlan = layoutWithMeasurements(
    'Детская',
    { widthCm: 300, depthCm: 300 },
    undefined,
    [
      {
        id: 'child-bed',
        title: 'Кровать со старым закреплённым положением',
        category: 'bed',
        quantity: 1,
        dimensions: { width: 140, depth: 200 },
        placement: { xCm: 250, yCm: 0, rotation: 0 },
      },
    ],
    'kid',
  )
  if (
    bedroomPlan?.safetySummary.status !== 'needs-data' ||
    childPlan?.safetySummary.status !== 'blocked'
  ) {
    throw new Error(
      'Проверочный PDF должен показать черновой контур и отказ после уменьшения мерки',
    )
  }
  const rooms: PdfData['rooms'] = [
    { id: 'bedroom', name: 'Спальня', areaM2: 12, plan: bedroomPlan },
    { id: 'child', name: 'Детская', areaM2: 9, plan: childPlan },
  ].map((room) => ({
    ...room,
    conditionLabel: 'Черновая отделка',
    hasConcept: false,
    render: null,
    before: null,
    alternates: [],
    note: null,
    objects: [],
  }))
  return {
    ...data,
    project: {
      ...data.project,
      title: 'Тест 2D-экспорта — синтетические данные',
      subtitle: 'Спальня и детская без AI-концептов',
      facts: [{ label: 'Проверка', value: 'Черновой контур и изменённая мерка' }],
    },
    rooms,
    roomsWithoutConcept: rooms.map((room) => room.name),
    shopping: [],
    estimate: estimateProject({
      rooms: rooms.map((room) => ({ ...room, condition: 'bare' as const, refreshFinish: false })),
      items: [],
      budgetKopecks: null,
      rates,
    }),
    brief: null,
  }
}

const isLayoutFlow = process.argv.includes('--layout-flow')
const selectedData = isLayoutFlow ? layoutFlowData() : data
const outputDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../output/pdf')
await mkdir(outputDir, { recursive: true })
const html = renderProjectHtml(selectedData, { fontCss: fontFaceCss() })
const pdf = await printPdf(html, selectedData.project.title)
const outputPath = resolve(outputDir, isLayoutFlow ? 'qa-layout-flow.pdf' : 'qa-shopping.pdf')
await writeFile(outputPath, pdf)
console.log(`Проверочный PDF: ${outputPath}`)
