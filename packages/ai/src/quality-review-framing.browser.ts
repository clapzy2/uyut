// Native image decoding is available in the review worker only.
export async function cropOpeningSite(_image: Buffer, _box: readonly number[]): Promise<Buffer> {
  throw new Error('Opening site decoding is unavailable')
}

export async function hasComparableFraming(_original: Buffer, _result: Buffer): Promise<boolean> {
  return false
}

export async function prepareLocalizedOpeningCheck(
  _original: Buffer,
  _result: Buffer,
): Promise<((box: readonly number[]) => boolean) | null> {
  return null
}
