// Free local vector probe of the existing measurement sheet; never imports an AI client.
// bun run scripts/plan-vector-report.ts <source-pdf>
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import sharp from 'sharp'
import reference from '../../../docs/qa/fixtures/apartment-74-77.json'
import labels from '../../../docs/qa/fixtures/apartment-74-77-native-labels.json'
import nativeLeaders from '../../../docs/qa/fixtures/apartment-74-77-native-leaders.json'
import { pdfCalloutLeader } from '../lib/projects/plan-pdf-leaders'
import { extractPdfLinework } from '../lib/projects/plan-pdf-linework'

const source = process.argv[2]
if (!source || source.startsWith('--')) throw new Error('Укажите исходный обмерный PDF.')
const body = await readFile(resolve(source))
const sha256 = createHash('sha256').update(body).digest('hex')
if (sha256 !== reference.source.sha256) throw new Error('PDF отличается от контрольного источника.')
const loading = pdfjs.getDocument({ data: new Uint8Array(body), disableFontFace: true })
try {
  const document = await loading.promise
  const page = await document.getPage(reference.source.pdfPage)
  const viewport = page.getViewport({ scale: 1 })
  const work = extractPdfLinework(await page.getOperatorList(), pdfjs.OPS, viewport)
  const text = await page.getTextContent()
  const actualLabels = text.items.flatMap((item) => {
    if (!('str' in item) || !item.str.trim()) return []
    const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5])
    return [
      {
        text: item.str.trim(),
        x: Math.round((x / viewport.width) * 1000),
        y: Math.round((y / viewport.height) * 1000),
      },
    ]
  })
  for (const expected of labels.items.filter((item) => item.text.includes('натяжной'))) {
    const actual = actualLabels[expected.index]
    if (
      !actual ||
      actual.text !== expected.text ||
      actual.x !== expected.x ||
      actual.y !== expected.y
    ) {
      throw new Error('Потолочная подпись не совпала с нативным эталоном.')
    }
  }
  for (const expected of nativeLeaders.paths) {
    const actual = work.paths.find(
      (path) =>
        path.operationIndex === expected.operationIndex &&
        path.subpathIndex === expected.subpathIndex,
    )
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      throw new Error('Векторная фикстура не совпала с исходным PDF.')
  }
  const callouts = labels.items
    .filter((item) => item.text.includes('натяжной'))
    .map((item) => ({
      textItemIndex: item.index,
      text: item.text,
      labelPoint: { x: item.x, y: item.y },
      leader: pdfCalloutLeader(work, item),
    }))
  const { paths, ...metadata } = work
  const report = {
    source: reference.source,
    pdfjsVersion: pdfjs.version,
    paidCalls: 0,
    ...metadata,
    pathCount: paths.length,
    pointCount: paths.reduce((sum, path) => sum + path.points.length, 0),
    verifiedNativeCalloutPaths: nativeLeaders.paths.length,
    callouts,
    limitations: [
      'Векторные пути — не стены и не размеры в миллиметрах.',
      'Кандидат связи рамка—линия—наконечник не доказывает номер помещения.',
      'Кривые пропущены, формы/группы и не прямоугольные клипы не интерпретируются.',
      'Цвета, прозрачность и видимость PDF-слоёв не переносятся; диагностическая картинка не является копией исходного листа.',
      'Новые мерки не подставлены в проекты; точность AI-чтения заново не измерена.',
    ],
  }
  const highlighted = new Set(
    callouts.flatMap(({ leader }) =>
      leader.status === 'candidate'
        ? [leader.box, leader.arrow.path, ...leader.stem].map(
            (path) => `${path.operationIndex}:${path.subpathIndex}`,
          )
        : [],
    ),
  )
  const vectorPaths = paths
    .map((path) => {
      const key = `${path.operationIndex}:${path.subpathIndex}`
      const points = path.points.map((point) => `${point.x},${point.y}`).join(' ')
      const element = path.closed ? 'polygon' : 'polyline'
      const color = highlighted.has(key) ? '#be3b20' : '#646867'
      return `<${element} points="${points}" fill="${path.paint === 'stroke' ? 'none' : '#cdd0ca'}" stroke="${color}" stroke-width="${highlighted.has(key) ? 1.1 : 0.35}"/>`
    })
    .join('\n')
  const markers = callouts
    .map(({ leader }, index) =>
      leader.status === 'candidate'
        ? `<circle cx="${leader.arrow.tip.x}" cy="${leader.arrow.tip.y}" r="4" fill="#be3b20"/><text x="${leader.arrow.tip.x + 6}" y="${leader.arrow.tip.y - 3}" font-size="9" fill="#be3b20">${index + 1}</text>`
        : '',
    )
    .join('\n')
  // Source drawing only: omit the lower address/title block. This is not a new source PDF.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1772" viewBox="180 50 680 710" preserveAspectRatio="none"><rect x="180" y="50" width="680" height="710" fill="white"/>${vectorPaths}${markers}</svg>`
  const directory = resolve('../../output/quality-bench/plan-vector-74-77')
  await mkdir(directory, { recursive: true })
  await writeFile(resolve(directory, 'report.json'), JSON.stringify(report, null, 2))
  await writeFile(resolve(directory, 'linework.svg'), svg)
  await sharp(Buffer.from(svg)).png().toFile(resolve(directory, 'linework.png'))
  console.log(JSON.stringify(report, null, 2))
} finally {
  await loading.destroy()
}
