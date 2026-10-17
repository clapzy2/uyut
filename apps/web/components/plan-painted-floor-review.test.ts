import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import {
  changePaintedFloorBoundaryRole,
  PlanPaintedFloorReviewEditor,
} from './plan-painted-floor-review'

const savedReview = {
  review: 'manual-native-painted-floor-review',
  source: { sha256: 'a'.repeat(64), pdfPage: 3, state: 'existing' },
  rasterSource: { sha256: 'a'.repeat(64), page: 3, width: 2000, height: 1414 },
  floors: [
    {
      candidateId: 'test-fill:0',
      pieceIndex: 0,
      owner: { sourceRoomKey: '5', nameLabelId: 'balcony', numberLabelId: 'number-5' },
      polygon: [
        { x: 10, y: 10 },
        { x: 30, y: 10 },
        { x: 30, y: 30 },
        { x: 25, y: 35 },
        { x: 20, y: 35 },
        { x: 15, y: 35 },
        { x: 10, y: 30 },
        { x: 10, y: 20 },
      ],
      holes: [],
      boundaryRoles: Array.from({ length: 8 }, (_, edgeIndex) => ({
        edgeIndex,
        kind: 'unresolved',
      })),
    },
  ],
}

it('keeps technical JSON collapsed while preserving explicit source review', () => {
  const html = renderToStaticMarkup(
    createElement(PlanPaintedFloorReviewEditor, {
      projectId: 'test-project',
      revision: 'test-revision',
      onSaved: vi.fn(),
      onConflict: vi.fn(),
    }),
  )

  expect(html).toContain('Подготовить черновик по подписям PDF')
  expect(html).toContain(
    '<summary class="min-h-11 cursor-pointer py-2 text-[13px] font-medium">Технические данные и ручная правка</summary>',
  )
  expect(html).toContain('JSON выбора областей пола')
  expect(html).toContain('не подтверждение физических границ или обмеров')
  expect(html).toContain('disabled=""')
})

it('offers edge-by-edge role review without presenting it as physical proof', () => {
  const html = renderToStaticMarkup(
    createElement(PlanPaintedFloorReviewEditor, {
      projectId: 'test-project',
      revision: 'test-revision',
      savedJson: JSON.stringify(savedReview),
      onSaved: vi.fn(),
      onConflict: vi.fn(),
      onHighlightBoundary: vi.fn(),
      highlightedBoundary: { floorIndex: 0, edgeIndex: 1 },
    }),
  )

  expect(html).toContain('Роли граней выбранных областей')
  expect(html).toContain('№ 5 · область test-fill:0, фрагмент 1')
  expect(html).toContain('Роль грани 8')
  expect(html).toContain('Показать грань 2 на листе')
  expect(html).toContain('aria-pressed="true"')
  expect(html).toContain('не доказательство физической стены, косяка или перепада')
  expect(html).toContain('value="unresolved" selected=""')
})

it('changes only the selected declaration and preserves original source references', () => {
  const original = JSON.stringify(savedReview)
  const changed = changePaintedFloorBoundaryRole(original, 0, 1, 'opening-boundary')
  expect(changed).not.toBeNull()
  const parsed = JSON.parse(changed as string)

  expect(parsed).toEqual({
    ...savedReview,
    floors: [
      {
        ...savedReview.floors[0],
        boundaryRoles: savedReview.floors[0]?.boundaryRoles.map((boundary) => ({
          ...boundary,
          kind: boundary.edgeIndex === 1 ? 'opening-boundary' : 'unresolved',
        })),
      },
    ],
  })
  expect(JSON.parse(original)).toEqual(savedReview)
  expect(parsed).not.toHaveProperty('physicalBoundariesAccepted')
})

it('does not edit malformed, shifted, or unknown boundary declarations', () => {
  const original = JSON.stringify(savedReview)
  expect(changePaintedFloorBoundaryRole('{', 0, 0, 'wall-face')).toBeNull()
  expect(changePaintedFloorBoundaryRole(original, 0, 8, 'wall-face')).toBeNull()
  expect(
    changePaintedFloorBoundaryRole(
      JSON.stringify({
        ...savedReview,
        floors: [
          {
            ...savedReview.floors[0],
            boundaryRoles: [{ edgeIndex: 1, kind: 'unresolved' }],
          },
        ],
      }),
      0,
      0,
      'wall-face',
    ),
  ).toBeNull()
  expect(changePaintedFloorBoundaryRole(original, 0, 0, 'accepted-wall' as 'wall-face')).toBeNull()
})
