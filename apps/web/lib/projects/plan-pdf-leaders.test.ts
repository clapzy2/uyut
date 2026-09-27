import { describe, expect, it } from 'vitest'
import labels from '../../../../docs/qa/fixtures/apartment-74-77-native-labels.json'
import native from '../../../../docs/qa/fixtures/apartment-74-77-native-leaders.json'
import { pdfCalloutLeader } from './plan-pdf-leaders'
import type { PdfLinework, PdfVectorPath } from './plan-pdf-linework'

const work: PdfLinework = {
  coordinateSystem: 'page-0-1000',
  pageWidth: native.pageWidth,
  pageHeight: native.pageHeight,
  paths: native.paths as PdfVectorPath[],
  skippedCurves: 0,
  unsupportedPaths: 0,
  unsupportedContexts: 0,
  clippedPaths: 0,
  truncated: false,
}
const label = { x: 526, y: 643 }
const line = (points: PdfVectorPath['points']): PdfVectorPath => ({
  operationIndex: 9000,
  subpathIndex: 0,
  paint: 'stroke',
  closed: false,
  points,
})

describe('native ceiling leader tracing, not automatic room ownership', () => {
  it.each([
    [182, { x: 691.008, y: 483.823 }],
    [184, { x: 525.277, y: 364.801 }],
    [186, { x: 767.134, y: 225.308 }],
    [188, { x: 691.008, y: 633.423 }],
  ])('traces native label %i through connected vector endpoints to its arrow tip', (index, tip) => {
    const item = labels.items.find((item) => item.index === index)
    expect(item).toBeDefined()
    if (!item) throw new Error('Missing native label')
    const leader = pdfCalloutLeader(work, item)
    expect(leader).toMatchObject({ status: 'candidate', arrow: { tip }, roomSourceNumber: null })
  })

  it('does not infer a room from a label outside its room or from a valid arrow connection', () => {
    const leader = pdfCalloutLeader(work, label)
    expect(leader).toMatchObject({ status: 'candidate', roomSourceNumber: null })
    if (leader.status !== 'candidate') throw new Error('Expected candidate')
    expect(leader.arrow.tip.x - label.x).toBeGreaterThan(160)
  })

  it('does not bridge a missing stem to the closest arrow', () => {
    const paths = work.paths.filter((path) => path.operationIndex !== 4192)
    expect(pdfCalloutLeader({ ...work, paths }, label).status).toBe('unresolved')
  })

  it('does not connect crossed lines without a shared endpoint', () => {
    const crossing = line([
      { x: 630, y: 620 },
      { x: 630, y: 650 },
    ])
    expect(pdfCalloutLeader({ ...work, paths: [...work.paths, crossing] }, label)).toMatchObject({
      status: 'candidate',
      arrow: { tip: { x: 691.008, y: 633.423 } },
    })
  })

  it('does not select one path from a branched leader', () => {
    const branch = line([
      { x: 621.819, y: 633.423 },
      { x: 630, y: 620 },
    ])
    expect(pdfCalloutLeader({ ...work, paths: [...work.paths, branch] }, label)).toMatchObject({
      status: 'ambiguous',
      roomSourceNumber: null,
    })
  })

  it('does not choose the first of overlapping label boxes', () => {
    const original = work.paths.find((path) => path.operationIndex === 4193)
    if (!original) throw new Error('Missing native box')
    const paths = [...work.paths, { ...original, operationIndex: 9001 }]
    expect(pdfCalloutLeader({ ...work, paths }, label).status).toBe('ambiguous')
  })

  it('does not stop at a candidate arrow while ignoring another branch at its base', () => {
    const branch = line([
      { x: 680.909, y: 633.423 },
      { x: 700, y: 620 },
    ])
    expect(pdfCalloutLeader({ ...work, paths: [...work.paths, branch] }, label).status).toBe(
      'ambiguous',
    )
  })

  it('does not silently ignore a second disconnected leader leaving the same label box', () => {
    const second = line([
      { x: 611.72, y: 640 },
      { x: 650, y: 660 },
    ])
    expect(pdfCalloutLeader({ ...work, paths: [...work.paths, second] }, label).status).toBe(
      'ambiguous',
    )
  })

  it.each([{ truncated: true }, { unsupportedContexts: 1 }, { unsupportedPaths: 1 }])(
    'does not use a partially decoded vector layer: %j',
    (partial) => {
      expect(pdfCalloutLeader({ ...work, ...partial }, label)).toMatchObject({
        status: 'unresolved',
        reason: 'incomplete-vector-layer',
        roomSourceNumber: null,
      })
    },
  )

  it('does not classify an unfilled triangle as a filled arrowhead', () => {
    const paths = work.paths.map((path) =>
      path.operationIndex === 4190 ? { ...path, paint: 'stroke' as const } : path,
    )
    expect(pdfCalloutLeader({ ...work, paths }, label).status).toBe('unresolved')
  })

  it('does not classify a wide triangular decoration as a narrow arrowhead', () => {
    const paths = work.paths.map((path) =>
      path.operationIndex === 4190
        ? {
            ...path,
            points: [
              { x: 680.909, y: 620 },
              { x: 691.008, y: 633.423 },
              { x: 680.909, y: 646.846 },
            ],
          }
        : path,
    )
    expect(pdfCalloutLeader({ ...work, paths }, label).status).toBe('unresolved')
  })

  it.each([
    { x: Number.NaN, y: 643 },
    { x: -1, y: 643 },
    { x: 526, y: 1001 },
  ])('rejects an invalid label position %j', (position) => {
    expect(pdfCalloutLeader(work, position)).toMatchObject({
      status: 'unresolved',
      reason: 'invalid-page-coordinates',
    })
  })
})
