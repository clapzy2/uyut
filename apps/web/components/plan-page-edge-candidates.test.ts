import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { preparePlanPage } from '@/lib/projects/plan-document'
import { nativePageSegments } from '@/lib/projects/plan-pdf-opening-endpoint'
import { sourceEdgeCandidates } from './plan-page-edge-candidates'

const page = { width: 1000, height: 1000 }
const edge = [
  { x: 100, y: 100 },
  { x: 100, y: 300 },
] as const
const segment = (
  operationIndex: number,
  start: { x: number; y: number },
  end: { x: number; y: number },
) => ({ operationIndex, subpathIndex: 0, segmentIndex: 0, start, end })

describe('source edge candidates for manual review', () => {
  it('shows both a matching stroke and a 0.001-unit competing edge without snapping either', () => {
    const result = sourceEdgeCandidates(
      edge,
      [
        segment(10, { x: 100, y: 100 }, { x: 100, y: 300 }),
        segment(11, { x: 100.001, y: 120 }, { x: 100.001, y: 280 }),
      ],
      page,
    )
    expect(result.status).toBe('checked')
    if (result.status !== 'checked') return
    expect(result.candidates.map((candidate) => candidate.segment.operationIndex)).toEqual([10, 11])
    expect(result.candidates[1]?.gapPageUnits).toBeCloseTo(0.001)
    expect(result.candidates[1]?.segment.start.x).toBe(100.001)
  })

  it('excludes unrelated, perpendicular, and non-overlapping strokes', () => {
    const result = sourceEdgeCandidates(
      edge,
      [
        segment(1, { x: 104, y: 100 }, { x: 104, y: 300 }),
        segment(2, { x: 90, y: 200 }, { x: 110, y: 200 }),
        segment(3, { x: 100, y: 310 }, { x: 100, y: 350 }),
      ],
      page,
    )
    expect(result).toEqual({ status: 'checked', candidates: [] })
  })

  it('holds an overfull competing set instead of hiding some sources', () => {
    const segments = Array.from({ length: 21 }, (_, index) =>
      segment(index, { x: 100 + index / 1000, y: 100 }, { x: 100 + index / 1000, y: 300 }),
    )
    expect(sourceEdgeCandidates(edge, segments, page)).toEqual({
      status: 'held',
      reason: 'candidate-limit',
    })
  })

  it('holds invalid and duplicate source data', () => {
    const one = segment(1, { x: 100, y: 100 }, { x: 100, y: 300 })
    expect(sourceEdgeCandidates(edge, [one, one], page).status).toBe('held')
    expect(
      sourceEdgeCandidates(
        [
          { x: 100, y: 100 },
          { x: 100, y: 100 },
        ],
        [one],
        page,
      ),
    ).toEqual({
      status: 'held',
      reason: 'invalid-edge',
    })
  })

  const muhanovaSource = new URL(
    '../../../output/pdf/source-search-20261016/muhanova-original.pdf',
    import.meta.url,
  )
  it.skipIf(!existsSync(muhanovaSource))(
    'keeps the real Muhanova loggia paint edge separate from nearby original strokes',
    async () => {
      const body = await readFile(muhanovaSource)
      expect(createHash('sha256').update(body).digest('hex')).toBe(
        '510480920eab5103181e959c1d847c4a7f29ff88653bfd8930ead5d149141d12',
      )
      const page = await preparePlanPage(body, true, 4, true, true)
      const linework = page.linework
      if (!linework) throw new Error('Missing source PDF linework')
      const result = sourceEdgeCandidates(
        [
          { x: 131.617, y: 137.776 },
          { x: 131.617, y: 211.177 },
        ],
        nativePageSegments(linework),
        { width: linework.pageWidth, height: linework.pageHeight },
      )
      expect(result.status).toBe('checked')
      if (result.status !== 'checked') return
      expect(result.candidates[0]?.segment).toMatchObject({
        operationIndex: 6765,
        start: { x: 131.618, y: 211.177 },
        end: { x: 131.618, y: 137.776 },
      })
      expect(result.candidates[0]?.gapPageUnits).toBeCloseTo(0.00119055)
    },
  )
})
