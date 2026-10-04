import type { LayoutProblem, RoomLayout } from '@uyut/catalog'
import { WALKWAY_CM } from '@uyut/catalog'
import {
  escapeHtml as esc,
  formatArea,
  formatDimensionCm,
  formatLongDate,
  formatMonthYear,
  formatPrice,
  formatRubles,
  formatShare,
  pluralItems,
  pluralPositions,
} from './format'
import type { PdfData, PdfImage, PdfRoom, PdfShoppingGroup } from './types'

/**
 * Знак продукта на обложке: та же «Д» с дверью, что в интерфейсе и на значке вкладки.
 * Без подложки и с наследованием цвета — обложка бывает и светлой, и поверх тёмной фотографии.
 */
const MARK_SVG = `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" fill="none"><path d="M 15 10 H 33 L 36 31 H 39 V 36 H 35 V 41 H 30 V 36 H 18 V 41 H 13 V 36 H 9 V 31 H 12 Z" fill="currentColor"/><path d="M 21 36 V 27.5 a 3 3 0 0 1 6 0 V 36 Z" fill="#7c2f3b"/></svg>`

const WATERMARK_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='460' height='320' viewBox='0 0 460 320'><text x='40' y='190' transform='rotate(-22 230 160)' font-family='Georgia, serif' font-size='44' fill='%237c2f3b' fill-opacity='0.11'>Домица · предпросмотр</text></svg>`

// Те же токены, что в продукте: бумага, чернила, бургунди
const CSS = `
  @page { size: A4; margin: 16mm 16mm 20mm; }
  @page :first { margin: 0; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    margin: 0;
    background: #fbf8f1;
    color: #262220;
    font-family: 'Onest', system-ui, sans-serif;
    font-size: 10.5pt;
    line-height: 1.45;
  }
  h1, h2, h3, .serif { font-family: 'Literata', Georgia, serif; font-weight: 500; letter-spacing: -0.015em; margin: 0; text-wrap: balance; }
  h1 { font-size: 30pt; line-height: 1.02; font-variation-settings: 'opsz' 72; }
  h2 { font-size: 16pt; line-height: 1.15; }
  h3 { font-size: 12.5pt; line-height: 1.2; }
  p { margin: 0; }
  .mono { font-family: 'JetBrains Mono', ui-monospace, monospace; font-variant-numeric: tabular-nums; }
  .eyebrow { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 7.5pt; letter-spacing: 0.14em; text-transform: uppercase; color: #6d6656; }
  .small { font-size: 8.5pt; line-height: 1.45; color: #6d6656; }
  .rule { height: 1px; background: #ddd4c1; }
  .rule.strong { background: #262220; }
  .nowrap { white-space: nowrap; }
  img { display: block; width: 100%; height: 100%; object-fit: cover; }

  .page { break-after: page; }
  .fixed { height: 261mm; overflow: hidden; display: grid; grid-auto-rows: max-content; align-content: start; gap: 6mm; }

  /* обложка */
  .cover { position: relative; height: 297mm; overflow: hidden; background: #262220; color: #f6efe4; }
  .cover .photo { position: absolute; inset: 0; }
  .cover .shade { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(20,14,12,0.12) 0%, rgba(20,14,12,0) 35%, rgba(20,14,12,0.74) 100%); }
  .cover .mark { position: absolute; left: 16mm; top: 14mm; display: flex; align-items: center; gap: 2.5mm; font-family: 'Literata', Georgia, serif; font-size: 18pt; }
  .cover .mark svg { width: 7mm; height: 7mm; }
  .cover .text { position: absolute; left: 16mm; right: 16mm; bottom: 18mm; display: grid; gap: 5mm; }
  .cover .eyebrow { color: rgba(246,239,228,0.78); }
  .cover h1 { font-size: 46pt; color: #f6efe4; }
  .cover .line { width: 38mm; height: 1px; background: rgba(246,239,228,0.45); }
  .cover .sub { font-size: 11pt; line-height: 1.45; max-width: 120mm; color: rgba(246,239,228,0.92); }
  .cover .contact { font-size: 9pt; color: rgba(246,239,228,0.8); }

  /* о проекте */
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 10mm; }
  .cols.asym { grid-template-columns: 1.35fr 1fr; }
  .cols.wide-left { grid-template-columns: 1.15fr 1fr; }
  .bigfig { font-family: 'Literata', Georgia, serif; font-size: 30pt; line-height: 1; letter-spacing: -0.02em; }
  .facts { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm 8mm; }
  .facts .k { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 7pt; letter-spacing: 0.12em; text-transform: uppercase; color: #6d6656; }
  .facts .v { margin-top: 1mm; font-size: 10pt; }
  .contents { display: grid; gap: 2mm; font-size: 10pt; }
  .band { height: 92mm; overflow: hidden; }

  /* комната */
  .render { height: 100mm; overflow: hidden; background: #efe9dc; }
  .idea { display: grid; gap: 3mm; align-content: start; }
  .was { display: grid; grid-template-columns: 42mm 1fr; gap: 4mm; align-items: start; }
  .was .img { height: 31mm; overflow: hidden; filter: saturate(0.85); }
  .objects { display: grid; gap: 2.2mm; font-size: 9.5pt; }
  .objects .row { display: grid; grid-template-columns: 6mm 1fr auto; gap: 3mm; align-items: baseline; padding-bottom: 1.8mm; border-bottom: 1px solid #ddd4c1; }
  .objects .idx { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 7.5pt; color: #7c2f3b; }
  .objects .sub { display: block; font-size: 8pt; color: #6d6656; }
  .plan { margin-top: 2mm; }
  /* Высота ограничена страницей: у комнаты 220 на 600 см чертёж в натуральных пропорциях
     выезжал за поле и обрезался вместе со строкой «проход 65 см», которую и надо было прочесть */
  .plan svg { display: block; width: 100%; height: auto; max-height: 52mm; }
  .plan .verdict { font-size: 8pt; line-height: 1.45; color: #6d6656; margin-top: 1.5mm; }
  .plan .status { font-size: 9.5pt; }
  .plan .bad { color: #7c2f3b; }
  .plan-page .plan svg { max-height: 120mm; }
  .thumbs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3mm; }
  .thumbs .img { height: 27mm; overflow: hidden; }
  .thumbs .cap { font-size: 7.5pt; color: #6d6656; margin-top: 1.5mm; }

  /* покупки */
  .shop { display: grid; gap: 0; }
  .shop .item { display: grid; grid-template-columns: 17mm 1fr auto auto; gap: 5mm; align-items: center; padding: 3mm 0; border-bottom: 1px solid #ddd4c1; break-inside: avoid; }
  .shop .item:first-child { border-top: 1px solid #262220; }
  .shop .img { width: 17mm; height: 17mm; overflow: hidden; background: #efe9dc; border: 1px solid #ddd4c1; }
  .shop .title { font-size: 10pt; }
  .shop .title span { display: block; font-size: 8pt; color: #6d6656; margin-top: 0.5mm; }
  .shop .qty { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 8.5pt; color: #6d6656; }
  .shop .price { font-family: 'JetBrains Mono', ui-monospace, monospace; font-variant-numeric: tabular-nums; min-width: 26mm; text-align: right; font-size: 10pt; }
  .shop .total { display: flex; justify-content: space-between; align-items: baseline; padding-top: 4mm; break-inside: avoid; }
  .shop .total .price { font-family: 'Literata', Georgia, serif; font-size: 18pt; letter-spacing: -0.01em; }
  .group { margin-top: 6mm; display: grid; gap: 3mm; }
  .ads { margin-top: 4mm; display: grid; gap: 1mm; }
  .ads .small { font-size: 7pt; line-height: 1.35; color: #8b8474; word-break: break-word; }

  /* смета */
  .estimate { display: grid; gap: 1.5mm; }
  .estimate .line { display: grid; grid-template-columns: 1fr auto auto; gap: 6mm; align-items: baseline; padding: 2.2mm 0; border-bottom: 1px solid #ddd4c1; }
  .estimate .formula { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 8pt; color: #6d6656; }
  .estimate .price { font-family: 'JetBrains Mono', ui-monospace, monospace; font-variant-numeric: tabular-nums; text-align: right; min-width: 30mm; }
  .estimate .sum { display: flex; justify-content: space-between; align-items: baseline; padding-top: 3mm; border-top: 1px solid #262220; }
  .estimate .sum .price { font-family: 'Literata', Georgia, serif; font-size: 24pt; letter-spacing: -0.015em; }
  .bar { display: flex; height: 3.5mm; gap: 0.6mm; }
  .bar span { display: block; height: 100%; }
  .legend { display: flex; gap: 7mm; font-size: 8.5pt; color: #6d6656; flex-wrap: wrap; }
  .legend i { display: inline-block; width: 3mm; height: 3mm; margin-right: 1.5mm; vertical-align: -0.3mm; }

  /* ТЗ */
  .brief-intro { max-width: 150mm; }
  /* Оговорка стоит перед самим заданием и набрана в размер текста: раньше она была мелкой
     строкой внизу последней страницы, и владелец её попросту не увидел. */
  .brief-warning { max-width: 150mm; margin-top: 5mm; border-left: 2px solid #7c2f3b; padding: 1mm 0 1mm 4mm; display: grid; gap: 2mm; }
  .brief-warning p { font-size: 9.5pt; line-height: 1.5; color: #262220; }
  .brief-warning-title { font-family: 'Literata', Georgia, serif; font-size: 11pt; color: #7c2f3b; }
  .brief-room { break-before: page; display: grid; gap: 5mm; }
  .brief-room:first-of-type { break-before: auto; }
  .brief-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm 10mm; font-size: 9.5pt; line-height: 1.5; }
  .brief-grid section { break-inside: avoid; }
  .brief-grid h3 { margin-bottom: 2mm; }
  .brief-grid ol { margin: 0; padding-left: 5.5mm; display: grid; gap: 1.5mm; }
  .brief-grid li::marker { font-family: 'JetBrains Mono', ui-monospace, monospace; color: #7c2f3b; font-size: 8pt; }
  .qlist { display: grid; gap: 2.5mm; padding-left: 5.5mm; margin: 0; font-size: 10pt; }
  .qlist li::marker { font-family: 'JetBrains Mono', ui-monospace, monospace; color: #7c2f3b; font-size: 8pt; }

  /* водяной знак бесплатной версии: фиксированный слой Chromium повторяет на каждой странице печати,
     лента — обычный блок в начале каждого раздела, потому что fixed с отступом в печати ведёт себя непредсказуемо */
  .wm-layer { position: fixed; inset: 0; z-index: 5; pointer-events: none; background-image: url("data:image/svg+xml;utf8,${WATERMARK_SVG}"); background-size: 92mm 64mm; }
  .ribbon { padding: 2.2mm 4mm; margin-bottom: 4mm; background: #7c2f3b; color: #fbf8f1; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 7pt; letter-spacing: 0.1em; text-transform: uppercase; }
  .cover .ribbon { position: absolute; top: 0; left: 0; right: 0; z-index: 3; margin: 0; padding-left: 16mm; }
  .fixed .ribbon { margin-bottom: 0; }
  .free .fixed { height: 254mm; }
`

function img(image: PdfImage | null, className = ''): string {
  if (!image) {
    return `<div class="${className}" style="background:#efe9dc"></div>`
  }
  return `<div class="${className}"><img src="${image.src}" alt="${esc(image.alt ?? '')}"></div>`
}

const RIBBON_TEXT = 'Бесплатная версия · водяной знак исчезнет после оплаты проекта'

function ribbon(free: boolean): string {
  return free ? `<div class="ribbon">${RIBBON_TEXT}</div>` : ''
}

function cover(data: PdfData, free: boolean): string {
  const contact = data.project.contact
  const contactLine = [contact?.clientName, contact?.address].filter(Boolean).join(' · ')
  return `
  <section class="page cover">
    ${data.cover ? `<div class="photo"><img src="${data.cover.src}" alt="${esc(data.cover.alt ?? '')}"></div><div class="shade"></div>` : ''}
    ${ribbon(free)}
    <div class="mark">${MARK_SVG}Домица</div>
    <div class="text">
      <p class="eyebrow">Проект интерьера · ${esc(formatMonthYear(data.generatedAt))}</p>
      <h1>${esc(data.project.title)}</h1>
      <div class="line"></div>
      <p class="sub">${esc(data.project.subtitle)}</p>
      ${contactLine ? `<p class="contact">${esc(contactLine)}</p>` : ''}
    </div>
  </section>`
}

function about(data: PdfData, free: boolean): string {
  const contents = [
    ...data.rooms.map((room) => room.name),
    'Список покупок',
    data.estimateStatus === 'not-calculated' ? null : 'Смета',
    data.brief ? 'Техническое задание' : null,
    'Что дальше',
  ].filter((entry): entry is string => Boolean(entry))
  const estimate = data.estimate
  const remaining = estimate.remainingKopecks
  const [headline, rest] = splitSummary(data)
  return `
  <section class="page fixed">
    ${ribbon(free)}
    <div>
      <p class="eyebrow">О проекте</p>
      <h1 style="margin-top:3mm;font-size:26pt">${esc(headline)}</h1>
    </div>
    <div class="cols asym">
      <div style="display:grid;gap:5mm;align-content:start">
        ${rest ? `<p style="font-size:10.5pt;line-height:1.5">${esc(rest)}</p>` : ''}
        <div class="rule"></div>
        ${
          data.estimateStatus === 'not-calculated'
            ? '<p class="bigfig" style="font-size:21pt">Стоимость не рассчитывалась</p><p class="small">Для расчёта нужны выбранные товары, состав работ и ставки. Итоговая стоимость пока неизвестна.</p>'
            : `<p class="bigfig">${formatPrice(estimate.totalKopecks)}</p>
        <p class="small">Смета проекта: мебель и декор по каталогу ${formatPrice(estimate.furnitureKopecks)}, работы по комнатам ≈ ${formatPrice(estimate.works.totalKopecks)}. ${
          remaining === null
            ? 'Бюджет в проекте не указан.'
            : remaining >= 0
              ? `Остаётся ${formatPrice(remaining)} запаса от бюджета.`
              : `Перерасход бюджета ${formatPrice(-remaining)}.`
        }</p>`
        }
      </div>
      <div style="display:grid;gap:5mm;align-content:start">
        <div class="facts">
          ${data.project.facts
            .map(
              (fact) =>
                `<div><p class="k">${esc(fact.label)}</p><p class="v">${esc(fact.value)}</p></div>`,
            )
            .join('')}
        </div>
        <div class="rule"></div>
        <p class="eyebrow">Содержание</p>
        <div class="contents">${contents.map((entry) => `<div>${esc(entry)}</div>`).join('')}</div>
      </div>
    </div>
    ${data.band ? `${img(data.band, 'band')}<p class="small">${esc(data.band.alt ?? '')}</p>` : ''}
  </section>`
}

/** Первое предложение summary становится заголовком страницы, остальное — абзацем под ним */
function splitSummary(data: PdfData): [string, string | null] {
  if (!data.summary) {
    return [data.project.title, null]
  }
  const sentences = data.summary.split(/(?<=[.!?])\s+/)
  const first = (sentences[0] ?? data.summary).replace(/[.!?]$/, '')
  const rest = sentences.slice(1).join(' ').trim()
  return [first, rest === '' ? null : rest]
}

/**
 * Вид сверху в документе: реальный контур комнаты и мебель прямоугольниками в масштабе.
 * Рисуется сразу в SVG, без картинки: Chromium печатает вектор резко на любой бумаге.
 */
function roomPlan(plan: RoomLayout | null): string {
  if (!plan) {
    return ''
  }
  const safetyNote =
    plan.safetySummary.status !== 'checked'
      ? `<p class="verdict status${plan.safetySummary.status === 'blocked' ? ' bad' : ''}">${esc(plan.safetySummary.title)}. ${esc(plan.safetySummary.detail)}</p>`
      : ''
  const unmeasuredNote =
    plan.unmeasured.length > 0
      ? `<p class="verdict status">Не размещены без габаритов: ${esc(plan.unmeasured.map((item) => item.title).join('; '))}. Уточните размеры этих товаров, чтобы добавить их на схему.</p>`
      : ''
  if (plan.problems.some((problem) => problem.kind === 'noRoomSize')) {
    return `<div class="plan">${safetyNote}${unmeasuredNote}</div>`
  }
  const trouble = plan.problems.filter((problem) => problem.kind !== 'noRoomSize')
  const hasGeometry = Boolean(plan.floorPolygon?.length || plan.keepClearZones.length)
  if (plan.placed.length === 0 && trouble.length === 0 && !hasGeometry) {
    return `<div class="plan">${safetyNote}${unmeasuredNote}</div>`
  }
  const width = 400
  const scale = width / plan.widthCm
  const height = Math.max(1, Math.round(plan.depthCm * scale))
  const zonePoints = plan.keepClearZones.flatMap((zone) => zone.polygon)
  const left = Math.min(0, ...zonePoints.map((point) => point.xCm * scale))
  const top = Math.min(0, ...zonePoints.map((point) => point.yCm * scale))
  const right = Math.max(width, ...zonePoints.map((point) => point.xCm * scale))
  const bottom = Math.max(height, ...zonePoints.map((point) => point.yCm * scale))
  // В прямоугольнике только номер: название не помещается в шкаф глубиной 60 см
  // и на печати наезжает на соседей. Что под каким номером, говорит список ниже.
  const boxes = plan.placed
    .map(
      (place, index) =>
        `<rect x="${(place.xCm * scale).toFixed(1)}" y="${(place.yCm * scale).toFixed(1)}" width="${(place.widthCm * scale).toFixed(1)}" height="${(place.depthCm * scale).toFixed(1)}" fill="#f0dcdf" stroke="#7c2f3b" stroke-width="1"/>` +
        `<text x="${((place.xCm + place.widthCm / 2) * scale).toFixed(1)}" y="${((place.yCm + place.depthCm / 2) * scale).toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-size="11" fill="#2f2a20">${index + 1}</text>`,
    )
    .join('')
  const functionalZones = plan.functionalZones
    .map(
      (zone) =>
        `<rect x="${(zone.xCm * scale).toFixed(1)}" y="${(zone.yCm * scale).toFixed(1)}" width="${(zone.widthCm * scale).toFixed(1)}" height="${(zone.depthCm * scale).toFixed(1)}" fill="${zone.source === 'measured' ? '#f0dcdf55' : '#ddd8cf55'}" stroke="${zone.source === 'measured' ? '#7c2f3b' : '#746f67'}" stroke-width="1" stroke-dasharray="4 4"/>`,
    )
    .join('')
  const openings = plan.floorReservations
    .map(
      (reservation) =>
        `<line x1="${(reservation.start.xCm * scale).toFixed(1)}" y1="${(reservation.start.yCm * scale).toFixed(1)}" x2="${(reservation.end.xCm * scale).toFixed(1)}" y2="${(reservation.end.yCm * scale).toFixed(1)}" stroke="${reservation.clearanceCm > 0 ? '#b42338' : '#7c2f3b'}" stroke-width="5" stroke-linecap="round"/>`,
    )
    .join('')
  const fixedZones = plan.keepClearZones
    .map((zone) => {
      const points = zone.polygon
        .map((point) => `${(point.xCm * scale).toFixed(1)},${(point.yCm * scale).toFixed(1)}`)
        .join(' ')
      return `<polygon points="${points}" fill="#b4233822" stroke="#b42338" stroke-width="1" stroke-dasharray="3 3"><title>${esc(zone.label)}</title></polygon>`
    })
    .join('')
  const legend = plan.placed
    .map((place, index) => {
      const input = plan.placementInputs.find((item) => item.id === place.itemId)
      const height =
        input?.heightCm === undefined
          ? 'высота не указана'
          : `высота ${formatDimensionCm(input.heightCm)} см`
      return `<p class="verdict">${index + 1} · ${esc(place.title)} · на схеме ${formatDimensionCm(place.widthCm)} × ${formatDimensionCm(place.depthCm)} см; ${height}</p>`
    })
    .join('')
  const verdict =
    trouble.length > 0
      ? `<p class="verdict status bad">${esc(planProblems(trouble))}</p>`
      : plan.reservationSource === 'geometry'
        ? `<p class="verdict status">На схеме: проход посередине ${plan.walkwayCm} см, суммарно свободных участков стен ${plan.freeWallCm} см. Проёмы учтены по подтверждённой 2D-схеме.</p>`
        : plan.reservationSource === 'description'
          ? `<p class="verdict status">На схеме: проход посередине ${plan.walkwayCm} см, суммарно свободных участков стен ${plan.freeWallCm} см. Проёмы учтены по описанию комнаты; уточните их на плане.</p>`
          : `<p class="verdict status">На схеме: проход посередине ${plan.walkwayCm} см, суммарно свободных участков стен ${plan.freeWallCm} см. Для проверки доступа укажите двери и окна на плане.</p>`
  const missingOperations = plan.operationInputs.filter((item) => item.valueCm === undefined)
  const operationNote =
    missingOperations.length > 0
      ? `<p class="verdict status bad">Не указаны рабочие зоны: ${esc(missingOperations.map((item) => item.title).join(', '))}. До покупки уточните открывание, раскладывание и подход.</p>`
      : plan.functionalZones.length > 0
        ? '<p class="verdict">Пунктиром показаны измеренные рабочие зоны мебели.</p>'
        : ''
  // Пустой подтверждённый пол и неподвижные зоны сохраняются даже без покупок.
  const drawing =
    plan.placed.length > 0 || hasGeometry
      ? `<svg viewBox="${left} ${top} ${right - left} ${bottom - top}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
          ${
            plan.floorPolygon
              ? `<polygon points="${plan.floorPolygon
                  .map(
                    (point) =>
                      `${(point.xCm * scale).toFixed(1)},${(point.yCm * scale).toFixed(1)}`,
                  )
                  .join(' ')}" fill="#faf7f0" stroke="#2f2a20" stroke-width="2"/>`
              : `<rect x="0" y="0" width="${width}" height="${height}" fill="#faf7f0" stroke="#2f2a20" stroke-width="2"/>`
          }
          ${openings}
          ${fixedZones}
          ${functionalZones}
          ${boxes}
        </svg>`
      : ''
  return `
      <div class="plan">
        <p class="eyebrow">Вид сверху · ${formatDimensionCm(plan.widthCm)} × ${formatDimensionCm(plan.depthCm)} см</p>
        ${plan.measurementNote ? `<p class="verdict status">${esc(plan.measurementNote)}</p>` : ''}
        ${safetyNote}
        ${unmeasuredNote}
        ${drawing}
        ${legend}
        ${plan.keepClearZones.length > 0 ? `<p class="verdict">Красным пунктиром: ${esc([...new Set(plan.keepClearZones.map((zone) => zone.label))].join('; '))}. Эти участки учтены в проверке расстановки; рабочие зоны оставьте свободными.</p>` : ''}
        ${verdict}
        ${operationNote}
      </div>`
}

function planProblems(problems: readonly LayoutProblem[]): string {
  return problems
    .map((problem) => {
      if (problem.kind === 'noWall') {
        return `${problem.title} шириной ${formatDimensionCm(problem.widthCm)} см не встаёт ни к одной стене.`
      }
      if (problem.kind === 'noCenter') {
        return `${problem.title} посреди комнаты не помещается.`
      }
      if (problem.kind === 'narrowWalkway') {
        return `Проход посередине ${formatDimensionCm(problem.gapCm)} см, свободно ходить получается от ${WALKWAY_CM} см.`
      }
      if (problem.kind === 'invalidPlacement') {
        const reason =
          problem.reason === 'outside'
            ? 'выходит за контур комнаты'
            : problem.reason === 'collision'
              ? 'пересекается с другой мебелью или рабочей зоной'
              : 'перекрывает проём или инженерную зону'
        return `${problem.title}: закреплённое место ${reason}.`
      }
      return ''
    })
    .filter(Boolean)
    .join(' ')
}

function roomPage(room: PdfRoom, index: number, free: boolean): string {
  const meta = [`Комната ${index + 1}`, formatArea(room.areaM2), room.conditionLabel].filter(
    Boolean,
  )
  return `
  <section class="page fixed" style="gap:5mm">
    ${ribbon(free)}
    <div>
      <p class="eyebrow">${esc(meta.join(' · '))}</p>
      <h1 style="margin-top:2mm">${esc(room.name)}</h1>
    </div>
    ${img(room.render, 'render')}
    <div class="cols wide-left">
      <div class="idea">
        <p class="eyebrow">Идея</p>
        ${room.note ? `<p style="font-size:10pt;line-height:1.5">${esc(room.note)}</p>` : '<p class="small">Подпись к концепту появится после генерации.</p>'}
        ${
          room.before
            ? `<div class="was">${img(room.before, 'img')}<p class="small">Было: ${esc(room.conditionLabel.toLowerCase())}. Сравните окна и двери на концепте с исходным фото.</p></div>`
            : ''
        }
      </div>
      <div class="objects">
        <p class="eyebrow">Предметы на рендере</p>
        ${
          room.objects.length === 0
            ? '<p class="small">Предметы на этом рендере ещё не распознаны.</p>'
            : room.objects
                .slice(0, 8)
                .map(
                  (object) =>
                    `<div class="row"><span class="idx">${String(object.index).padStart(2, '0')}</span><span>${esc(object.product ?? object.category)}${object.product ? `<span class="sub">${esc(object.category)}</span>` : ''}</span><span class="mono nowrap">${object.priceKopecks !== null ? formatPrice(object.priceKopecks) : '—'}</span></div>`,
                )
                .join('')
        }
      </div>
    </div>
    ${
      room.alternates.length > 0
        ? `<div class="thumbs">${room.alternates
            .slice(0, 3)
            .map(
              (alt) =>
                `<figure style="margin:0">${img(alt, 'img')}<p class="cap">${esc(alt.caption)}</p></figure>`,
            )
            .join('')}</div>`
        : ''
    }
  </section>`
}

function roomPlanPage(room: PdfRoom, free: boolean): string {
  const plan = roomPlan(room.plan)
  if (!plan) return ''
  // Схема и её статусы печатаются в обычном потоке, а не внутри обрезаемого разворота рендера.
  return `
  <section class="page plan-page">
    ${ribbon(free)}
    <p class="eyebrow">2D-схема · выбранные товары</p>
    <h1 style="margin-top:3mm">${esc(room.name)} · расстановка</h1>
    ${plan}
    ${(room.measurementNotes ?? []).map((note) => `<p class="verdict">${esc(note)}</p>`).join('')}
  </section>`
}

function shoppingGroup(group: PdfShoppingGroup): string {
  return `
    <div class="group">
      <p class="eyebrow">${esc(group.roomName)}</p>
      <div class="shop">
        ${group.items
          .map((item) => {
            const productLink =
              item.affiliateUrl && /^https?:\/\//i.test(item.affiliateUrl)
                ? `<span><a href="${esc(item.affiliateUrl)}">Открыть выбранный товар в магазине</a></span>`
                : ''
            return `<div class="item">
              ${img(item.image, 'img')}
              <div class="title">${esc(item.title)}${item.meta ? `<span>${esc(item.meta)}</span>` : ''}${productLink}</div>
              <span class="qty">× ${item.quantity}</span>
              <span class="price">${formatPrice(item.totalKopecks)}</span>
            </div>`
          })
          .join('')}
      </div>
    </div>`
}

function shopping(data: PdfData, free: boolean): string {
  const positions = data.shopping.reduce((sum, group) => sum + group.items.length, 0)
  const count = data.shopping.reduce(
    (sum, group) => sum + group.items.reduce((inner, item) => inner + item.quantity, 0),
    0,
  )
  return `
  <section class="page">
    ${ribbon(free)}
    <p class="eyebrow">Список покупок${positions > 0 ? ` · ${pluralPositions(positions)} · ${pluralItems(count)}` : ''}</p>
    <h1 style="margin-top:3mm">Что купить</h1>
    ${
      positions === 0
        ? '<p class="small" style="margin-top:6mm">Список покупок пока пуст: товары добавляются на странице концепта кнопкой «В список».</p>'
        : `${data.shopping.map(shoppingGroup).join('')}
    <div class="shop"><div class="total"><span>Итого по мебели и декору</span><span class="price">${formatPrice(data.estimate.furnitureKopecks)}</span></div></div>`
    }
    <p class="small" style="margin-top:6mm">Документ собран ${esc(formatLongDate(data.generatedAt))}. Цены ориентировочные: перед покупкой проверьте цену, наличие и выбранную ткань в магазине. Ссылки на товары — в этом документе; список можно менять в проекте на сайте.${data.roomsWithoutConcept.length > 0 ? ` ${esc(data.roomsWithoutConcept.join(', '))}: концепт можно выбрать отдельно. При наличии 2D-схемы её статус указан на отдельной странице.` : ''}</p>
    ${adNotice(data)}
  </section>`
}

/**
 * Пометки рекламы одним блоком внизу страницы покупок.
 *
 * В документе есть ссылки на товары, поэтому пометку сети показываем. Строка длинная,
 * и под каждым товаром она разнесла бы список на лишние страницы,
 * а рекламодателей на весь список обычно два-три — отсюда общий блок без повторов.
 */
function adNotice(data: PdfData): string {
  const notices = [
    ...new Set(
      data.shopping.flatMap((group) =>
        group.items
          .map((item) => item.adDisclosure?.trim())
          .filter((text): text is string => Boolean(text)),
      ),
    ),
  ]
  if (notices.length === 0) {
    return ''
  }
  return `<div class="ads"><p class="small">Часть позиций подобрана по партнёрским программам магазинов:</p>${notices
    .map((notice) => `<p class="small">${esc(notice)}</p>`)
    .join('')}</div>`
}

function estimatePage(data: PdfData, free: boolean): string {
  const { estimate, rates } = data
  const counted = estimate.works.rooms.filter(
    (room) => room.kind !== 'no-area' && room.kind !== 'separate',
  )
  const remaining = estimate.remainingKopecks
  const freeLabel =
    remaining === null
      ? 'бюджет не указан'
      : remaining < 0
        ? `перерасход ${formatPrice(-remaining)}`
        : `запас ${formatPrice(remaining)}`
  return `
  <section class="page fixed">
    ${ribbon(free)}
    <div>
      <p class="eyebrow">Смета ·${esc(formatArea(estimate.works.areaM2) ?? 'площади не указаны')}</p>
      <h1 style="margin-top:3mm">Сколько это стоит</h1>
    </div>
    <div class="estimate">
      <p class="eyebrow">Мебель и декор — по каталогу</p>
      ${
        data.shopping.length === 0
          ? `<div class="line"><span>Покупок пока нет</span><span class="formula"></span><span class="price">${formatPrice(0)}</span></div>`
          : data.shopping
              .map(
                (group) =>
                  `<div class="line"><span>${esc(group.roomName)}, ${pluralPositions(group.items.length)}</span><span class="formula">по списку покупок</span><span class="price">${formatPrice(group.items.reduce((sum, item) => sum + item.totalKopecks, 0))}</span></div>`,
              )
              .join('')
      }
    </div>
    <div class="estimate">
      <p class="eyebrow">Работы — примерная оценка</p>
      ${counted
        .map((room) => {
          const formula =
            room.kind === 'full'
              ? `${formatArea(room.areaM2)} × (${formatRubles(rates.roughRubPerM2)} + ${formatRubles(rates.finishRubPerM2)})`
              : room.kind === 'finish'
                ? `${formatArea(room.areaM2)} × ${formatRubles(rates.finishRubPerM2)}`
                : 'отделка есть, без работ'
          return `<div class="line"><span>${esc(room.name)}</span><span class="formula">${esc(formula)}</span><span class="price">${formatPrice(room.totalKopecks)}</span></div>`
        })
        .join('')}
      ${estimate.works.roomsWithoutArea.map((name) => `<div class="line"><span>${esc(name)}</span><span class="formula">площадь не указана</span><span class="price">—</span></div>`).join('')}
      ${estimate.works.roomsSeparate.map((name) => `<div class="line"><span>${esc(name)}</span><span class="formula">отдельный расчёт работ</span><span class="price">—</span></div>`).join('')}
      <div class="sum"><span>Итого по расчёту</span><span class="price">${formatPrice(estimate.totalKopecks)}</span></div>
      <p style="font-size:9.5pt;margin-top:2mm">Мебель — по списку покупок, работы — по площади пола и ставкам ниже. Материалы для отделки в сумму не включены.${estimate.works.roomsWithoutArea.length > 0 ? ` Работы для комнат без площади ещё не включены: ${esc(estimate.works.roomsWithoutArea.join(', '))}.` : ''}${estimate.works.roomsSeparate.length > 0 ? ` Работы на балконах и лоджиях в итог не включены: нужен отдельный расчёт по месту (${esc(estimate.works.roomsSeparate.join(', '))}).` : ''}</p>
    </div>
    <div style="display:grid;gap:3mm">
      <div class="bar"><span style="width:${estimate.shares.furniture * 100}%;background:#7c2f3b"></span><span style="width:${estimate.shares.works * 100}%;background:#b98a5a"></span><span style="width:${estimate.shares.free * 100}%;background:${estimate.overBudget ? '#d9a6ad' : '#ddd4c1'}"></span></div>
      <div class="legend"><span><i style="background:#7c2f3b"></i>Мебель ${formatShare(estimate.shares.furniture)}</span><span><i style="background:#b98a5a"></i>Работы ${formatShare(estimate.shares.works)}</span><span><i style="background:${estimate.overBudget ? '#d9a6ad' : '#ddd4c1'}"></i>${esc(freeLabel)}</span></div>
      ${estimate.budgetKopecks !== null ? `<p class="small">Бюджет проекта ${formatPrice(estimate.budgetKopecks)}.</p>` : ''}
    </div>
    <p style="font-size:9.5pt">Ставки этого расчёта: ${formatRubles(rates.roughRubPerM2)}/м² черновые и ${formatRubles(rates.finishRubPerM2)}/м² чистовые. Стоимость и состав работ согласуйте с мастерами после осмотра квартиры.</p>
  </section>`
}

function briefPages(data: PdfData, free: boolean): string {
  const brief = data.brief
  if (!brief) {
    return ''
  }
  return `
  <section class="page">
    ${ribbon(free)}
    <p class="eyebrow">Интерьер · для обсуждения и сметы бригады</p>
    <h1 style="margin-top:3mm">Задание для мастеров</h1>
    <div class="brief-warning">
      <p class="brief-warning-title">Как использовать задание</p>
      <p>Обсудите с мастерами отделку и обстановку по выбранным концептам. Перед согласованием сметы бригада сверяет обмеры, состояние основания и проводки, количество материалов и места установки оборудования на объекте.</p>
      <p>Инженерные решения, расчёты конструкций и согласование перепланировки оформляются отдельно с профильными специалистами. Это задание не заменяет рабочую проектную документацию.</p>
    </div>
    <div class="rule strong" style="margin-top:5mm"></div>
    ${brief.rooms
      .map(
        (room) => `
      <article class="brief-room" style="margin-top:6mm">
        <h2>${esc(room.name)}</h2>
        <div class="brief-grid">
          ${room.sections
            .map(
              (section) =>
                `<section><h3>${esc(section.title)}</h3><ol>${section.items.map((item) => `<li>${esc(item)}</li>`).join('')}</ol></section>`,
            )
            .join('')}
        </div>
      </article>`,
      )
      .join('')}
  </section>`
}

function finalPage(data: PdfData, free: boolean): string {
  const questions = data.brief?.questions ?? []
  const onlineDescription = data.rooms.some((room) => room.render)
    ? 'Рендеры и данные проекта'
    : 'Данные проекта'
  return `
  <section class="page">
    ${ribbon(free)}
    <p class="eyebrow">Что дальше</p>
    <h1 style="margin-top:3mm">Перед тем как звать бригаду</h1>
    <div class="cols" style="margin-top:8mm">
      <div style="display:grid;gap:3mm;align-content:start">
        <p class="eyebrow">Что уточнить у заказчика</p>
        ${questions.length > 0 ? `<ol class="qlist">${questions.map((question) => `<li>${esc(question)}</li>`).join('')}</ol>` : '<p class="small">Вопросы появятся вместе с заданием для мастеров.</p>'}
      </div>
      <div style="display:grid;gap:5mm;align-content:start">
        <p class="eyebrow">Порядок</p>
        <p style="font-size:10pt;line-height:1.5">Согласуйте состав и порядок работ с бригадой, а электрику и другие инженерные решения — с профильными специалистами. Перед заказом крупных предметов сверьте размеры и доступ по месту; сроки доставки уточните в магазине.</p>
        ${
          data.project.projectUrl
            ? `<div class="rule"></div>
        <p class="eyebrow">Проект онлайн</p>
        <p style="font-size:10pt;line-height:1.5">${onlineDescription} — по адресу <span class="mono" style="font-size:9pt">${esc(data.project.projectUrl)}</span>. Список покупок там можно менять, после изменений соберите новый PDF.</p>`
            : ''
        }
        ${data.project.contact?.phone ? `<p class="small">Телефон заказчика для мастера: <span class="mono">${esc(data.project.contact.phone)}</span></p>` : ''}
      </div>
    </div>
    <div class="rule" style="margin-top:10mm"></div>
    <p class="small" style="margin-top:4mm">Документ собран сервисом «Домица» ${esc(formatLongDate(data.generatedAt))} по сохранённым данным проекта. Цены магазинов и оценка работ ориентировочные и могут измениться; ссылки на магазины партнёрские.${data.brief ? ' Задание для мастеров не заменяет рабочую проектную документацию.' : ''}</p>
  </section>`
}

/**
 * Полный HTML документа для печати в PDF: обложка, о проекте, рендеры и схемы комнат,
 * список покупок, смета, ТЗ мастеру и «что дальше». Все картинки — data URI, шрифты вшиты.
 */
export function renderProjectHtml(data: PdfData, options: { fontCss: string }): string {
  const free = data.kind === 'free'
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>${esc(data.project.title)} · Домица</title>
<style>
${options.fontCss}
${CSS}
</style>
</head>
<body class="${free ? 'free' : 'paid'}">
${free ? '<div class="wm-layer"></div>' : ''}
${cover(data, free)}
${about(data, free)}
${data.rooms.map((room, index) => (room.hasConcept === false ? '' : roomPage(room, index, free)) + roomPlanPage(room, free)).join('')}
${shopping(data, free)}
${data.estimateStatus === 'not-calculated' ? '' : estimatePage(data, free)}
${briefPages(data, free)}
${finalPage(data, free)}
</body>
</html>`
}

/** Колонтитул для Playwright: название проекта слева, номер страницы справа; на обложке скрыт нулевыми полями */
export function footerTemplate(title: string): string {
  return `<div style="width:100%;padding:0 16mm;display:flex;justify-content:space-between;font-family:Georgia,serif;font-size:7.5px;letter-spacing:0.08em;text-transform:uppercase;color:#6d6656"><span>Домица · ${esc(title)}</span><span class="pageNumber"></span></div>`
}
