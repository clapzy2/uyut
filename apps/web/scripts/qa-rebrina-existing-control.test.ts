import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { preparePlanPage } from '../lib/projects/plan-document'
import { pdfNativePageDimensionChain } from '../lib/projects/plan-pdf-dimension-chain'
import { reviewedChains, sourceSha256, verifySurveyControls } from './qa-rebrina-existing-control'

const pdfPath = resolve('../../output/pdf/source-search-20261003/rebrina-original.pdf')

// This is a local source regression. The copyrighted PDF is not a committed test fixture.
describe.skipIf(!existsSync(pdfPath))('Rebrina existing-state source controls', () => {
  async function source() {
    const page = await preparePlanPage(await readFile(pdfPath), true, 3, true)
    if (!page.linework || !page.image.planText) throw new Error('Missing source data')
    return { work: page.linework, labels: JSON.parse(page.image.planText) }
  }

  it('checks three rooms with 24 native spans and five connected tilted chains', async () => {
    const { work, labels } = await source()
    const result = verifySurveyControls(work, labels)
    expect(result.spanChecks).toHaveLength(24)
    expect(result.chainChecks).toHaveLength(5)
    expect([...new Set(result.chainChecks.map((chain) => chain.room))]).toEqual([5, 6, 7])
    expect(result.wholeRoomContours).toBe('not-reconstructed')
    expect(result.extraction.clippedPaths).toBe(532)
    expect(
      result.clippedControlEnvelopes.map((control) => control.overlappingClippedPaths),
    ).toEqual([154, 85, 83])
    expect(result.areaConflict.differenceM2).toBe(0.64)
    expect(result.chainChecks.every((chain) => chain.alignedVerifier.status === 'candidate')).toBe(
      true,
    )
  })

  it('rejects a replaced diagonal label', async () => {
    const { work, labels } = await source()
    labels[68].text = '7 965'
    expect(() => verifySurveyControls(work, labels)).toThrow('Dimension text 68 changed')
  })

  it('rejects a shifted native dimension endpoint', async () => {
    const { work, labels } = await source()
    const path = work.paths.find((item) => item.operationIndex === 7159)
    if (!path?.points[0]) throw new Error('Missing test span')
    path.points[0].x += 1
    expect(() => verifySurveyControls(work, labels)).toThrow('Native span 7159 changed')
  })

  it('rejects a label from another span even if the printed value matches', async () => {
    const { work, labels } = await source()
    labels[63] = { ...labels[81] }
    expect(() => verifySurveyControls(work, labels)).toThrow(
      'Label 63 is not beside its reviewed span',
    )
  })

  it('rejects a page aspect ratio inconsistent with the diagonal calibration', async () => {
    const { work, labels } = await source()
    work.pageWidth *= 1.2
    expect(() => verifySurveyControls(work, labels)).toThrow()
  })

  it('keeps the bedroom area conflict as a required source control', async () => {
    const { work, labels } = await source()
    labels[36].text = '12,1'
    expect(() => verifySurveyControls(work, labels)).toThrow(
      'Bedroom 1 area conflict evidence changed',
    )
  })

  it('accepts each real chain in reverse input order without replacing native endpoints', async () => {
    const { work, labels } = await source()
    for (const chain of reviewedChains) {
      const result = pdfNativePageDimensionChain(
        work,
        { sha256: sourceSha256, pdfPage: 3, state: 'existing' },
        [...chain.indexes].reverse().map((index) => ({ ...labels[index], index })),
        chain.totalMm,
        'aligned',
      )
      expect(result.status).toBe('candidate')
      if (result.status !== 'candidate') throw new Error(result.reason)
      for (const segment of result.segments) {
        const native = work.paths.find(
          (path) => path.points.includes(segment.start) && path.points.includes(segment.end),
        )
        expect(native).toBeDefined()
      }
    }
  })

  it.each([
    ['missing-tick', 'unresolved', 'no-connected-dimension-line'],
    ['shifted-tick', 'unresolved', 'no-connected-dimension-line'],
    ['one-sided-tick', 'unresolved', 'no-connected-dimension-line'],
    ['duplicate-tick', 'ambiguous', 'branched-dimension-line'],
    ['duplicate-rail', 'ambiguous', 'multiple-dimension-lines'],
    ['branch', 'ambiguous', 'branched-dimension-line'],
    ['wrong-886', 'unresolved', 'disconnected-dimension-chain'],
    ['redistributed-values', 'unresolved', 'dimension-scale-conflict'],
  ])('aligned mode refuses the real-source %s mutation', async (mutation, status, reason) => {
    const { work, labels } = await source()
    const rail = work.paths.find((path) => path.operationIndex === 7631)
    const tick = work.paths.find((path) => path.operationIndex === 7637)
    if (!rail?.points[0] || !tick?.points[0]) throw new Error('Missing source rail or tick')
    switch (mutation) {
      case 'missing-tick':
        work.paths = work.paths.filter((path) => path !== tick)
        break
      case 'shifted-tick':
        tick.points = tick.points.map((point) => ({ ...point, x: point.x + 1 }))
        break
      case 'one-sided-tick':
        tick.points = [rail.points[0], tick.points[0]]
        break
      case 'duplicate-tick':
        work.paths.push({ ...tick, operationIndex: 99991 })
        break
      case 'duplicate-rail':
        work.paths.push({ ...rail, operationIndex: 99992 })
        break
      case 'branch':
        work.paths.push({
          ...rail,
          operationIndex: 99993,
          points: [rail.points[0], { x: rail.points[0].x - 2, y: rail.points[0].y + 2 }],
        })
        break
      case 'wrong-886':
        labels[81] = { ...labels[63] }
        break
      case 'redistributed-values':
        labels[80].text = '1 861'
        labels[82].text = '3 363'
        break
      default:
        throw new Error(`Unknown mutation ${mutation}`)
    }
    expect(
      pdfNativePageDimensionChain(
        work,
        { sha256: sourceSha256, pdfPage: 3, state: 'existing' },
        [80, 81, 82].map((index) => ({ ...labels[index], index })),
        6110,
        'aligned',
      ),
    ).toEqual({ status, reason })
  })
})
