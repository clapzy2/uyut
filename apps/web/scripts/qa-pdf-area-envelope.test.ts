import { describe, expect, it } from 'vitest'
import { assessPdfAreaEnvelope } from './qa-pdf-area-envelope'

describe('source-reviewed PDF area envelope', () => {
  it('keeps a discrepant measured rectangle unresolved', () => {
    const result = assessPdfAreaEnvelope(9655, 7135, 68.56)
    expect(result).toMatchObject({
      rectangleM2: 68.888425,
      signedAreaM2: 68.56,
      areaStatus: 'mismatch',
      contourStatus: 'unresolved',
    })
    expect(result.differenceM2).toBeCloseTo(0.328425, 6)
  })

  it('does not certify a contour even when its rectangular envelope has the same area', () => {
    expect(assessPdfAreaEnvelope(5000, 4000, 20)).toMatchObject({
      areaStatus: 'within-rounding',
      contourStatus: 'unresolved',
    })
  })

  it('rejects missing, zero or non-finite measurements', () => {
    expect(() => assessPdfAreaEnvelope(0, 4000, 20)).toThrow()
    expect(() => assessPdfAreaEnvelope(5000, 4000, Number.NaN)).toThrow()
  })
})
