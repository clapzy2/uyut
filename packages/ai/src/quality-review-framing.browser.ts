// Native image decoding is available in the review worker only.
export async function hasComparableFraming(_original: Buffer, _result: Buffer): Promise<boolean> {
  return false
}

export async function prepareLocalizedOpeningCheck(
  _original: Buffer,
  _result: Buffer,
): Promise<((box: readonly number[]) => boolean) | null> {
  return null
}
