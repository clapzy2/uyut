import type { PlanGeometry, PlanWallFacePair } from '@uyut/db'
import { Children, createElement, isValidElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PlanGeometryPreview } from './plan-geometry-preview'
import { PlanVolumeLaunch } from './plan-volume-launch'

describe('предпросмотр 2D-схемы', () => {
  it('отмечает наружные PDF-участки без сохранённой пары граней отдельно от пола', () => {
    const paired = {
      id: 'paired-outer',
      kind: 'outer' as const,
      start: { xCm: 0, yCm: 0 },
      end: { xCm: 100, yCm: 0 },
    }
    const unpaired = {
      id: 'unpaired-outer',
      kind: 'outer' as const,
      start: { xCm: 100, yCm: 0 },
      end: { xCm: 100, yCm: 100 },
    }
    const inner = {
      id: 'inner-face',
      kind: 'inner' as const,
      start: { xCm: 0, yCm: 10 },
      end: { xCm: 100, yCm: 10 },
    }
    const sourcePair: PlanWallFacePair = {
      faces: [
        {
          wall: paired,
          start: paired.start,
          end: paired.end,
          nativeSegment: { operationIndex: 1, subpathIndex: 0, segmentIndex: 0 },
        },
        {
          wall: inner,
          start: inner.start,
          end: inner.end,
          nativeSegment: { operationIndex: 1, subpathIndex: 0, segmentIndex: 1 },
        },
      ],
      openings: [],
    }
    const geometry: PlanGeometry = {
      version: 1,
      source: 'manual',
      status: 'draft',
      widthCm: 100,
      heightCm: 100,
      warnings: [],
      walls: [paired, unpaired, inner],
      openings: [],
      rooms: [],
      pdfCalibration: {
        sourceSha256: 'a'.repeat(64),
        pdfPage: 1,
        cmPerPoint: 1,
        origin: { x: 0, y: 0 },
        anchorRoomNumbers: [],
        labelIndexes: [],
        derivedOpeningIds: [],
        wallFaceRoomPolygons: [],
        sourceWallFacePairs: [sourcePair],
      },
    }

    const html = renderToStaticMarkup(createElement(PlanGeometryPreview, { geometry }))
    expect(html).toContain('Красный пунктир показывает 1 наружный участок')
    expect(html).toContain('Граница пола их не заменяет')
    expect(html).toContain('href="#project-plan"')
    expect(html.match(/У этого наружного участка есть часть без исходной пары/g)).toHaveLength(1)
    expect(html).toContain('stroke-dasharray="8 5"')

    const calibration = geometry.pdfCalibration
    if (!calibration) throw new Error('Expected PDF calibration')
    const partial = renderToStaticMarkup(
      createElement(PlanGeometryPreview, {
        geometry: {
          ...geometry,
          pdfCalibration: {
            ...calibration,
            sourceWallFacePairs: [
              {
                ...sourcePair,
                faces: [
                  { ...sourcePair.faces[0], end: { xCm: 40, yCm: 0 } },
                  { ...sourcePair.faces[1], end: { xCm: 40, yCm: 10 } },
                ],
              },
            ],
          },
        },
      }),
    )
    expect(partial).toContain('Красный пунктир показывает 2 наружных участка')
    expect(partial).toMatch(/x1="40" y1="0" x2="100" y2="0" stroke="var\(--danger\)"/)
    expect(partial).toMatch(/x1="0" y1="0" x2="40" y2="0" stroke="var\(--ink\)"/)
    expect(partial).toContain('Чёрная часть такого участка имеет исходную пару')

    const secondPair: PlanWallFacePair = {
      ...sourcePair,
      faces: [
        { ...sourcePair.faces[0], start: { xCm: 60, yCm: 0 } },
        { ...sourcePair.faces[1], start: { xCm: 60, yCm: 10 } },
      ],
    }
    const split = renderToStaticMarkup(
      createElement(PlanGeometryPreview, {
        geometry: {
          ...geometry,
          pdfCalibration: {
            ...calibration,
            sourceWallFacePairs: [
              {
                ...sourcePair,
                faces: [
                  { ...sourcePair.faces[0], end: { xCm: 40, yCm: 0 } },
                  { ...sourcePair.faces[1], end: { xCm: 40, yCm: 10 } },
                ],
              },
              secondPair,
            ],
          },
        },
      }),
    )
    expect(split).toMatch(/x1="0" y1="0" x2="40" y2="0" stroke="var\(--ink\)"/)
    expect(split).toMatch(/x1="40" y1="0" x2="60" y2="0" stroke="var\(--danger\)"/)
    expect(split).toMatch(/x1="60" y1="0" x2="100" y2="0" stroke="var\(--ink\)"/)
    expect(split).toContain('Красный пунктир показывает 2 наружных участка')

    const afterEdit = renderToStaticMarkup(
      createElement(PlanGeometryPreview, {
        geometry: {
          ...geometry,
          walls: [{ ...paired, end: { xCm: 90, yCm: 0 } }, unpaired, inner],
        },
      }),
    )
    expect(afterEdit).toContain('Красный пунктир показывает 2 наружных участка')
  })

  it('не выдаёт внутреннюю согласованность AI-черновика за точное чтение исходника', () => {
    const geometry: PlanGeometry = {
      version: 1,
      status: 'draft',
      widthCm: 500,
      heightCm: 400,
      warnings: [],
      walls: [],
      openings: [],
      rooms: [],
    }

    const html = renderToStaticMarkup(createElement(PlanGeometryPreview, { geometry }))

    expect(html).toContain('только внутреннюю согласованность схемы')
    expect(html).toContain('не точность чтения исходника')
    expect(html).toContain('сверьте размеры сторон, контуры комнат и расположение проёмов')
    expect(html).not.toContain('прошла машинную проверку размеров')
  })

  it('shows confirmation blockers before opening the editor', () => {
    const geometry: PlanGeometry = {
      version: 1,
      source: 'manual',
      status: 'draft',
      widthCm: 500,
      heightCm: 400,
      warnings: [],
      walls: [
        {
          id: 'first',
          kind: 'inner',
          start: { xCm: 50, yCm: 50 },
          end: { xCm: 150, yCm: 50 },
        },
        {
          id: 'second',
          kind: 'inner',
          start: { xCm: 350, yCm: 350 },
          end: { xCm: 450, yCm: 350 },
        },
      ],
      openings: [],
      rooms: [],
    }

    const draft = renderToStaticMarkup(createElement(PlanGeometryPreview, { geometry }))
    expect(draft).toContain('Уточнения перед подтверждением схемы')
    expect(draft).toContain('Часть стен не соединена с остальной схемой')

    const confirmed = renderToStaticMarkup(
      createElement(PlanGeometryPreview, { geometry: { ...geometry, status: 'confirmed' } }),
    )
    expect(confirmed).not.toContain('Уточнения перед подтверждением схемы')
  })

  it('объясняет границу пола и техническую пустоту отдельно от стен', () => {
    const geometry: PlanGeometry = {
      version: 1,
      source: 'manual',
      status: 'draft',
      widthCm: 500,
      heightCm: 400,
      warnings: [],
      walls: [
        {
          id: 'wall',
          kind: 'outer',
          start: { xCm: 0, yCm: 0 },
          end: { xCm: 500, yCm: 0 },
        },
      ],
      openings: [],
      rooms: [],
      footprint: [
        { xCm: 0, yCm: 0 },
        { xCm: 500, yCm: 0 },
        { xCm: 500, yCm: 400 },
        { xCm: 0, yCm: 400 },
      ],
      voids: [
        {
          id: 'shaft',
          polygon: [
            { xCm: 450, yCm: 0 },
            { xCm: 500, yCm: 0 },
            { xCm: 500, yCm: 400 },
            { xCm: 450, yCm: 400 },
          ],
        },
      ],
    }

    const html = renderToStaticMarkup(createElement(PlanGeometryPreview, { geometry }))

    expect(html).toContain('граница пола')
    expect(html).toContain('техническая пустота')
    expect(html).toContain('1 стена · 0 проёмов · 0 контуров')
    expect(html).toContain('Граница пола, не оси наружных стен')
    expect(html).toContain('Техническая пустота shaft')
    expect(html.indexOf('stroke="var(--ink)"')).toBeLessThan(
      html.indexOf('Граница пола, не оси наружных стен'),
    )

    const confirmed = renderToStaticMarkup(
      createElement(PlanGeometryPreview, { geometry: { ...geometry, status: 'confirmed' } }),
    )
    expect(confirmed).toContain('Посмотреть объёмную схему')
    expect(confirmed).toContain('aria-label="Объёмный просмотр"')
    expect(confirmed).toContain('aria-expanded="false"')

    // Объёмный просмотр — сосед 2D-сетки, а не часть её узкой колонки пояснений.
    const preview = PlanGeometryPreview({ geometry: { ...geometry, status: 'confirmed' } })
    const sections = Children.toArray(preview.props.children)
    const volumeSection = sections.at(-1)
    expect(isValidElement(volumeSection) && volumeSection.type).toBe(PlanVolumeLaunch)

    const unverifiedPdf = renderToStaticMarkup(
      createElement(PlanGeometryPreview, {
        geometry: {
          ...geometry,
          status: 'confirmed',
          pdfCalibration: {
            sourceSha256: 'source',
            pdfPage: 1,
            cmPerPoint: 1,
            origin: { x: 0, y: 0 },
            anchorRoomNumbers: [],
            labelIndexes: [],
            derivedOpeningIds: [],
          },
        },
      }),
    )
    // The exact missing piece is named; no conditional zero is offered instead.
    expect(unverifiedPdf).toContain('Нужен общий отсчёт высот')
    expect(unverifiedPdf).toContain('условный ноль не подставляется')
    expect(unverifiedPdf).not.toContain('Посмотреть объёмную схему')
  })

  it('keeps an unproven PDF opening as a visible proposal without cutting the wall', () => {
    const wall = {
      id: 'wall',
      kind: 'inner' as const,
      start: { xCm: 0, yCm: 100 },
      end: { xCm: 300, yCm: 100 },
    }
    const first = { id: 'first', type: 'door' as const, wallId: wall.id, offsetCm: 20, widthCm: 60 }
    const second = {
      id: 'second',
      type: 'door' as const,
      wallId: wall.id,
      offsetCm: 150,
      widthCm: 60,
    }
    const geometry: PlanGeometry = {
      version: 1,
      source: 'manual',
      status: 'draft',
      widthCm: 300,
      heightCm: 200,
      warnings: [],
      walls: [wall],
      openings: [first, second],
      rooms: [],
      pdfCalibration: {
        sourceSha256: 'a'.repeat(64),
        pdfPage: 1,
        cmPerPoint: 1,
        origin: { x: 0, y: 0 },
        anchorRoomNumbers: [],
        labelIndexes: [],
        derivedOpeningIds: [],
        wallFaceRoomPolygons: [],
        sourceOpeningFacePairs: [
          {
            bindings: [
              {
                opening: first,
                wall,
                cut: [
                  { xCm: 20, yCm: 100 },
                  { xCm: 80, yCm: 100 },
                ],
              },
              {
                opening: second,
                wall,
                cut: [
                  { xCm: 150, yCm: 100 },
                  { xCm: 210, yCm: 100 },
                ],
              },
            ],
            jambs: [
              { operationIndex: 1, subpathIndex: 0, segmentIndex: 0 },
              { operationIndex: 2, subpathIndex: 0, segmentIndex: 0 },
            ],
          },
        ],
      },
    }
    const proven = renderToStaticMarkup(createElement(PlanGeometryPreview, { geometry }))
    expect(proven).toContain('stroke="var(--paper)"')
    expect(proven).not.toContain('Проём не подтверждён')

    const calibration = geometry.pdfCalibration
    if (!calibration) throw new Error('The PDF fixture needs source calibration')
    const unmeasured = renderToStaticMarkup(
      createElement(PlanGeometryPreview, {
        geometry: {
          ...geometry,
          pdfCalibration: {
            ...calibration,
            derivedOpeningIds: [first.id],
          },
        },
      }),
    )
    const proposedGroup = unmeasured.match(
      /<g><title>Проём не подтверждён: сверьте косяки и обязательные мерки<\/title>.*?<\/g>/,
    )?.[0]
    expect(proposedGroup).toBeDefined()
    expect(proposedGroup).not.toContain('stroke="var(--paper)"')

    geometry.openings[1] = { ...second, offsetCm: 151 }
    const held = renderToStaticMarkup(createElement(PlanGeometryPreview, { geometry }))
    expect(held).not.toContain('stroke="var(--paper)"')
    expect(held).toContain('Проём не подтверждён')
    expect(held).toContain('stroke-dasharray="7 5"')

    const manual = renderToStaticMarkup(
      createElement(PlanGeometryPreview, { geometry: { ...geometry, pdfCalibration: undefined } }),
    )
    expect(manual).toContain('stroke="var(--paper)"')
  })
})
