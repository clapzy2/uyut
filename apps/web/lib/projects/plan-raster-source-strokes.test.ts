import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { rasterPlanCandidates } from './plan-raster-candidates'
import { rasterSourceStrokeResponse } from './plan-raster-snap'
import { rasterSourceStrokeGuide } from './plan-raster-source-strokes'

const region = {
  id: 'region-1',
  polygon: [
    { x: 100, y: 100 },
    { x: 300, y: 100 },
    { x: 300, y: 300 },
    { x: 100, y: 300 },
  ],
  hasInteriorIslands: false,
}
const image = { width: 1000, height: 1000 }
const page = { width: 1000, height: 1000 }
const stroke = (
  operationIndex: number,
  start: { x: number; y: number },
  end: { x: number; y: number },
) => ({ operationIndex, subpathIndex: 0, segmentIndex: 0, start, end })

describe('native PDF strokes near a focused raster region', () => {
  it('returns bounded source references and marks unmatched sides separately', () => {
    const guide = rasterSourceStrokeGuide(region, image, page, [
      stroke(12, { x: 130, y: 100 }, { x: 250, y: 100 }),
      stroke(13, { x: 500, y: 500 }, { x: 700, y: 500 }),
    ])
    expect(guide?.edges).toHaveLength(4)
    expect(guide?.edges[0]).toMatchObject({
      index: 0,
      status: 'nearby',
      strokes: [{ operationIndex: 12, start: { x: 130, y: 100 }, end: { x: 250, y: 100 } }],
    })
    expect(guide?.edges.slice(1).every((edge) => edge.status === 'none')).toBe(true)
  })

  it('holds dense competing strokes instead of showing a partial selection as complete', () => {
    const lines = Array.from({ length: 21 }, (_, index) =>
      stroke(index, { x: 120, y: 100 + index / 1000 }, { x: 280, y: 100 + index / 1000 }),
    )
    expect(rasterSourceStrokeGuide(region, image, page, lines)?.edges[0]).toEqual({
      index: 0,
      status: 'held',
      strokes: [],
    })
  })

  it('rejects a stale source or a forged off-edge overlay in the browser', () => {
    const guide = rasterSourceStrokeGuide(region, image, page, [
      stroke(12, { x: 130, y: 100 }, { x: 250, y: 100 }),
    ])
    const payload = {
      source: { sha256: 'a'.repeat(64), page: 3, ...image },
      sourceStrokeGuide: guide,
    }
    expect(rasterSourceStrokeResponse(payload, 1000, 1000, 3, [region], 'a'.repeat(64))).toEqual(
      guide,
    )
    expect(
      rasterSourceStrokeResponse(payload, 1000, 1000, 3, [region], 'b'.repeat(64)),
    ).toBeUndefined()
    const tampered = structuredClone(payload)
    if (!tampered.sourceStrokeGuide?.edges[0]?.strokes[0]) throw new Error('Missing stroke')
    tampered.sourceStrokeGuide.edges[0].strokes[0].start.y = 200
    expect(
      rasterSourceStrokeResponse(tampered, 1000, 1000, 3, [region], 'a'.repeat(64)),
    ).toBeUndefined()
  })

  const decoSource = new URL('../../../../tmp/pdfs/deco-art-dvushka-source.pdf', import.meta.url)
  it.skipIf(!existsSync(decoSource))(
    'keeps real DECO strokes tied to a partial room guide',
    async () => {
      const body = await readFile(decoSource)
      expect(createHash('sha256').update(body).digest('hex')).toBe(
        'fee92486f301e8a40886914c74b9a83ce77747c6ee14dd4ee0a666dec4a647fd',
      )
      const result = await rasterPlanCandidates(body, true, 3, { x: 350, y: 800 })
      expect(result.sourceStrokeGuide?.regionId).toBe('region-31')
      expect(result.sourceStrokeGuide?.edges).toMatchObject([
        { status: 'nearby', strokes: [{ operationIndex: 21674 }] },
        { status: 'nearby', strokes: [{ operationIndex: 21735 }] },
      ])
      // The raster component is still only part of the living room, not accepted floor geometry.
      expect(result.uncertain).toBe(true)
    },
  )
})
