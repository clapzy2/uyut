/** Two measured spans describe an envelope, not the free-floor boundary. */
export function assessPdfAreaEnvelope(
  widthMm: number,
  depthMm: number,
  signedAreaM2: number,
  roundingToleranceM2 = 0.01,
) {
  if (
    ![widthMm, depthMm, signedAreaM2, roundingToleranceM2].every(Number.isFinite) ||
    widthMm <= 0 ||
    depthMm <= 0 ||
    signedAreaM2 <= 0 ||
    roundingToleranceM2 < 0
  ) {
    throw new Error('Invalid measured envelope or signed area')
  }

  const rectangleM2 = (widthMm * depthMm) / 1_000_000
  const differenceM2 = rectangleM2 - signedAreaM2
  return {
    rectangleM2,
    signedAreaM2,
    differenceM2,
    areaStatus: Math.abs(differenceM2) > roundingToleranceM2 ? 'mismatch' : 'within-rounding',
    contourStatus: 'unresolved' as const,
  }
}
