import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

type Face = {
  family: string
  pkg: string
  file: string
  weight: string
  unicodeRange: string
}

// Подмножества из Google Fonts: кириллица, расширенная кириллица и латиница
const RANGES = {
  cyrillic: 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116',
  cyrillicExt: 'U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F',
  latin:
    'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
}

function variable(family: string, pkg: string, slug: string, weight: string): Face[] {
  return [
    {
      family,
      pkg,
      file: `${slug}-cyrillic-wght-normal.woff2`,
      weight,
      unicodeRange: RANGES.cyrillic,
    },
    {
      family,
      pkg,
      file: `${slug}-cyrillic-ext-wght-normal.woff2`,
      weight,
      unicodeRange: RANGES.cyrillicExt,
    },
    { family, pkg, file: `${slug}-latin-wght-normal.woff2`, weight, unicodeRange: RANGES.latin },
  ]
}

function fixed(family: string, pkg: string, slug: string, weights: string[]): Face[] {
  return weights.flatMap((weight) => [
    {
      family,
      pkg,
      file: `${slug}-cyrillic-${weight}-normal.woff2`,
      weight,
      unicodeRange: RANGES.cyrillic,
    },
    {
      family,
      pkg,
      file: `${slug}-latin-${weight}-normal.woff2`,
      weight,
      unicodeRange: RANGES.latin,
    },
  ])
}

const FACES: Face[] = [
  ...variable('Literata', '@fontsource-variable/literata', 'literata', '200 900'),
  ...variable('Onest', '@fontsource-variable/onest', 'onest', '100 900'),
  ...fixed('JetBrains Mono', '@fontsource/jetbrains-mono', 'jetbrains-mono', ['400', '500']),
]

let cached: string | undefined

/**
 * CSS с вшитыми шрифтами. Файлы читаются из пакетов fontsource один раз на процесс;
 * в PDF Chromium вкладывает только использованные глифы, поэтому размер документа не страдает.
 */
export function fontFaceCss(): string {
  if (cached) {
    return cached
  }
  cached = FACES.map((face) => {
    const path = require.resolve(`${face.pkg}/files/${face.file}`)
    const base64 = readFileSync(path).toString('base64')
    return [
      '@font-face {',
      `  font-family: '${face.family}';`,
      '  font-style: normal;',
      `  font-weight: ${face.weight};`,
      '  font-display: block;',
      `  src: url(data:font/woff2;base64,${base64}) format('woff2');`,
      `  unicode-range: ${face.unicodeRange};`,
      '}',
    ].join('\n')
  }).join('\n')
  return cached
}
