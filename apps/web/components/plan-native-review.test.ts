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

function floorCavityPacket() {
  const packet = documentarySchedulePacket()
  packet.openingFrames = {
    status: 'draft',
    refusalReason: null,
    candidates: Array.from({ length: 7 }, (_, index) => ({
      id: `source-frame-${index}`,
      polygon: [
        { x: 10, y: 10 + index * 20 },
        { x: 100, y: 10 + index * 20 },
        { x: 100, y: 20 + index * 20 },
        { x: 10, y: 20 + index * 20 },
      ],
    })),
  }
  packet.floorCavities = {
    status: 'draft',
    refusalReason: null,
    markersAvailable: true,
    candidates: [[1, 5], [2], [3], [4], [6], [7], []].map((numbers, index) => ({
      id: `source-cell-${index}`,
      polygon: [
        { x: 200 + index * 10, y: 100 },
        { x: 300 + index * 10, y: 100 },
        { x: 300 + index * 10, y: 200 },
      ],
      markerStatus: numbers.length ? 'unambiguous' : 'unmarked',
      markerLabelIds: numbers.map((number) => `native-circle-${number}`),
      closureIds: [],
      unknownInteriorStrokeCount: index === 0 ? 2 : index === 6 ? 1 : 0,
      omittedBoundaryInkCount: index === 0 ? 1 : 0,
    })),
    thresholds: packet.openingFrames.candidates.map(({ id }) => ({
      frameId: id,
      paintAmbiguous: false,
    })),
    closures: Array.from({ length: 5 }, (_, index) => ({
      id: `source-profile-${index}`,
      sourceKind: index === 0 ? 'literal-closed-run' : 'closed-path',
      remainingSegmentCount: index === 0 ? 1 : 0,
      paintAmbiguous: false,
    })),
    unprovedCavities: [
      { reason: 'unsupported-cavity-polygon', vertexCount: 4 },
      { reason: 'unsupported-cavity-polygon', vertexCount: 4 },
      { reason: 'nested-painted-island', vertexCount: 4 },
      { reason: 'unresolved-paint-topology', vertexCount: 8 },
    ],
    unresolvedMarkerLabelIds: ['native-circle-8'],
  }
  return packet
}

function floorOpeningPacket() {
  const packet = floorCavityPacket()
  packet.floorOpeningSides = {
    status: 'draft',
    refusalReason: null,
    frames: Array.from({ length: 7 }, (_, index) => ({
      frameId: `source-frame-${index}`,
      status: index === 6 ? 'one-sided' : 'two-sided',
      reason: index === 6 ? 'unobserved-opposite-cavity' : null,
      sides: [
        {
          frameEdgeIndex: 0,
          status: 'matched',
          contacts: [{ cavityId: 'source-cell-0', coverage: 'complete', boundaryEdgeIndices: [0] }],
        },
        {
          frameEdgeIndex: 2,
          status: index === 6 ? 'unobserved' : 'matched',
          contacts:
            index === 6
              ? []
              : [
                  {
                    cavityId: `source-cell-${index + 1}`,
                    coverage: 'complete',
                    boundaryEdgeIndices: [1],
                  },
                ],
        },
      ],
      doorSymbolIds: index === 6 ? ['door-panel'] : [],
      omittedInkCount: index === 6 ? 2 : 0,
    })),
  }
  return packet
}

function nativeDimensionPacket() {
  const packet = floorCavityPacket()
  packet.dimensionDiscovery = {
    status: 'draft',
    refusalReason: null,
    candidates: Array.from({ length: 72 }, (_, index) => ({
      labelId: `dimension-${index}`,
      valueMm: 900 + index,
      axis: index < 41 ? 'width' : 'depth',
    })),
    unresolved: Array.from({ length: 36 }, (_, index) => ({
      labelId: `held-dimension-${index}`,
      reason: 'no-whole-wall-target',
    })),
  }
  packet.heightObservations = {
    status: 'draft',
    refusalReason: null,
    observations: Array.from({ length: 16 }, (_, index) => ({
      labelId: `height-${index}`,
      originalText:
        index < 4
          ? `Чистый потолок ${2700 + index * 100} мм`
          : index === 4
            ? 'Высота проёма 2100 мм от чистого пола'
            : 'h1 = 2800 мм',
      valueMm: index < 4 ? 2700 + index * 100 : index === 4 ? 2100 : 2800,
      quantityKind:
        index < 4 ? 'finished-ceiling' : index === 4 ? 'opening-height' : 'unclassified-height',
      datum: index === 4 ? 'finished-floor' : 'unspecified',
      issueCodes:
        index < 5
          ? index === 4
            ? []
            : ['height-datum-unverified']
          : ['height-role-unclassified', 'height-datum-unverified'],
      mayAcceptFor3D: false,
    })),
    issues: [
      {
        labelId: 'height-no-unit',
        originalText: 'h2 = 2800',
        code: 'no-literal-unit-qualified-height',
      },
    ],
    omissionCounts: { skippedCurves: 45, clippedPaths: 0 },
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
  it('keeps the floor layer off by default and preserves all source SVG glyphs while reporting logical candidates', () => {
    const packet = floorCavityPacket()
    const html = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
    )
    const withoutFloor = structuredClone(packet)
    delete withoutFloor.floorCavities
    const baseline = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet: withoutFloor, imageUrl: 'blob:private-test' }),
    )
    expect(html).toContain('Кандидаты границ пола и порогов')
    expect(html).toContain('Кандидаты с цифровыми метками</dt><dd>6</dd>')
    expect(html).toContain('Неразмеченные области</dt><dd>1</dd>')
    expect(html).toContain('Логические полосы по рамкам</dt><dd>7</dd>')
    expect(html).toContain('Профильные замыкания</dt><dd>5</dd>')
    expect(html).toContain('Неподтверждённые области в отчёте</dt><dd>4</dd>')
    expect(html).toContain('Неизвестные линии внутри, по кандидатам</dt><dd>3</dd>')
    expect(html).toContain('Пропуски на границах, по кандидатам</dt><dd>1</dd>')
    expect(html).toContain('логические разделители, не физические стены или проверенные пороги')
    expect(html).toContain('не подтверждает точный пол')
    expect(html).toContain('свободный проход или готовность 2D/3D')
    expect(html).toContain('Показать кандидаты с метками — зелёные контуры')
    expect(html).toContain('<input type="checkbox"/>Показать кандидаты с метками')
    expect(html).toContain('source-cell-0</span>: метки 1 + 5')
    expect(html).toContain('Метки без найденного кандидата: 8. Ближайшая область не назначается')
    expect(html).toContain('Вершин: 4; областей: 2')
    expect(html).toContain('nested-painted-island')
    expect(html).toContain('unresolved-paint-topology')
    expect(html).toContain('не удалены и не названы шахтами')
    expect(html.match(/<svg\b.*?<\/svg>/s)?.[0]).toEqual(baseline.match(/<svg\b.*?<\/svg>/s)?.[0])
    expect(html).not.toContain('stroke="#15803d"')
    expect(html).not.toContain('stroke="#7e22ce"')
    expect(html).not.toContain('Подтвердить')
    expect(html).not.toContain('Сохранить')
    expect(packet.readiness).toEqual({ readOnly: true, readyFor2D: false, readyFor3D: false })
    expect(html).not.toContain('Связи меток по исходным выноскам')
    expect(html).not.toContain('Соседние области у рамок')
    expect(html).not.toContain('Размеры и высоты перед переносом')
  })
  it('reports separate native dimensions and literal heights without calibration, room ownership or transfer actions', () => {
    const packet = nativeDimensionPacket()
    const before = structuredClone(packet)
    const html = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
    )
    const sourceOnly = structuredClone(packet)
    delete sourceOnly.dimensionDiscovery
    delete sourceOnly.heightObservations
    const baseline = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet: sourceOnly, imageUrl: 'blob:private-test' }),
    )
    expect(html).toContain('Размеры и высоты перед переносом')
    expect(html).toContain('Размерные кандидаты: 72; X: 41, Y: 31. Удержанные подписи: 36')
    expect(html).toContain(
      'Подписи высот: 16; чистый потолок: 4, проёмы: 1, балки: 0, уровни порогов: 0, вид не определён: 11',
    )
    expect(html).toContain('Для масштаба нужны независимые размерные опоры по X и Y')
    expect(html).toContain('исходные свидетельства целой стены или косяка')
    expect(html).toContain('h1/h2 остаются неизвестными обозначениями')
    expect(html).toContain('Чистый потолок — не конструктивная высота стены или плиты')
    expect(html).toContain('буквальный уровень отсчёта не определяет комнату')
    expect(html).toContain('Разные подписи потолка не усредняются')
    expect(html).toContain('Эти наблюдения нельзя принять как высоты 3D')
    expect(html).toContain('height-4: «Высота проёма 2100 мм от чистого пола» — 2100 мм')
    expect(html).toContain('буквально указан чистый пол')
    expect(html).toContain('height-role-unclassified')
    expect(html).toContain('no-literal-unit-qualified-height')
    expect(html).toContain('Пропуски исходного слоя: кривых 45, отсечённых путей 0')
    expect(html.match(/<svg\b.*?<\/svg>/s)?.[0]).toEqual(baseline.match(/<svg\b.*?<\/svg>/s)?.[0])
    expect(html.match(/<button\b/g)?.length).toEqual(baseline.match(/<button\b/g)?.length)
    expect(html).not.toContain('Подтвердить')
    expect(html).not.toContain('Сохранить')
    expect(html).not.toContain('Копировать')
    expect(html).not.toContain('270 см')
    expect(packet).toEqual(before)
    expect(packet.readiness).toEqual({ readOnly: true, readyFor2D: false, readyFor3D: false })
  })
  it.each([-120, 0, 35])(
    'shows a signed %s mm threshold level without assigning an opening bottom',
    (valueMm) => {
      const packet = nativeDimensionPacket()
      const heights = packet.heightObservations
      if (!heights) throw new Error('Height fixture is missing')
      heights.observations.push({
        labelId: 'threshold-level',
        originalText: `Отметка верха порога ${valueMm} мм от чистого пола`,
        valueMm,
        quantityKind: 'threshold-level',
        datum: 'finished-floor',
        issueCodes: [],
        mayAcceptFor3D: false,
      })
      const before = structuredClone(packet)
      const html = renderToStaticMarkup(
        createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
      )
      expect(html).toContain('уровни порогов: 1')
      expect(html).toContain(`«Отметка верха порога ${valueMm} мм от чистого пола» — ${valueMm} мм`)
      expect(html).toContain('уровень порога, буквально указан чистый пол')
      expect(html).toContain('Уровень порога может быть нулевым или отрицательным')
      expect(html).toContain('не подтверждает владельца порога и проверенный уровень отсчёта')
      expect(html).toContain('автоматически нижнюю отметку проёма в 2D/3D')
      expect(html).not.toContain('bottomCm')
      expect(html).not.toContain('Сохранить')
      expect(packet).toEqual(before)
      expect(packet.readiness.readyFor3D).toBe(false)
    },
  )

  it('shows whole-caption cavity locations without calling them height owners or adding geometry actions', () => {
    const packet = nativeDimensionPacket()
    const heights = packet.heightObservations
    if (!heights) throw new Error('Height fixture is missing')
    const baseline = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
    )
    heights.locations = {
      status: 'draft',
      refusalReason: null,
      observations: heights.observations.map(({ labelId }, index) => ({
        labelId,
        status: index < 5 ? 'inside-single-cavity' : 'unresolved',
        cavityIds: index < 5 ? ['source-floor-cavity-10'] : [],
        inkSourceOperation: index === 15 ? null : index + 100,
        reason:
          index < 5 ? null : index === 15 ? 'height-caption-ink-unverified' : 'outside-cavities',
      })),
    }
    const before = structuredClone(packet)
    const html = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
    )
    expect(html).toContain('Положение исходных подписей: внутри одной полости — 5, удержано — 11')
    expect(html).toContain('Это положение всей подписи, не владелец высоты или уровня порога')
    expect(html).toContain('Полость не назначает комнату')
    expect(html).toContain('height-0: вся подпись внутри полости source-floor-cavity-10')
    expect(html).toContain('height-15: положение удержано — height-caption-ink-unverified')
    expect(html).toContain('Это не подтверждение владельца высоты для 3D')
    expect(html.match(/<svg\b.*?<\/svg>/s)?.[0]).toEqual(baseline.match(/<svg\b.*?<\/svg>/s)?.[0])
    expect(html.match(/<button\b/g)?.length).toEqual(baseline.match(/<button\b/g)?.length)
    expect(html).not.toContain('Сохранить')
    expect(html).not.toContain('Высота комнаты')
    expect(packet).toEqual(before)
  })

  it('shows a global height location refusal without reporting positive cavity ownership', () => {
    const packet = nativeDimensionPacket()
    const heights = packet.heightObservations
    if (!heights) throw new Error('Height fixture is missing')
    heights.locations = {
      status: 'unresolved',
      refusalReason: 'height-location-source-held',
      observations: [],
    }
    const html = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
    )
    expect(html).toContain('Положение подписей высот не проверено: height-location-source-held')
    expect(html).not.toContain('Положение исходных подписей: внутри одной полости')
    expect(html).not.toContain('вся подпись внутри полости')
  })

  it('separates legacy role counts from strict held source-run bindings without SVG or actions', () => {
    const packet = nativeDimensionPacket()
    packet.sourceCaptionBindings = {
      status: 'draft',
      refusalReason: null,
      candidates: [],
      unresolved: Array.from({ length: 108 }, (_, index) => ({
        labelId: `native-text-${index}`,
        reason:
          index < 99
            ? 'caption-rail-unresolved'
            : index < 106
              ? 'branched-dimension-span'
              : 'unsupported-source-caption-orientation',
      })),
    }
    const before = structuredClone(packet)
    const sourceOnly = structuredClone(packet)
    delete sourceOnly.sourceCaptionBindings
    const baseline = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet: sourceOnly, imageUrl: 'blob:private-test' }),
    )
    const html = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
    )
    expect(html).toContain('Связь исходной подписи с размерной линией')
    expect(html).toContain('Размерные кандидаты: 72; X: 41, Y: 31')
    expect(html).toContain('Кандидаты буквальной связи: 0; удержанные подписи: 108')
    expect(html).toContain(
      'Эта строгая проверка пока не подтвердила ни одной связи подписи с размерной линией',
    )
    expect(html).toContain('прежний кандидат не используется как её доказательство')
    expect(html).toContain('native-text-0: связь удержана — caption-rail-unresolved')
    expect(html).toContain('native-text-99: связь удержана — branched-dimension-span')
    expect(html).toContain(
      'native-text-107: связь удержана — unsupported-source-caption-orientation',
    )
    expect(html).toContain('Размеры не переносятся в геометрию')
    expect(html.match(/<svg\b.*?<\/svg>/s)?.[0]).toEqual(baseline.match(/<svg\b.*?<\/svg>/s)?.[0])
    expect(html.match(/<button\b/g)?.length).toEqual(baseline.match(/<button\b/g)?.length)
    expect(baseline).not.toContain('Связь исходной подписи с размерной линией')
    expect(html).not.toContain('Копировать')
    expect(html).not.toContain('Сохранить')
    expect(html).not.toContain('Подтвердить')
    expect(packet).toEqual(before)
    expect(packet.readiness).toEqual({ readOnly: true, readyFor2D: false, readyFor3D: false })
  })
  it('shows a strict source caption candidate independently of unavailable legacy discovery', () => {
    const packet = nativeDimensionPacket()
    packet.dimensionDiscovery = {
      status: 'unresolved',
      refusalReason: 'dimension-discovery-work-limit',
      candidates: [],
      unresolved: [],
    }
    packet.sourceCaptionBindings = {
      status: 'draft',
      refusalReason: null,
      candidates: [
        {
          labelId: 'native-text-17',
          compactIndex: 3,
          valueMm: 2400,
          axis: 'width',
          rail: { operationIndex: 512, subpathIndex: 2 },
        },
      ],
      unresolved: [],
    }
    const html = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
    )
    expect(html).toContain('Поиск размерных подписей не завершён')
    expect(html).toContain('Кандидаты буквальной связи: 1; удержанные подписи: 0')
    expect(html).toContain(
      'native-text-17: 2400 мм, ось X; компактная позиция 3; исходная линия 512:2',
    )
    expect(html).toContain('Связь остаётся кандидатом')
    expect(html).toContain('Даже найденная связь не подтверждает целую стену или косяк')
    expect(html).not.toContain('Эта строгая проверка пока не подтвердила ни одной связи')
  })
  it('shows an unavailable source-caption bridge without pretending legacy dimension roles verified the rail', () => {
    const packet = nativeDimensionPacket()
    packet.sourceCaptionBindings = {
      status: 'unresolved',
      refusalReason: 'native-caption-bridge-unavailable',
      candidates: [],
      unresolved: [],
    }
    const html = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
    )
    expect(html).toContain('Размерные кандидаты: 72; X: 41, Y: 31')
    expect(html).toContain('Сверка исходных текстовых фрагментов не завершена')
    expect(html).toContain('native-caption-bridge-unavailable')
    expect(html).not.toContain('Кандидаты буквальной связи: 72')
    expect(html).not.toContain('Исходные подписи, позиции и ссылки на линии')
  })
  it('renders an empty draft bridge without a misleading details control or source-layer edits', () => {
    const packet = floorCavityPacket()
    packet.sourceCaptionBindings = {
      status: 'draft',
      refusalReason: null,
      candidates: [],
      unresolved: [],
    }
    const html = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
    )
    expect(html).toContain('Кандидаты буквальной связи: 0; удержанные подписи: 0')
    expect(html).not.toContain('Размеры и высоты перед переносом')
    expect(html).not.toContain('Исходные подписи, позиции и ссылки на линии')
  })
  it('escapes source-caption IDs and held reasons instead of executing them as markup', () => {
    const packet = floorCavityPacket()
    packet.sourceCaptionBindings = {
      status: 'draft',
      refusalReason: null,
      candidates: [
        {
          labelId: '<caption-label>',
          compactIndex: 5,
          valueMm: 900,
          axis: 'depth',
          rail: { operationIndex: 22, subpathIndex: 1 },
        },
      ],
      unresolved: [{ labelId: '<held-label>', reason: '<script>прими размер</script>' }],
    }
    const html = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
    )
    expect(html).toContain('&lt;caption-label&gt;: 900 мм, ось Y')
    expect(html).toContain(
      '&lt;held-label&gt;: связь удержана — &lt;script&gt;прими размер&lt;/script&gt;',
    )
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('900 см')
  })
  it('labels oblique source text and actual glyph evidence without misreporting it as axis Y', () => {
    const packet = floorCavityPacket()
    packet.sourceCaptionBindings = {
      status: 'draft',
      refusalReason: null,
      candidates: [
        {
          labelId: 'native-text-66',
          compactIndex: 52,
          valueMm: 1317,
          axis: 'aligned',
          rail: { operationIndex: 2232, subpathIndex: 0 },
          angleDegrees: -43.95629639354044,
          textPlacement: 'glyph-ink',
          inkSourceOperation: 190,
        },
        {
          labelId: 'native-text-90',
          compactIndex: 60,
          valueMm: 2000,
          axis: 'width',
          rail: { operationIndex: 2250, subpathIndex: 0 },
          angleDegrees: 180,
          textPlacement: 'baseline',
        },
      ],
      unresolved: [],
    }
    const before = structuredClone(packet)
    const html = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
    )
    expect(html).toContain('native-text-66: 1317 мм, наклонное направление')
    expect(html).toContain('Исходный угол -43.95629639354044°')
    expect(html).toContain('Положение по настоящим глифам PDF; операция текста 190')
    expect(html).toContain('Исходный угол 180°')
    expect(html).toContain('без свидетельства глифов')
    expect(html).not.toContain('1317 мм, ось Y')
    expect(packet).toEqual(before)
  })
  it('shows nominal scale evidence and paired jambs without adding transfer controls or SVG', () => {
    const packet = floorCavityPacket()
    const baseline = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
    )
    packet.scaleEvidence = {
      status: 'draft',
      refusalReason: null,
      dimensionToleranceMm: 2,
      axes: (['width', 'depth'] as const).map((axis) => ({
        axis,
        status: 'conflict',
        referenceLabelId: '<reference>',
        referenceMmPerPoint: 10,
        independentLabelIds: ['<reference>', 'repeat'],
        observations: [
          {
            labelId: '<reference>',
            valueMm: 1000,
            lengthPoints: 100,
            mmPerPoint: 10,
            residualMm: 0,
          },
          {
            labelId: 'repeat',
            valueMm: 994,
            lengthPoints: 100.123456789,
            mmPerPoint: 9.927743,
            residualMm: 7.23456789,
          },
        ],
      })),
      commonScale: { status: 'conflict', referenceLabelId: null, mmPerPoint: null },
      unresolved: [{ labelId: '<held>', reason: '<script>held</script>' }],
    }
    packet.dimensionTargets = {
      status: 'draft',
      refusalReason: null,
      observations: [],
      unresolved: [],
      jambSpans: ['first', 'repeat'].map((labelId) => ({
        labelId,
        frameId: '<frame>',
        valueMm: 1000,
        axis: 'width',
        status: 'detached',
        faceEdgeIndexes: [0, 2],
        jambRefs: [
          [{ operationIndex: 1, subpathIndex: 0, segmentIndex: 1 }],
          [{ operationIndex: 1, subpathIndex: 0, segmentIndex: 3 }],
        ],
      })),
    }
    const before = structuredClone(packet)
    const html = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
    )
    expect(html).toContain('Общий масштаб: конфликт')
    expect(html).toContain('Ось X: конфликт')
    expect(html).toContain('Ось Y: конфликт')
    expect(html).toContain('Парные косяки: 1 рамок; 2 подписей')
    expect(html).toContain('не являются независимыми опорами')
    expect(html).toContain('≈100.123')
    expect(html).toContain('не к точности обмера квартиры')
    expect(html).toContain('&lt;script&gt;held&lt;/script&gt;')
    expect(html).not.toContain('<script>')
    expect(html.match(/<svg\b.*?<\/svg>/s)?.[0]).toEqual(baseline.match(/<svg\b.*?<\/svg>/s)?.[0])
    expect(html.match(/<button\b/g)?.length).toEqual(baseline.match(/<button\b/g)?.length)
    expect(packet).toEqual(before)
  })
  it('shows an atomic scale refusal without invented axis or ratio rows', () => {
    const packet = floorCavityPacket()
    packet.scaleEvidence = {
      status: 'unresolved',
      refusalReason: '<missing-source>',
      dimensionToleranceMm: 2,
      axes: [],
      commonScale: { status: 'insufficient', referenceLabelId: null, mmPerPoint: null },
      unresolved: [],
    }
    const html = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
    )
    expect(html).toContain('Проверка масштаба удержана: &lt;missing-source&gt;')
    expect(html).not.toContain('Опоры X/Y и расхождения')
  })
  it('keeps alternative target faces and literal PDF-point gaps read-only without extra SVG or buttons', () => {
    const packet = floorCavityPacket()
    const sourceOnly = structuredClone(packet)
    packet.dimensionTargets = {
      status: 'draft',
      refusalReason: null,
      observations: [
        {
          labelId: '<source-label>',
          valueMm: 2400,
          axis: 'width',
          status: 'ambiguous',
          reason: 'source-target-face-alternatives',
          targets: [
            {
              kind: 'opening-frame',
              id: '<source-frame>',
              faces: [0, 2].map((edgeIndex) => ({
                edgeIndex,
                status: 'detached',
                reason: '<detached-source-extension>',
                supportRefs: [{ operationIndex: 10, subpathIndex: 0, segmentIndex: edgeIndex }],
                endpointWitnesses: [
                  {
                    status: 'detached',
                    sourceRefs: [{ operationIndex: 11, subpathIndex: 0, segmentIndex: 0 }],
                    gapPoints: edgeIndex === 0 ? 0.00001 : 1.7724100000000016,
                  },
                  {
                    status: 'continuous',
                    sourceRefs: [{ operationIndex: 12, subpathIndex: 0, segmentIndex: 0 }],
                    gapPoints: 0,
                  },
                ],
              })),
            },
          ],
        },
      ],
      unresolved: [{ labelId: 'held-source', reason: 'caption-rail-unresolved' }],
    }
    const before = structuredClone(packet)
    const baseline = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet: sourceOnly, imageUrl: 'blob:private-test' }),
    )
    const html = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
    )
    expect(html).toContain('Размеры, грани и косяки')
    expect(html).toContain(
      'Непрерывные связи: 0; однозначные связи с разрывом: 0; неоднозначные: 1; неподтверждённые: 0',
    )
    expect(html).toContain('Удержанные подписи: 1')
    expect(html).toContain('разрыв 0.00001 pt PDF')
    expect(html).toContain('разрыв ≈1.77241 pt PDF')
    expect(html).toContain('исходные координаты не округляются')
    expect(html).toContain('разрыв 0 pt PDF')
    expect(html).toContain('не в сантиметрах квартиры и не как монтажный допуск')
    expect(html).toContain('Грань 0')
    expect(html).toContain('Грань 2')
    expect(html).toContain('11:0:0')
    expect(html).toContain('&lt;source-label&gt;')
    expect(html).toContain('&lt;source-frame&gt;')
    expect(html).toContain('&lt;detached-source-extension&gt;')
    expect(html).not.toContain('<source-frame>')
    expect(html.match(/<svg\b.*?<\/svg>/s)?.[0]).toEqual(baseline.match(/<svg\b.*?<\/svg>/s)?.[0])
    expect(html.match(/<button\b/g)?.length).toEqual(baseline.match(/<button\b/g)?.length)
    expect(html).not.toContain('Подтвердить')
    expect(html).not.toContain('Сохранить')
    expect(html).not.toContain('Копировать')
    expect(packet).toEqual(before)
  })
  it('shows conflicting whole-floor captions separately without altering face witnesses or geometry', () => {
    const packet = floorCavityPacket()
    const beforeTargets = structuredClone(packet)
    packet.dimensionTargets = {
      status: 'draft',
      refusalReason: null,
      observations: [2000, 2100].map((valueMm, index) => ({
        labelId: `floor-dimension-${index}`,
        valueMm,
        axis: 'width',
        status: 'conflict',
        reason: 'conflicting-whole-floor-dimensions',
        targets: [
          {
            kind: 'floor-boundary',
            id: 'source-cell-0',
            faces: [
              {
                edgeIndex: 0,
                status: 'detached',
                reason: 'detached-source-extension',
                supportRefs: [{ operationIndex: 10, subpathIndex: 0, segmentIndex: 0 }],
                endpointWitnesses: [
                  {
                    status: 'detached',
                    sourceRefs: [{ operationIndex: 11, subpathIndex: 0, segmentIndex: 0 }],
                    gapPoints: 0.00001,
                  },
                  {
                    status: 'continuous',
                    sourceRefs: [{ operationIndex: 12, subpathIndex: 0, segmentIndex: 0 }],
                    gapPoints: 0,
                  },
                ],
              },
            ],
          },
        ],
      })),
      unresolved: [],
    }
    const before = structuredClone(packet)
    const baseline = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet: beforeTargets, imageUrl: 'blob:private-test' }),
    )
    const html = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
    )
    expect(html).toContain('Конфликты размеров: 2')
    expect(html).toContain('floor-dimension-0: 2000 мм; конфликт размеров одной грани пола')
    expect(html).toContain('floor-dimension-1: 2100 мм; конфликт размеров одной грани пола')
    expect(html).toContain('Грань 0: разрыв исходной выносной линии')
    expect(html).toContain('разрыв 0.00001 pt PDF')
    expect(html).toContain('Размеры в геометрию не переносятся')
    expect(html.match(/<svg\b.*?<\/svg>/s)?.[0]).toEqual(baseline.match(/<svg\b.*?<\/svg>/s)?.[0])
    expect(html.match(/<button\b/g)?.length).toEqual(baseline.match(/<button\b/g)?.length)
    expect(packet).toEqual(before)
  })
  it.each(['draft', 'unresolved'] as const)(
    'shows an empty %s target report without invented detail rows',
    (status) => {
      const packet = floorCavityPacket()
      packet.dimensionTargets = {
        status,
        refusalReason: status === 'unresolved' ? 'source-targets-unavailable' : null,
        observations: [],
        unresolved: [],
      }
      const html = renderToStaticMarkup(
        createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
      )
      expect(html).toContain('Размеры, грани и косяки')
      expect(html).not.toContain('Грани, альтернативы и исходные свидетельства')
      if (status === 'draft') expect(html).toContain('Непрерывные связи: 0')
      else
        expect(html).toContain('Проверка граней и косяков не завершена; частичный набор не показан')
    },
  )
  it('retains duplicate literal ceiling values as separate observations instead of merging or copying them to room 1 + 5', () => {
    const packet = nativeDimensionPacket()
    const heights = packet.heightObservations
    const [first, second] = heights?.observations ?? []
    if (!heights || !first || !second) throw new Error('Height fixture is missing')
    first.valueMm = 2700
    second.valueMm = 2700
    first.originalText = 'Чистый потолок 2700 мм'
    second.originalText = 'Чистый потолок 2700 мм'
    const html = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
    )
    expect(html).toContain('height-0: «Чистый потолок 2700 мм» — 2700 мм')
    expect(html).toContain('height-1: «Чистый потолок 2700 мм» — 2700 мм')
    expect(html).toContain('метки 1 + 5')
    expect(html).not.toContain('Высота комнаты 1')
    expect(html).not.toContain('Комната 5: 2700')
    expect(html).toContain('Значения не переносятся автоматически в комнаты или 3D')
  })
  it.each(['dimensions', 'heights', 'both'] as const)(
    'shows %s refusal atomically while retaining any other independent draft inventory',
    (scope) => {
      const packet = nativeDimensionPacket()
      if (scope !== 'heights')
        packet.dimensionDiscovery = {
          status: 'unresolved',
          refusalReason: 'dimension-discovery-held',
          candidates: [],
          unresolved: [],
        }
      if (scope !== 'dimensions')
        packet.heightObservations = {
          status: 'unresolved',
          refusalReason: 'height-source-held',
          observations: [],
          issues: [],
          omissionCounts: { skippedCurves: 45, clippedPaths: 0 },
        }
      const html = renderToStaticMarkup(
        createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
      )
      if (scope !== 'heights') {
        expect(html).toContain('Поиск размерных подписей не завершён')
        expect(html).toContain('dimension-discovery-held')
        expect(html).not.toContain('dimension-0:')
      }
      if (scope !== 'dimensions') {
        expect(html).toContain('Поиск подписей высот не завершён')
        expect(html).toContain('height-source-held')
        expect(html).not.toContain('height-0:')
      }
      if (scope === 'dimensions') expect(html).toContain('Подписи высот: 16')
      if (scope === 'heights') expect(html).toContain('Размерные кандидаты: 72')
      if (scope === 'both') expect(html).not.toContain('Исходные подписи, миллиметры и ограничения')
      expect(html).not.toContain('Сохранить')
    },
  )
  it('escapes original height text and labels instead of interpreting source content as instructions or markup', () => {
    const packet = nativeDimensionPacket()
    const observation = packet.heightObservations?.observations[0]
    const dimension = packet.dimensionDiscovery?.candidates[0]
    if (!observation || !dimension) throw new Error('Native dimension fixture is missing')
    observation.originalText = '<script>перенеси 2700 мм в комнату</script>'
    observation.labelId = '<height-label>'
    observation.datum = 'existing-floor'
    dimension.labelId = '<dimension-label>'
    const html = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
    )
    expect(html).toContain('&lt;script&gt;перенеси 2700 мм в комнату&lt;/script&gt;')
    expect(html).toContain('&lt;height-label&gt;')
    expect(html).toContain('&lt;dimension-label&gt;')
    expect(html).toContain('буквально указан существующий пол')
    expect(html).not.toContain('<script>')
    expect(observation.mayAcceptFor3D).toBe(false)
  })
  it('reports six different cavity pairs and one unknown-sided frame without changing source SVG or actions', () => {
    const packet = floorOpeningPacket()
    const html = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
    )
    const sourceOnly = structuredClone(packet)
    delete sourceOnly.floorOpeningSides
    const baseline = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet: sourceOnly, imageUrl: 'blob:private-test' }),
    )
    expect(html).toContain('Соседние области у рамок')
    expect(html).toContain('Рамки между двумя разными областями</dt><dd>6</dd>')
    expect(html).toContain('Рамки с одной наблюдаемой областью</dt><dd>1</dd>')
    expect(html).toContain('Метки 1 + 5 — source-cell-0')
    expect(html).toContain(
      'Неразмеченная математическая область; назначение неизвестно — source-cell-6',
    )
    expect(html).toContain('Область не наблюдалась; сторона неизвестна')
    expect(html).toContain('не считается внешней стороной квартиры или входом')
    expect(html).toContain('Сохранённая ручная разметка не меняется')
    expect(html).toContain(
      'физический порог, ширина, высоты, свободный проход и готовность 2D/3D не подтверждены',
    )
    expect(html).toContain('Дверные символы — отдельные наблюдения, не определение вида всех рамок')
    expect(html).toContain('Совместно наблюдаемые дверные символы: door-panel')
    expect(html).toContain('не доказательство физической двери или прохода')
    expect(html.match(/Ограничения извлечения у рамки:/g)).toHaveLength(1)
    expect(html).toContain('Ограничения извлечения у рамки: 2')
    expect(html.match(/<svg\b.*?<\/svg>/s)?.[0]).toEqual(baseline.match(/<svg\b.*?<\/svg>/s)?.[0])
    expect(html.match(/type="checkbox"/g)?.length).toEqual(
      baseline.match(/type="checkbox"/g)?.length,
    )
    expect(html.match(/<button\b/g)?.length).toEqual(baseline.match(/<button\b/g)?.length)
    expect(html).not.toContain('Подтвердить')
    expect(html).not.toContain('Сохранить')
    expect(packet.readiness).toEqual({ readOnly: true, readyFor2D: false, readyFor3D: false })
  })
  it('does not count the same cavity on both sides as a new adjacency pair', () => {
    const packet = floorOpeningPacket()
    const frame = packet.floorOpeningSides?.frames[0]
    const contact = frame?.sides[1]?.contacts[0]
    if (!frame || !contact) throw new Error('Frame sides fixture is missing')
    contact.cavityId = 'source-cell-0'
    frame.status = 'same-cavity'
    const html = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
    )
    expect(html).toContain('Рамки между двумя разными областями</dt><dd>5</dd>')
    expect(html).toContain('Одна и та же область у обеих сторон — не новая связь')
    expect(html).toContain('Невыбранные соседства: 1')
  })
  it('retains partial, ambiguous, unproved and held neighboring evidence with their actual reasons', () => {
    const packet = floorOpeningPacket()
    const frames = packet.floorOpeningSides?.frames
    const [partial, ambiguous, unproved, held] = frames ?? []
    const partialSide = partial?.sides[0]
    const partialContact = partialSide?.contacts[0]
    const ambiguousSide = ambiguous?.sides[0]
    const unprovedSide = unproved?.sides[0]
    const unprovedContact = unprovedSide?.contacts[0]
    if (
      !partial ||
      !ambiguous ||
      !unproved ||
      !held ||
      !partialSide ||
      !partialContact ||
      !ambiguousSide ||
      !unprovedSide ||
      !unprovedContact
    )
      throw new Error('Frame sides fixture is missing')
    partial.status = 'unresolved'
    partial.reason = 'incomplete-cavity-contacts'
    partialSide.status = 'partial'
    partialContact.coverage = 'partial'
    ambiguous.status = 'ambiguous'
    ambiguous.reason = 'competing-cavity-contacts'
    ambiguousSide.status = 'ambiguous'
    ambiguousSide.contacts.push({
      cavityId: 'source-cell-1',
      coverage: 'complete',
      boundaryEdgeIndices: [0],
    })
    unproved.status = 'unresolved'
    unproved.reason = 'incomplete-cavity-contacts'
    unprovedSide.status = 'unresolved'
    unprovedContact.coverage = 'unproved'
    held.status = 'unresolved'
    held.reason = 'unproved-neighbor-region'
    held.sides = []
    const html = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
    )
    expect(html).toContain('Невыбранные соседства: 4')
    expect(html).toContain('Частичный контакт')
    expect(html).toContain('не весь участок сопоставлен')
    expect(html).toContain('Несколько конкурирующих контактов')
    expect(html).toContain('На одной стороне есть несколько кандидатов')
    expect(html).toContain('Исходное основание контакта не доказано')
    expect(html).toContain('линейная связь не доказана')
    expect(html).toContain('Соседняя область удержана как неподтверждённая')
    expect(html).toContain('unproved-neighbor-region')
    expect(html).toContain('неизвестная область не назначается ближайшей комнате')
  })
  it('keeps a leader-linked marker 8 separate from containment and preserves joint cues 1 + 5', () => {
    const packet = floorOpeningPacket()
    const floor = packet.floorCavities
    const cell = floor?.candidates[6]
    if (!floor || !cell) throw new Error('Floor fixture is missing')
    cell.markerLabelIds = ['native-circle-8']
    cell.markerStatus = 'unambiguous'
    floor.unresolvedMarkerLabelIds = []
    floor.markerLeaders = [
      {
        labelId: 'native-circle-8',
        cavityId: cell.id,
        circleEndpoint: 'start',
        segment: {
          operationIndex: 17,
          subpathIndex: 0,
          segmentIndex: 0,
          start: { x: 99, y: 75 },
          end: { x: 145, y: 100 },
        },
      },
    ]
    const html = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
    )
    expect(html).toContain('Метки 8 (есть исходная выноска) — source-cell-6')
    expect(html).toContain('Метки 1 + 5 — source-cell-0')
    expect(html).toContain('Выноска — не граница пола и не проход')
    expect(html).not.toContain('Подтвердить')
  })
  it('escapes a neighboring cavity ID and leaves unavailable numeric evidence unknown', () => {
    const packet = floorOpeningPacket()
    const cell = packet.floorCavities?.candidates[1]
    const contact = packet.floorOpeningSides?.frames[0]?.sides[1]?.contacts[0]
    if (!cell || !contact) throw new Error('Floor fixture is missing')
    const id = '<script>alert("neighbor")</script>'
    cell.id = id
    cell.markerLabelIds = []
    cell.markerStatus = 'unavailable'
    contact.cavityId = id
    const html = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
    )
    expect(html).toContain(
      'Математическая область без доступной сверки меток; назначение неизвестно',
    )
    expect(html).toContain('&lt;script&gt;alert(&quot;neighbor&quot;)&lt;/script&gt;')
    expect(html).not.toContain('<script>')
  })
  it.each(['draft', 'unresolved'] as const)(
    'shows an empty %s neighboring report without empty-success authority',
    (status) => {
      const packet = floorOpeningPacket()
      packet.floorOpeningSides = {
        status,
        refusalReason: status === 'unresolved' ? 'floor-frame-side-work-limit' : null,
        frames: [],
      }
      const html = renderToStaticMarkup(
        createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
      )
      if (status === 'draft') {
        expect(html).toContain(
          'Нет исходных рамок для сверки сторон; полнота проёмов этим не доказана',
        )
        expect(html).toContain('Рамки между двумя разными областями</dt><dd>0</dd>')
      } else {
        expect(html).toContain('Сверка сторон не завершена; частичный набор не показан')
        expect(html).toContain('floor-frame-side-work-limit')
        expect(html).not.toContain('Рамки между двумя разными областями</dt>')
      }
      expect(html).not.toContain('Стороны рамок и ограничения соседств')
      expect(html).not.toContain('Подтвердить')
      expect(html).not.toContain('Сохранить')
    },
  )
  it('distinguishes an empty leader inventory from legacy missing metadata without inventing a line', () => {
    const packet = floorCavityPacket()
    if (!packet.floorCavities) throw new Error('Floor fixture is missing')
    packet.floorCavities.markerLeaders = []
    const html = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
    )
    expect(html).toContain('Связи меток по исходным выноскам: 0')
    expect(html).toContain('метки 1 + 5 внутри математической области')
    expect(html).toContain('Выноска — не граница пола и не проход')
    expect(html).not.toContain('по исходной выноске (')
    expect(html).not.toContain('Подтвердить')
    expect(html).not.toContain('Сохранить')
  })
  it.each(['start', 'end'] as const)(
    'reports one actual outboard leader at the circle %s endpoint without drawing or accepting a floor',
    (circleEndpoint) => {
      const packet = floorCavityPacket()
      const floor = packet.floorCavities
      const cell = floor?.candidates[6]
      if (!floor || !cell) throw new Error('Floor fixture is missing')
      cell.markerLabelIds = ['native-circle-8']
      cell.markerStatus = 'unambiguous'
      floor.unresolvedMarkerLabelIds = []
      floor.markerLeaders = [
        {
          labelId: 'native-circle-8',
          cavityId: cell.id,
          circleEndpoint,
          segment: {
            operationIndex: 171,
            subpathIndex: 3,
            segmentIndex: 2,
            start: { x: 99.75, y: 75 },
            end: { x: 145.5, y: 100 },
          },
        },
      ]
      const html = renderToStaticMarkup(
        createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
      )
      const withoutLeader = structuredClone(packet)
      delete withoutLeader.floorCavities?.markerLeaders
      const baseline = renderToStaticMarkup(
        createElement(NativeReviewResult, { packet: withoutLeader, imageUrl: 'blob:private-test' }),
      )
      expect(html).toContain('Связи меток по исходным выноскам: 1')
      expect(html).toContain('Метка 8 по исходной выноске (native-circle-8)')
      expect(html).toContain('source-cell-6</span>: внутренних цифровых меток не наблюдалось')
      expect(html).toContain('метки 1 + 5 внутри математической области')
      expect(html).toContain('операция 171, подпуть 3, сегмент 2')
      expect(html).toContain('Координаты изображения: (99.75, 75) → (145.5, 100)')
      expect(html).toContain(
        `окружность у ${circleEndpoint === 'start' ? 'начала' : 'конца'} отрезка`,
      )
      expect(html).toContain('Кандидаты с цифровыми метками</dt><dd>7</dd>')
      expect(html).not.toContain('Метки без найденного кандидата: 8')
      expect(html.match(/<svg\b.*?<\/svg>/s)?.[0]).toEqual(baseline.match(/<svg\b.*?<\/svg>/s)?.[0])
      expect(html).not.toContain('x1="99.75"')
      expect(html).not.toContain('stroke="#15803d"')
      expect(html).not.toContain('Подтвердить')
      expect(html).not.toContain('Сохранить')
      expect(packet.readiness).toEqual({ readOnly: true, readyFor2D: false, readyFor3D: false })
    },
  )
  it('escapes a source leader label without turning metadata into HTML or accepting numeric ownership', () => {
    const packet = floorCavityPacket()
    const floor = packet.floorCavities
    const cell = floor?.candidates[6]
    const cue = packet.numberCircles?.cues.find(({ sourceNumber }) => sourceNumber === 8)
    if (!floor || !cell || !cue) throw new Error('Floor fixture is missing')
    const labelId = '<script>alert("test")</script>'
    cue.labelId = labelId
    cell.markerLabelIds = [labelId]
    cell.markerStatus = 'unambiguous'
    floor.unresolvedMarkerLabelIds = []
    floor.markerLeaders = [
      {
        labelId,
        cavityId: cell.id,
        circleEndpoint: 'start',
        segment: {
          operationIndex: 17,
          subpathIndex: 0,
          segmentIndex: 0,
          start: { x: 99, y: 75 },
          end: { x: 145, y: 100 },
        },
      },
    ]
    const html = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
    )
    expect(html).toContain(
      'Метка 8 по исходной выноске (&lt;script&gt;alert(&quot;test&quot;)&lt;/script&gt;)',
    )
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('Подтвердить')
    expect(html).not.toContain('Сохранить')
    expect(html).toContain('не подтверждает точный пол')
  })
  it('keeps competing cavities and paint ambiguity visible without selecting a room or material wall', () => {
    const packet = floorCavityPacket()
    const floor = packet.floorCavities
    const cell = floor?.candidates[0]
    const closure = floor?.closures[0]
    const threshold = floor?.thresholds[0]
    if (!floor || !cell || !closure || !threshold) throw new Error('Floor fixture is missing')
    cell.markerStatus = 'ambiguous'
    floor.candidates.push({ ...structuredClone(cell), id: 'source-competing-cell' })
    closure.paintAmbiguous = true
    threshold.paintAmbiguous = true
    const html = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
    )
    expect(html).toContain('Есть конкурирующие метки или области; принадлежность не выбрана')
    expect(html).toContain('Заливка неоднозначна; замыкание не используется для этих областей')
    expect(html).toContain(
      'неоднозначная заливка логической полосы; в границах областей не используется',
    )
    expect(html).toContain('source-competing-cell')
    expect(html).not.toContain('Подтвердить')
  })
  it('distinguishes missing numeric evidence from unmarked source cells', () => {
    const packet = floorCavityPacket()
    const floor = packet.floorCavities
    if (!floor) throw new Error('Floor fixture is missing')
    packet.numberCircles = { status: 'unresolved', refusalReason: 'circle-search-budget', cues: [] }
    floor.markersAvailable = false
    floor.unresolvedMarkerLabelIds = []
    for (const cell of floor.candidates) {
      cell.markerStatus = 'unavailable'
      cell.markerLabelIds = []
    }
    const html = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
    )
    expect(html).toContain('Цифровые метки недоступны для сверки; это не отсутствие помещений')
    expect(html).toContain('Неразмеченные области</dt><dd>0</dd>')
    expect(html).toContain('проверка меток недоступна')
    expect(html).not.toContain('stroke="#15803d"')
  })
  it('shows an atomic floor refusal without empty-success counters or a floor-layer control', () => {
    const packet = floorCavityPacket()
    packet.floorCavities = {
      status: 'unresolved',
      refusalReason: 'floor-cavity-work-limit',
      markersAvailable: true,
      candidates: [],
      thresholds: [],
      closures: [],
      unprovedCavities: [],
      unresolvedMarkerLabelIds: [],
    }
    const html = renderToStaticMarkup(
      createElement(NativeReviewResult, { packet, imageUrl: 'blob:private-test' }),
    )
    expect(html).toContain('Поиск не завершён; частичные границы не показаны')
    expect(html).toContain('floor-cavity-work-limit')
    expect(html).not.toContain('Кандидаты с цифровыми метками</dt>')
    expect(html).not.toContain('Показать кандидаты с метками — зелёные контуры')
    expect(html).not.toContain('Подтвердить')
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
