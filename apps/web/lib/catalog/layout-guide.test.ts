import { conceptLayout, layoutGuideSvgs, type RoomLayout } from '@uyut/catalog'
import type { PlanGeometry } from '@uyut/db'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

function checkedLayout(): RoomLayout {
  const geometry: PlanGeometry = {
    version: 1,
    status: 'confirmed',
    widthCm: 480,
    heightCm: 560,
    warnings: [],
    walls: [
      { id: 'top', kind: 'outer', start: { xCm: 0, yCm: 0 }, end: { xCm: 480, yCm: 0 } },
      { id: 'left', kind: 'outer', start: { xCm: 0, yCm: 0 }, end: { xCm: 0, yCm: 560 } },
    ],
    openings: [
      {
        id: 'window',
        type: 'window',
        wallId: 'top',
        offsetCm: 200,
        widthCm: 100,
        sillHeightCm: 90,
      },
      {
        id: 'door',
        type: 'door',
        wallId: 'left',
        offsetCm: 300,
        widthCm: 80,
        clearance: { side: 'right', depthCm: 80, shape: 'rectangle' },
      },
    ],
    rooms: [
      {
        name: 'Гостиная',
        polygon: [
          { xCm: 0, yCm: 0 },
          { xCm: 480, yCm: 0 },
          { xCm: 480, yCm: 560 },
          { xCm: 0, yCm: 560 },
        ],
      },
    ],
  }
  const layout = conceptLayout('Гостиная', 'living', null, geometry, [
    {
      id: 'sofa',
      title: 'Диван',
      category: 'sofa',
      quantity: 1,
      dimensions: { width: 240, depth: 95, height: 90 },
      operationClearance: { front: 30 },
      placement: { xCm: 0, yCm: 0, rotation: 90, frontDirection: 'right' },
    },
  ])
  if (!layout) throw new Error('The synthetic fixture must satisfy the production layout gate')
  return layout
}

describe('technical furniture layout SVG guides', () => {
  it('renders a deterministic finite pair from the checked rectangle without mutating it', async () => {
    const layout = checkedLayout()
    const before = structuredClone(layout)
    const guides = layoutGuideSvgs(layout, 280)
    expect(guides).toBeDefined()
    expect(layoutGuideSvgs(layout, 280)).toEqual(guides)
    expect(layout).toEqual(before)
    for (const svg of Object.values(guides ?? {})) {
      expect(svg).not.toMatch(/NaN|Infinity|undefined/)
      expect(svg).toContain('480 x 560 cm - ceiling 280 cm')
      expect(svg).toContain('90 cm')
      expect(svg).toContain('front right')
      expect(svg).toContain('Opening markers do not specify opening heights')
      const png = await sharp(Buffer.from(svg)).png().toBuffer()
      expect(await sharp(png).metadata()).toMatchObject({ format: 'png', width: 1200, height: 900 })
    }
  })

  it.each([undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1001])(
    'withholds guides without a usable ceiling: %s',
    (ceiling) => {
      expect(layoutGuideSvgs(checkedLayout(), ceiling)).toBeUndefined()
    },
  )

  it.each([undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, 281])(
    'does not substitute an unknown, invalid or over-ceiling furniture height: %s',
    (height) => {
      const layout = checkedLayout()
      const input = layout.placementInputs[0]
      if (!input) throw new Error('Missing fixture furniture')
      input.heightCm = height
      expect(layoutGuideSvgs(layout, 280)).toBeUndefined()
    },
  )

  it.each(['missing', 'notched', 'bowtie', 'duplicate', 'nonfinite'] as const)(
    'withholds a %s floor contour instead of replacing it with its bounds',
    (kind) => {
      const layout = checkedLayout()
      if (kind === 'missing') delete layout.floorPolygon
      else if (kind === 'notched')
        layout.floorPolygon = [
          { xCm: 0, yCm: 0 },
          { xCm: 480, yCm: 0 },
          { xCm: 480, yCm: 300 },
          { xCm: 300, yCm: 300 },
          { xCm: 300, yCm: 560 },
          { xCm: 0, yCm: 560 },
        ]
      else if (kind === 'bowtie')
        layout.floorPolygon = [
          { xCm: 0, yCm: 0 },
          { xCm: 480, yCm: 560 },
          { xCm: 480, yCm: 0 },
          { xCm: 0, yCm: 560 },
        ]
      else if (kind === 'duplicate')
        layout.floorPolygon = [
          { xCm: 0, yCm: 0 },
          { xCm: 480, yCm: 0 },
          { xCm: 480, yCm: 560 },
          { xCm: 0, yCm: 0 },
        ]
      else
        layout.floorPolygon = [
          { xCm: 0, yCm: 0 },
          { xCm: Number.NaN, yCm: 0 },
          { xCm: 480, yCm: 560 },
          { xCm: 0, yCm: 560 },
        ]
      expect(layoutGuideSvgs(layout, 280)).toBeUndefined()
    },
  )

  it.each(['preliminary', 'blocked', 'needs-data'] as const)('withholds %s safety', (status) => {
    const layout = checkedLayout()
    layout.safetySummary.status = status
    expect(layoutGuideSvgs(layout, 280)).toBeUndefined()
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 5001])(
    'withholds invalid room dimensions: %s',
    (dimension) => {
      const layout = checkedLayout()
      expect(layoutGuideSvgs({ ...layout, widthCm: dimension }, 280)).toBeUndefined()
      expect(layoutGuideSvgs({ ...layout, depthCm: dimension }, 280)).toBeUndefined()
    },
  )

  it('does not flatten an explicitly referenced floor level', () => {
    const layout = checkedLayout()
    const floor = layout.floorPolygon ?? []
    layout.floorLevel = {
      referenceId: 'survey',
      referenceKind: 'finished-floor',
      zeroFloorId: 'ground',
      floorId: 'upper',
      elevationCm: 300,
      surface: 'finished-floor',
      reviewKey: 'review',
      worldPolygon: floor,
      origin: { xCm: 0, yCm: 0 },
      surfaces: [{ floor, voids: [] }],
    }
    expect(layoutGuideSvgs(layout, 280)).toBeUndefined()
  })

  it.each(['review', 'needs-data'] as const)('withholds a %s furniture relationship', (status) => {
    const layout = checkedLayout()
    layout.relationships.push({
      id: 'sofa-tv',
      kind: 'sofa-tv',
      label: 'Test',
      detail: 'Test',
      status,
    })
    expect(layoutGuideSvgs(layout, 280)).toBeUndefined()
  })

  it.each(['projected', 'unmeasured', 'problem', 'empty', 'nonfinite-position'] as const)(
    'withholds a layout with %s data',
    (kind) => {
      const layout = checkedLayout()
      if (kind === 'projected') layout.projectedContour = { geometryKey: 'stale', roomIndex: 0 }
      if (kind === 'unmeasured') layout.unmeasured.push({ id: 'unknown', title: 'Unknown' })
      if (kind === 'problem')
        layout.problems.push({ kind: 'invalidPlacement', title: 'Sofa', reason: 'outside' })
      if (kind === 'empty') layout.placed = []
      if (kind === 'nonfinite-position' && layout.placed[0]) layout.placed[0].xCm = Number.NaN
      expect(layoutGuideSvgs(layout, 280)).toBeUndefined()
    },
  )

  it('escapes user furniture labels in both SVGs', async () => {
    const layout = checkedLayout()
    const item = layout.placed[0]
    if (!item) throw new Error('Missing fixture furniture')
    item.title = `<script>"x" & 'y'</script>`
    const guides = layoutGuideSvgs(layout, 280)
    expect(guides).toBeDefined()
    for (const svg of Object.values(guides ?? {})) {
      expect(svg).not.toContain('<script>')
      expect(svg).toContain('&lt;script&gt;&quot;x&quot; &amp; &apos;y&apos;&lt;/script&gt;')
      await expect(sharp(Buffer.from(svg)).png().toBuffer()).resolves.toBeInstanceOf(Buffer)
    }
  })

  it('rejects an opening behind the perspective camera plane', () => {
    const layout = checkedLayout()
    layout.depthCm = 100
    layout.floorPolygon = [
      { xCm: 0, yCm: 0 },
      { xCm: 480, yCm: 0 },
      { xCm: 480, yCm: 100 },
      { xCm: 0, yCm: 100 },
    ]
    const item = layout.placed[0]
    if (!item) throw new Error('Missing fixture furniture')
    item.depthCm = 50
    layout.floorReservations = [
      {
        kind: 'window',
        start: { xCm: 200, yCm: 100 },
        end: { xCm: 300, yCm: 100 },
        clearanceCm: 0,
        sillHeightCm: 290,
      },
    ]
    expect(layoutGuideSvgs(layout, 300)).toBeUndefined()
  })
})
