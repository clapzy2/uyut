import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  type NativeReviewPacket,
  nativeReviewPacket,
} from '@/lib/projects/plan-native-review-packet'
import { inspectReviewedPageCoverage } from '@/lib/projects/plan-page-reviewed-coverage'
import { NativeReviewResult, PlanNativeReview, SavedReviewCoverage } from './plan-native-review'

function linkedSourcePacket() {
  const packet = nativeReviewPacket({
    source: { sha256: 'b'.repeat(64), pdfPage: 1, state: 'existing' },
    image: { sha256: 'a'.repeat(64), page: 1, width: 1000, height: 1000 },
  })
  packet.doorSymbols = {
    status: 'draft',
    refusalReason: null,
    candidates: [
      {
        id: 'door-panel',
        arc: {
          start: { x: 50, y: 100 },
          segments: [
            {
              control1: { x: 50, y: 72.386 },
              control2: { x: 72.386, y: 50 },
              end: { x: 100, y: 50 },
            },
          ],
        },
        leaf: { start: { x: 100, y: 100 }, end: { x: 50, y: 100 } },
        endpointResidualPixels: 0.083,
      },
    ],
  }
  packet.glazingSymbols = {
    status: 'draft',
    refusalReason: null,
    candidates: ['glazing-1', 'glazing-2'].map((id, index) => ({
      id,
      polygons: [0, 5, 10].map((offset) => [
        { x: 30 + offset, y: 40 + index * 60 },
        { x: 100 + offset, y: 40 + index * 60 },
        { x: 100 + offset, y: 50 + index * 60 },
        { x: 30 + offset, y: 50 + index * 60 },
      ]),
      centerline: {
        start: { x: 30, y: 45 + index * 60 },
        end: { x: 100, y: 45 + index * 60 },
      },
    })),
  }
  packet.sourceLinks = {
    status: 'draft',
    refusalReason: null,
    doors: [
      {
        symbolId: 'door-panel',
        status: 'linked',
        targetKind: 'glazing-panel',
        targetId: 'glazing-1',
        relation: 'shared-cap-edge',
      },
    ],
    glazing: [
      { symbolId: 'glazing-1', status: 'two-sided' },
      { symbolId: 'glazing-2', status: 'two-sided' },
    ],
    groups: [{ id: 'group-1', glazingIds: ['glazing-1', 'glazing-2'], doorIds: ['door-panel'] }],
  }
  return packet
}

function manualFrameRoomsPacket() {
  const packet = linkedSourcePacket()
  const statuses = [
    ...Array<'two-reviewed-sides'>(5).fill('two-reviewed-sides'),
    'one-reviewed-side',
    'coincident-sides',
  ] as const
  packet.savedFrameRooms = {
    status: 'checked',
    frames: statuses.map((status, index) => ({
      frameId: `native-frame-${index + 1}`,
      status,
      sides: [
        {
          roomSourceNumbers: [1, 5],
          openingId: `manual-zone-door-${index + 1}`,
          kind: 'door',
          frameEdgeIndex: 0,
          numberCue: 'inside',
        },
        ...(status === 'one-reviewed-side'
          ? []
          : [
              {
                roomSourceNumbers: [status === 'coincident-sides' ? 6 : index + 2],
                openingId: `manual-room-door-${index + 1}`,
                kind: 'door' as const,
                frameEdgeIndex: status === 'coincident-sides' ? 0 : 2,
                numberCue: 'inside' as const,
              },
            ]),
      ],
    })),
  }
  packet.numberCircles = {
    status: 'draft',
    refusalReason: null,
    cues: Array.from({ length: 8 }, (_, index) => ({
      labelId: `native-circle-${index + 1}`,
      sourceNumber: index + 1,
    })),
  }
  packet.openingFrames = {
    status: 'draft',
    refusalReason: null,
    candidates: statuses.map((_, index) => ({
      id: `native-frame-${index + 1}`,
      polygon: [
        { x: 200, y: 200 + index * 20 },
        { x: 300, y: 200 + index * 20 },
        { x: 300, y: 210 + index * 20 },
        { x: 200, y: 210 + index * 20 },
      ],
    })),
  }
  return packet
}

function documentarySchedulePacket() {
  const packet = manualFrameRoomsPacket()
  packet.roomSchedule = {
    status: 'draft',
    refusalReason: null,
    rows: [
      'Прихожая',
      'Кухня',
      'Гостиная',
      'Спальня',
      'Коридор',
      'Спальня',
      'Ванная',
      'Санузел',
    ].map((name, index) => ({
      sourceNumber: index + 1,
      name,
      documentaryAreaM2: index === 0 ? 5.53 : 2 + index,
      numberLabelId: `table-number-${index + 1}`,
      nameLabelId: `table-name-${index + 1}`,
      areaLabelId: `table-area-${index + 1}`,
      markerStatus: 'linked',
      markerLabelIds: [`native-circle-${index + 1}`],
    })),
    unlistedMarkerLabelIds: [],
  }
  return packet
}

describe('read-only native review presentation', () => {
  it('distinguishes no saved review from unavailable native data without save buttons', () => {
    const empty = renderToStaticMarkup(
      createElement(SavedReviewCoverage, { savedReview: { status: 'not-saved' } }),
    )
    const unavailable = renderToStaticMarkup(
      createElement(SavedReviewCoverage, {
        savedReview: { status: 'unavailable', reason: 'native-layer-unavailable' },
      }),
    )
    expect(empty).toContain('Ручная разметка этого листа ещё не сохранена')
    expect(unavailable).toContain('Разметка сохранена, но отчёт недоступен')
    expect(unavailable).not.toContain('<button')
  })
  it('shows partial coverage as candidate evidence, not a count of physical doors', () => {
    const source = { sha256: 'b'.repeat(64), pdfPage: 1, state: 'existing' as const }
    const polygon = [
      { x: 10, y: 10 },
      { x: 100, y: 10 },
      { x: 100, y: 100 },
    ]
    const coverage = inspectReviewedPageCoverage({
      source,
      reading: {
        readAt: '2026-10-09',
        sourcePage: 1,
        planState: 'existing',
        rooms: [{ sourceNumber: 1, name: 'Комната', kind: 'living' }],
      },
      contours: {
        source,
        coordinateSystem: 'page-0-1000',
        review: 'manual-source-review',
        pageWidth: 1000,
        pageHeight: 1000,
        rooms: [{ roomSourceNumber: 1, polygon }],
      },
      linework: {
        coordinateSystem: 'page-0-1000',
        pageWidth: 1000,
        pageHeight: 1000,
        paths: [
          { operationIndex: 1, subpathIndex: 0, paint: 'stroke', closed: true, points: polygon },
        ],
        skippedCurves: 0,
        clippedPaths: 0,
        unsupportedPaths: 0,
        unsupportedContexts: 0,
        truncated: false,
      },
    })
    const html = renderToStaticMarkup(
      createElement(SavedReviewCoverage, { savedReview: { status: 'checked', coverage } }),
    )
    expect(html).toContain('Результат частичный')
    expect(html).toContain('не число физических дверей')
    expect(html).toContain('Сохранённая 2D/3D не меняется')
    expect(html).not.toContain('<button')
    expect(html).not.toContain('<svg')
    const refused = renderToStaticMarkup(
      createElement(SavedReviewCoverage, {
        savedReview: {
          status: 'checked',
          coverage: { ...coverage, status: 'refused', refusalReason: 'different-plan-source' },
        },
      }),
    )
    expect(refused).toContain('не прошла перепроверку')
    expect(refused).not.toContain('Кандидаты пар дверных граней')
  })
  it('starts without fetching or displaying private source pixels', () => {
    const html = renderToStaticMarkup(
      createElement(PlanNativeReview, {
        projectId: 'project',
        pageNumber: 1,
        sourceRevision: 'c'.repeat(64),
        onConflict: () => {},
      }),
    )
    expect(html).toContain('Проверить исходный лист')
    expect(html).toContain('без платной генерации')
    expect(html).not.toContain('<svg')
    expect(html).not.toContain('Подтвердить')
    expect(html).not.toContain('Сохранить')
  })
  it('explains readiness and unknown roles without accepting rooms or replacing saved geometry', () => {
    const packet = nativeReviewPacket({
      source: { sha256: 'b'.repeat(64), pdfPage: 1, state: 'existing' },
      image: { sha256: 'a'.repeat(64), page: 1, width: 1000, height: 1000 },
    })
    const html = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
    )
    expect(html).toContain('Сохранённые комнаты, мерки и 2D/3D не меняются')
    expect(html).toContain('Ни один цвет не означает подтверждённую комнату')
    expect(html).toContain('Что ещё нужно проверить')
    expect(html).toContain('blob:private-test')
    expect(html).not.toContain('Подтвердить')
    expect(html).not.toContain('Сохранить')
    expect(html).not.toContain('Кандидаты дверных символов')
    expect(html).not.toContain('Цифровые метки в окружностях')
    expect(html).not.toContain('Сверка рамок с сохранённой разметкой')
  })
  it('separates manual frame correspondence from automatic room identity and unchanged source pixels', () => {
    const packet = manualFrameRoomsPacket()
    const html = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
    )
    const sourceOnly = structuredClone(packet)
    delete sourceOnly.savedFrameRooms
    delete sourceOnly.numberCircles
    const sourceOnlyHtml = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet: sourceOnly, imageUrl: 'blob:private-test' }),
    )
    expect(html).toContain('Сверка рамок с сохранённой разметкой')
    expect(html).toContain('Две стороны сохранённой разметки</dt><dd>5</dd>')
    expect(html).toContain('Одна сторона сохранённой разметки</dt><dd>1</dd>')
    expect(html).toContain('Совпадающие стороны — связь не подтверждена</dt><dd>1</dd>')
    expect(html).toContain('Номера из ручной разметки: 1 + 5 — одна сохранённая зона')
    expect(html).toContain('не определены автоматически')
    expect(html).toContain('не подтверждает физический проход, принадлежность проёма комнате')
    expect(html).toContain('Цифровые метки в окружностях: 8')
    expect(html).toContain('не OCR и не число распознанных комнат')
    expect(html).toContain('связь с экспликацией не подтверждены')
    expect(html.match(/<svg\b.*?<\/svg>/s)?.[0]).toEqual(
      sourceOnlyHtml.match(/<svg\b.*?<\/svg>/s)?.[0],
    )
    expect(html.match(/<button\b/g)?.length).toEqual(sourceOnlyHtml.match(/<button\b/g)?.length)
    expect(html).not.toContain('Подтвердить')
    expect(html).not.toContain('Сохранить')
    expect(packet.readiness).toEqual({ readOnly: true, readyFor2D: false, readyFor3D: false })
  })
  it('presents documentary table matches without accepting outboard markers as room or floor owners', () => {
    const packet = documentarySchedulePacket()
    if (packet.savedFrameRooms?.status !== 'checked')
      throw new Error('Manual frame fixture is missing')
    const side = packet.savedFrameRooms.frames[0]?.sides[0]
    if (!side) throw new Error('Manual side fixture is missing')
    side.roomSourceNumbers = [8]
    side.numberCue = 'not-inside'
    const html = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
    )
    const withoutTable = structuredClone(packet)
    delete withoutTable.roomSchedule
    const baseline = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet: withoutTable, imageUrl: 'blob:private-test' }),
    )
    expect(html).toContain('Экспликация и цифровые метки')
    expect(html).toContain('Нативная экспликация и наблюдения цифровых меток')
    expect(html).toContain('документальная связь, не принадлежность метки комнате')
    expect(html).toContain('Площади — подписи на листе, не обмеры')
    expect(html).toContain('мерки и масштаб этим не принимаются')
    expect(html).toContain('Сверка с экспликацией показана ниже')
    expect(html).toContain('Контуры с номерами</dt><dd>0</dd>')
    expect(html).not.toContain('Связи с номерами</dt>')
    expect(html).not.toContain('связь с экспликацией не подтверждены')
    expect(html).toContain('Санузел</td>')
    expect(html).toContain('5,53</td>')
    expect(html.match(/Номер совпал/g)).toHaveLength(8)
    expect(html).toContain('Номера из ручной разметки: 8')
    expect(html).toContain('Цифровая метка не находится строго внутри сохранённого контура')
    expect(html.match(/<svg\b.*?<\/svg>/s)?.[0]).toEqual(baseline.match(/<svg\b.*?<\/svg>/s)?.[0])
    expect(html.match(/<button\b/g)?.length).toEqual(baseline.match(/<button\b/g)?.length)
    expect(html).toContain('w-full table-fixed')
    expect(html).toContain('scope="col"')
    expect(html).toContain('scope="row"')
    expect(html).not.toContain('Подтвердить')
    expect(html).not.toContain('Сохранить')
  })
  it('exposes ambiguity, missing observations and unlisted numeric markers instead of calling all rows matched', () => {
    const packet = documentarySchedulePacket()
    const report = packet.roomSchedule
    const [first, second] = report?.rows ?? []
    if (!report || !first || !second) throw new Error('Room schedule fixture is missing')
    first.markerStatus = 'ambiguous'
    first.markerLabelIds.push('native-circle-1-extra')
    second.markerStatus = 'unobserved'
    second.markerLabelIds = []
    report.unlistedMarkerLabelIds = ['native-circle-9']
    const html = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
    )
    expect(html).toContain('Неоднозначно (2)')
    expect(html).toContain('Не наблюдалась')
    expect(html).toContain('Метки без строки в экспликации: 1')
    expect(html).toContain('Это не дополнительные комнаты')
    expect(html).toContain('table-number-1, table-name-1, table-area-1')
    expect(html).toContain('native-circle-1, native-circle-1-extra')
    expect(html).toContain('Без строки: native-circle-9')
    expect(html).toContain('Подписи исходника и связи номеров')
    expect(html.match(/Номер совпал/g)).toHaveLength(6)
    expect(html).not.toContain('Подтвердить')
  })
  it('shows the documentary table with unavailable circle observations, not false missing-marker success', () => {
    const packet = documentarySchedulePacket()
    if (!packet.roomSchedule) throw new Error('Room schedule fixture is missing')
    for (const row of packet.roomSchedule.rows) {
      row.markerStatus = 'unavailable'
      row.markerLabelIds = []
    }
    packet.numberCircles = { status: 'unresolved', refusalReason: 'circle-search-budget', cues: [] }
    const html = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
    )
    expect(html.match(/Поиск недоступен/g)).toHaveLength(8)
    expect(html).toContain('Цифровые метки в окружностях: поиск не завершён')
    expect(html).toContain('circle-search-budget')
    expect(html).toContain('Прихожая</td>')
    expect(html).not.toContain('Не наблюдалась')
    expect(html).not.toContain('Номер совпал')
  })
  it('shows schedule refusal with no empty-success table or partial native labels', () => {
    const packet = documentarySchedulePacket()
    packet.roomSchedule = {
      status: 'unresolved',
      refusalReason: 'unsupported-native-schedule',
      rows: [],
      unlistedMarkerLabelIds: [],
    }
    const html = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
    )
    expect(html).toContain('Таблица не распознана однозначно; частичный перечень не показан')
    expect(html).toContain('unsupported-native-schedule')
    expect(html).not.toContain('<table')
    expect(html).not.toContain('table-number-1')
    expect(html).not.toContain('Сверка с экспликацией показана ниже')
    expect(html).not.toContain('Подтвердить')
    expect(html).not.toContain('Сохранить')
  })
  it('escapes table text and wraps long native provenance IDs without changing the source SVG', () => {
    const packet = documentarySchedulePacket()
    const row = packet.roomSchedule?.rows[0]
    if (!row) throw new Error('Room schedule fixture is missing')
    row.name = '<script>alert("test")</script>'
    row.numberLabelId = 'n'.repeat(128)
    row.documentaryAreaM2 = 1e-8
    const html = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
    )
    expect(html).toContain('&lt;script&gt;alert(&quot;test&quot;)&lt;/script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).toContain('class="break-words py-2 pr-2"')
    expect(html).toContain('class="break-all"')
    expect(html).toContain('1e-8</td>')
    expect(html).toContain('n'.repeat(128))
  })
  it('reports observed numbers outside manual contours without relocating them or naming owners', () => {
    const packet = manualFrameRoomsPacket()
    if (packet.savedFrameRooms?.status !== 'checked')
      throw new Error('Manual frame fixture is missing')
    const sides = packet.savedFrameRooms.frames[0]?.sides
    if (!sides?.[0] || !sides[1]) throw new Error('Manual side fixture is missing')
    sides[0].roomSourceNumbers = [8]
    sides[0].numberCue = 'not-inside'
    sides[0].kind = 'window'
    sides[1].kind = 'balcony'
    sides[1].numberCue = 'ambiguous'
    const html = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
    )
    expect(html).toContain('Номера из ручной разметки: 8. Объявлено: окно')
    expect(html).toContain('Объявлено: балконный блок')
    expect(html).toContain('Цифровая метка не находится строго внутри сохранённого контура')
    expect(html).toContain('Сопоставление цифровой метки неоднозначно')
    expect(html).not.toContain('Комната 8')
    expect(html).not.toContain('подтверждённое окно')
    expect(html).not.toContain('Подтвердить')
  })
  it.each(['not-saved', 'unavailable', 'refused'] as const)(
    'keeps %s correspondence distinct and shows no partial matches',
    (status) => {
      const packet = manualFrameRoomsPacket()
      packet.savedFrameRooms =
        status === 'not-saved' ? { status } : { status, reason: 'native-frame-review-unavailable' }
      const html = renderToStaticMarkup(
        createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
      )
      expect(html).toContain('Сверка рамок с сохранённой разметкой')
      expect(html).not.toContain('Соответствия рамок и ручных зон')
      expect(html).not.toContain('Две стороны сохранённой разметки')
      expect(html).toContain(
        status === 'not-saved'
          ? 'принадлежность рамок помещениям не проверена'
          : status === 'unavailable'
            ? 'Сопоставление недоступно'
            : 'Сопоставление не прошло перепроверку по исходнику',
      )
      if (status !== 'not-saved') expect(html).toContain('native-frame-review-unavailable')
      expect(html).not.toContain('Подтвердить')
      expect(html).not.toContain('Сохранить')
    },
  )
  it('keeps unresolved frame checks visible instead of counting them as correspondence', () => {
    const packet = manualFrameRoomsPacket()
    if (packet.savedFrameRooms?.status !== 'checked')
      throw new Error('Manual frame fixture is missing')
    packet.savedFrameRooms.frames = [
      { frameId: 'empty-frame', status: 'unresolved', sides: [] },
      {
        frameId: 'ambiguous-frame',
        status: 'ambiguous',
        sides: [
          {
            roomSourceNumbers: [8],
            openingId: 'manual-opening',
            kind: 'door',
            frameEdgeIndex: 1,
            numberCue: 'unavailable',
          },
        ],
      },
    ]
    const html = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
    )
    expect(html).toContain('Две стороны сохранённой разметки</dt><dd>0</dd>')
    expect(html).toContain('Неоднозначное сопоставление</dt><dd>1</dd>')
    expect(html).toContain('Стороны не сопоставлены</dt><dd>1</dd>')
    expect(html).toContain('Соответствий сохранённым сторонам не найдено')
    expect(html).toContain('Цифровая метка для этой сверки недоступна')
  })
  it.each(['draft', 'unresolved'] as const)(
    'shows an empty %s numeric-circle search without drawing a circle',
    (status) => {
      const packet = manualFrameRoomsPacket()
      packet.numberCircles = {
        status,
        refusalReason: status === 'unresolved' ? 'circle-search-budget' : null,
        cues: [],
      }
      const html = renderToStaticMarkup(
        createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
      )
      expect(html).toContain(
        status === 'draft'
          ? 'Цифровые метки в окружностях: 0'
          : 'Цифровые метки в окружностях: поиск не завершён',
      )
      if (status === 'unresolved') {
        expect(html).toContain('Частичный набор меток не показан')
        expect(html).toContain('circle-search-budget')
      }
      expect(html).not.toContain('<circle')
      expect(html).not.toContain('Подтвердить')
      expect(html).not.toContain('Сохранить')
    },
  )
  it('draws only original cubic arcs and leaf edges, without a closing floor or threshold edge', () => {
    const packet = nativeReviewPacket({
      source: { sha256: 'b'.repeat(64), pdfPage: 1, state: 'existing' },
      image: { sha256: 'a'.repeat(64), page: 1, width: 1000, height: 1000 },
    })
    packet.doorSymbols = {
      status: 'draft',
      refusalReason: null,
      candidates: [
        {
          id: 'native-door-symbol-1:0',
          arc: {
            start: { x: 50, y: 100 },
            segments: [
              {
                control1: { x: 50, y: 72.386 },
                control2: { x: 72.386, y: 50 },
                end: { x: 100, y: 50 },
              },
            ],
          },
          leaf: { start: { x: 100, y: 100 }, end: { x: 50, y: 100 } },
          endpointResidualPixels: 0.083,
        },
      ],
    }
    const html = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
    )
    expect(html).toContain('Кандидаты дверных символов: 1')
    expect(html).toContain('Это не число физических проёмов')
    expect(html).toContain('Показать исходные дуги, створки и рамки')
    expect(html).toContain('Точный проём, граница пола и свободный проход этим не подтверждаются')
    expect(html).toContain('Исходная дуга дверного символа')
    expect(html).toContain('Исходная линия створки')
    expect(html).toContain('stroke="#b45309"')
    expect(html).toContain('d="M 50 100 C 50 72.386 72.386 50 100 50"')
    expect(html).toContain('x1="100" y1="100" x2="50" y2="100"')
    expect(html.match(/<path\b/g)).toHaveLength(1)
    expect(html.match(/<line\b/g)).toHaveLength(1)
    expect(html).not.toContain('<polygon')
    expect(html).not.toContain('Подтвердить')
    expect(html).not.toContain('Сохранить')
    expect(packet.readiness).toEqual({ readOnly: true, readyFor2D: false, readyFor3D: false })
  })
  it.each(['draft', 'unresolved'] as const)(
    'does not invent source symbols when the %s search is empty',
    (status) => {
      const packet: NativeReviewPacket = nativeReviewPacket({
        source: { sha256: 'b'.repeat(64), pdfPage: 1, state: 'existing' },
        image: { sha256: 'a'.repeat(64), page: 1, width: 1000, height: 1000 },
      })
      packet.doorSymbols = {
        status,
        refusalReason: status === 'unresolved' ? 'curve-commands-unavailable' : null,
        candidates: [],
      }
      const html = renderToStaticMarkup(
        createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
      )
      expect(html).toContain(
        status === 'unresolved'
          ? 'Кандидаты дверных символов: поиск не завершён'
          : 'Кандидаты дверных символов: 0',
      )
      if (status === 'unresolved') {
        expect(html).toContain('Неполный набор соответствующего поиска не показан')
        expect(html).toContain('curve-commands-unavailable')
      }
      expect(html).not.toContain('Показать исходные дуги, створки и рамки')
      expect(html).not.toContain('<path')
      expect(html).not.toContain('<line')
      expect(html).not.toContain('Подтвердить')
      expect(html).not.toContain('Сохранить')
    },
  )
  it('draws only the supplied source frame polygon, not an inferred threshold or floor', () => {
    const packet = nativeReviewPacket({
      source: { sha256: 'b'.repeat(64), pdfPage: 1, state: 'existing' },
      image: { sha256: 'a'.repeat(64), page: 1, width: 1000, height: 1000 },
    })
    packet.openingFrames = {
      status: 'draft',
      refusalReason: null,
      candidates: [
        {
          id: 'native-opening-frame-1:0',
          polygon: [
            { x: 30, y: 40 },
            { x: 100, y: 40 },
            { x: 100, y: 50 },
            { x: 30, y: 50 },
            { x: 30, y: 40 },
          ],
        },
      ],
    }
    const html = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
    )
    expect(html).toContain('Кандидаты рамок проёмов: 1')
    expect(html).toContain('Вид проёма не определён')
    expect(html).toContain('Исходная рамка с примыкающими линиями')
    expect(html).toContain('points="30,40 100,40 100,50 30,50 30,40"')
    expect(html).toContain('stroke-dasharray="4 3"')
    expect(html).toContain('не добавляет порог или границу пола')
    expect(html.match(/<polygon\b/g)).toHaveLength(1)
    expect(html).not.toContain('<path')
    expect(html).not.toContain('<line')
    expect(html).not.toContain('Подтвердить')
    expect(html).not.toContain('Сохранить')
  })
  it('shows a frame-search refusal while preserving the source-only inspection', () => {
    const packet = nativeReviewPacket({
      source: { sha256: 'b'.repeat(64), pdfPage: 1, state: 'existing' },
      image: { sha256: 'a'.repeat(64), page: 1, width: 1000, height: 1000 },
    })
    packet.openingFrames = {
      status: 'unresolved',
      refusalReason: 'frame-search-budget',
      candidates: [],
    }
    const html = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
    )
    expect(html).toContain('Кандидаты рамок проёмов: поиск не завершён')
    expect(html).toContain('frame-search-budget')
    expect(html).not.toContain('Показать исходные дуги, створки и рамки')
    expect(html).not.toContain('<polygon')
    expect(html).not.toContain('<path')
    expect(html).not.toContain('<line')
  })
  it('draws the three original capped-leaf segments rather than an imaginary long chord', () => {
    const packet = nativeReviewPacket({
      source: { sha256: 'b'.repeat(64), pdfPage: 1, state: 'existing' },
      image: { sha256: 'a'.repeat(64), page: 1, width: 1000, height: 1000 },
    })
    packet.doorSymbols = {
      status: 'draft',
      refusalReason: null,
      candidates: [
        {
          id: 'capped-door',
          arc: {
            start: { x: 50, y: 100 },
            segments: [
              {
                control1: { x: 50, y: 72.386 },
                control2: { x: 72.386, y: 50 },
                end: { x: 100, y: 50 },
              },
            ],
          },
          leaf: { start: { x: 100, y: 100 }, end: { x: 50, y: 100 } },
          leafParts: [
            { start: { x: 100, y: 100 }, end: { x: 100, y: 103 } },
            { start: { x: 50, y: 103 }, end: { x: 100, y: 103 } },
            { start: { x: 50, y: 103 }, end: { x: 50, y: 100 } },
          ],
          leafProfile: 'capped-panel',
          swingAngleDegrees: 85.235,
          endpointResidualPixels: 0.083,
        },
      ],
    }
    const html = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
    )
    expect(html).toContain('Профиль створки с двумя торцами: три исходных отрезка')
    expect(html).toContain('Поворот рисунка: 85.23°')
    expect(html.match(/<line\b/g)).toHaveLength(3)
    expect(html).toContain('x1="100" y1="100" x2="100" y2="103"')
    expect(html).toContain('x1="50" y1="103" x2="100" y2="103"')
    expect(html).toContain('x1="50" y1="103" x2="50" y2="100"')
    expect(html).not.toContain('x1="100" y1="100" x2="50" y2="100"')
    expect(html.match(/d="M [^"]+"/g)).toEqual(['d="M 50 100 C 50 72.386 72.386 50 100 50"'])
    expect(html).not.toContain('<polygon')
    expect(html).not.toContain('<polyline')
    expect(html).not.toContain('Подтвердить')
    expect(html).not.toContain('Сохранить')
  })
  it('keeps glazing in its own source-only blue layer and does not call it confirmed windows', () => {
    const packet = nativeReviewPacket({
      source: { sha256: 'b'.repeat(64), pdfPage: 1, state: 'existing' },
      image: { sha256: 'a'.repeat(64), page: 1, width: 1000, height: 1000 },
    })
    const rectangle = (left: number, top: number, right: number, bottom: number) => [
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom },
    ]
    packet.glazingSymbols = {
      status: 'draft',
      refusalReason: null,
      candidates: [
        {
          id: 'glazing-profile',
          polygons: [
            rectangle(30, 40, 100, 50),
            rectangle(30, 38, 35, 52),
            rectangle(95, 38, 100, 52),
          ],
          centerline: { start: { x: 30, y: 45 }, end: { x: 100, y: 45 } },
        },
      ],
    }
    packet.openingFrames = {
      status: 'draft',
      refusalReason: null,
      candidates: [{ id: 'frame', polygon: rectangle(200, 40, 300, 50) }],
    }
    const html = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
    )
    expect(html).toContain('Кандидаты профилей остекления: 1')
    expect(html).toContain('Это не число окон')
    expect(html).toContain('окну или остеклённой балконной двери')
    expect(html).toContain('Показать исходные профили остекления — синие линии')
    expect(html).toContain('Показать исходные дуги, створки и рамки — оранжевые линии')
    expect(html.match(/type="checkbox"/g)).toHaveLength(3)
    expect(html).toContain('stroke="#1d4ed8"')
    expect(html).toContain('stroke="#b45309"')
    expect(html).toContain('points="30,40 100,40 100,50 30,50"')
    expect(html).toContain('points="30,38 35,38 35,52 30,52"')
    expect(html).toContain('points="95,38 100,38 100,52 95,52"')
    expect(html).toContain('x1="30" y1="45" x2="100" y2="45"')
    expect(html).toContain('Это не добавленный порог и не граница пола')
    expect(html.match(/<polygon\b/g)).toHaveLength(4)
    expect(html.match(/<line\b/g)).toHaveLength(1)
    expect(html).not.toContain('<path')
    expect(html).not.toContain('<polyline')
    expect(html).not.toContain('Подтвердить')
    expect(html).not.toContain('Сохранить')
    expect(packet.readiness).toEqual({ readOnly: true, readyFor2D: false, readyFor3D: false })
  })
  it.each(['draft', 'unresolved'] as const)(
    'does not draw glazing or a toggle for an empty %s search',
    (status) => {
      const packet = nativeReviewPacket({
        source: { sha256: 'b'.repeat(64), pdfPage: 1, state: 'existing' },
        image: { sha256: 'a'.repeat(64), page: 1, width: 1000, height: 1000 },
      })
      packet.glazingSymbols = {
        status,
        refusalReason: status === 'unresolved' ? 'glazing-search-budget' : null,
        candidates: [],
      }
      const html = renderToStaticMarkup(
        createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
      )
      expect(html).toContain(
        status === 'unresolved'
          ? 'Кандидаты профилей остекления: поиск не завершён'
          : 'Кандидаты профилей остекления: 0',
      )
      if (status === 'unresolved') {
        expect(html).toContain('Неполный набор профилей не показан')
        expect(html).toContain('glazing-search-budget')
      }
      expect(html).not.toContain('Показать исходные профили остекления — синие линии')
      expect(html).not.toContain('<polygon')
      expect(html).not.toContain('<line')
      expect(html).not.toContain('<path')
      expect(html).not.toContain('Подтвердить')
      expect(html).not.toContain('Сохранить')
    },
  )
  it('describes source contacts and symbol groups without drawing new connectors or floor', () => {
    const packet = linkedSourcePacket()
    const html = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
    )
    const sourceOnly = structuredClone(packet)
    delete sourceOnly.sourceLinks
    const sourceOnlyHtml = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet: sourceOnly, imageUrl: 'blob:private-test' }),
    )
    expect(html).toContain('Контакты исходных символов')
    expect(html).toContain('Связанные дверные символы</dt><dd>1</dd>')
    expect(html).toContain('Профили с контактами на двух торцах</dt><dd>2</dd>')
    expect(html).toContain('Группы исходных символов</dt><dd>1</dd>')
    expect(html).toContain('Это не число дверей, окон или балконных блоков')
    expect(html).toContain('граница свободного пола и полный перечень окон не подтверждены')
    expect(html).toContain('полный контур косяков')
    expect(html).toContain('Принадлежность стене или комнате')
    expect(html).toContain('Новые соединительные линии, пороги и контуры пола не добавляются')
    expect(html).toContain('общая торцевая линия створки и профиля остекления')
    expect(html).toContain('Группа 1: профилей 2, дверных символов 1')
    expect(html).toContain('glazing-1, glazing-2, door-panel')
    expect(html.match(/<svg\b.*?<\/svg>/s)?.[0]).toEqual(
      sourceOnlyHtml.match(/<svg\b.*?<\/svg>/s)?.[0],
    )
    expect(html.match(/type="checkbox"/g)).toHaveLength(3)
    expect(html).not.toContain('Подтвердить')
    expect(html).not.toContain('Сохранить')
    expect(sourceOnlyHtml).not.toContain('Контакты исходных символов')
  })
  it('derives positive counts from checks and never treats unresolved checks as matches', () => {
    const packet = linkedSourcePacket()
    const links = packet.sourceLinks
    if (!links) throw new Error('Source links fixture is missing')
    Object.assign(links, { counts: { linkedDoors: 999, twoSidedGlazing: 999, groups: 999 } })
    links.doors.push(
      {
        symbolId: 'door-unresolved',
        status: 'unresolved',
        targetKind: null,
        targetId: null,
        relation: null,
      },
      {
        symbolId: 'door-ambiguous',
        status: 'ambiguous',
        targetKind: null,
        targetId: null,
        relation: null,
      },
      {
        symbolId: 'door-frame',
        status: 'linked',
        targetKind: 'opening-frame',
        targetId: 'frame-1',
        relation: 'jamb-to-frame',
      },
    )
    links.glazing.push(
      { symbolId: 'glazing-unresolved', status: 'unresolved' },
      { symbolId: 'glazing-ambiguous', status: 'ambiguous' },
    )
    const html = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
    )
    expect(html).toContain('Связанные дверные символы</dt><dd>2</dd>')
    expect(html).toContain('Профили с контактами на двух торцах</dt><dd>2</dd>')
    expect(html).toContain('Группы исходных символов</dt><dd>1</dd>')
    expect(html).not.toContain('999')
    expect(html).toContain('контакт створки и исходной линии косяка с рамкой')
    expect(html).toContain('несколько возможных контактов, связь не выбрана')
    expect(html).toContain('однозначный контакт не найден')
    expect(html).toContain('контакты неоднозначны, связь не выбрана')
    expect(html).toContain('контакты на двух торцах не найдены')
  })
  it.each(['draft', 'unresolved'] as const)(
    'shows an empty %s contact layer honestly',
    (status) => {
      const packet = linkedSourcePacket()
      packet.sourceLinks = {
        status,
        refusalReason: status === 'unresolved' ? 'source-link-search-budget' : null,
        doors: [],
        glazing: [],
        groups: [],
      }
      const html = renderToStaticMarkup(
        createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
      )
      if (status === 'unresolved') {
        expect(html).toContain('Поиск контактов не завершён; частичный набор не показан')
        expect(html).toContain('source-link-search-budget')
        expect(html).not.toContain('Связанные дверные символы')
        expect(html).not.toContain('Состав найденных контактов')
      } else {
        expect(html).toContain('Связанные дверные символы</dt><dd>0</dd>')
        expect(html).toContain('Профили с контактами на двух торцах</dt><dd>0</dd>')
        expect(html).toContain('Группы исходных символов</dt><dd>0</dd>')
        expect(html).toContain('Нет исходных символов для проверки контактов')
      }
      expect(html).not.toContain('Подтвердить')
      expect(html).not.toContain('Сохранить')
    },
  )
})
