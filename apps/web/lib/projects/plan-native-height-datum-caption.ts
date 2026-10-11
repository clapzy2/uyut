export type NativeCeilingDatumDeclaration = {
  scope: 'apartment-finished-ceilings'
  datum: 'existing-floor' | 'finished-floor'
  minimumMm: number
  maximumMm: number
}

/** A local height reference is not an apartment-wide elevation or a common zero. */
export function nativeFinishedFloorHeightReference(text: string): boolean {
  if (text.length > 200 || /[^\p{L}\d. \t\r\n\u00a0\u202f]/u.test(text)) return false
  const normalized = text.replace(/[ \t\r\n\u00a0\u202f]+/gu, ' ').trim()
  return /^(?:[1-9]\d?\. )?Все отметки высот на замере даны от чистового пола\.?$/iu.test(
    normalized,
  )
}

export function nativeFinishedFloorHeightReferenceTopic(text: string): boolean {
  if (text.length > 200) return false
  const topic = text.replace(/\s+/gu, ' ').replace(/[\p{Cc}\p{Cf}]/gu, '')
  return (
    /отметки? высот/iu.test(topic) &&
    /(?:чистового|существующего|чернового|готового) пола/iu.test(topic)
  )
}

// One closed source-note grammar, not a general prose or numeric extractor.
const declaration =
  /^(?:[1-9]\d?\. )?потолок в квартире ?[-–—:] ?(?:натяжной|подвесной|чистовой|чистый), отметки потолка в пределах: от (\d{1,4}(?:[.,]\d{1,3})?) ?(мм|см|mm|cm|м|m) до (\d{1,4}(?:[.,]\d{1,3})?) ?(мм|см|mm|cm|м|m) от уровня (существующего|чистого|чистового|готового) пола\.?$/iu

function millimeters(raw: string, unit: string): number {
  const multiplier = /^(?:м|m)$/iu.test(unit) ? 1000 : /^(?:см|cm)$/iu.test(unit) ? 10 : 1
  return Number(raw.replace(',', '.')) * multiplier
}

/**
 * Select potentially competing apartment ceiling notes, including unsupported
 * qualifications. Topic detection never makes a declaration acceptable.
 */
export function nativeCeilingDatumDeclarationTopic(text: string): boolean {
  if (text.length > 200) return false
  // Remove hidden controls only for conservative topic selection. The strict
  // declaration parser still rejects them in the original source text.
  const topic = text.replace(/\s+/gu, ' ').replace(/[\p{Cc}\p{Cf}]/gu, '')
  const ceiling = /потол(?:ок|к)[а-яё]*|потолочн[а-яё]*/iu.test(topic)
  const apartment = /квартир[а-яё]*/iu.test(topic)
  const reference =
    /отметк|уров|предел|высот|(?:^|[^\p{L}])пол(?:а|ов|ы|у|ом)?(?=$|[^\p{L}])/iu.test(topic)
  return ceiling && apartment && reference
}

/**
 * A reference kind and a declared ceiling range only. This does not establish a
 * shared zero, coplanar floors, source-object ownership or accepted model heights.
 */
export function nativeCeilingDatumDeclaration(text: string): NativeCeilingDatumDeclaration | null {
  if (text.length > 200) return null
  // Permit source line wrapping and ordinary PDF spaces, but not hidden controls
  // or separators which could change the visible reading of this declaration.
  if (/[^\p{L}\d.,:–—\- \t\r\n\u00a0\u202f]/u.test(text)) return null
  const normalized = text.replace(/[ \t\r\n\u00a0\u202f]+/gu, ' ').trim()
  const match = declaration.exec(normalized)
  if (!match) return null

  const minimumMm = millimeters(match[1] as string, match[2] as string)
  const maximumMm = millimeters(match[3] as string, match[4] as string)
  if (
    !Number.isFinite(minimumMm) ||
    !Number.isFinite(maximumMm) ||
    minimumMm < 1 ||
    maximumMm > 6000 ||
    minimumMm > maximumMm
  )
    return null

  return {
    scope: 'apartment-finished-ceilings',
    datum:
      match[5]?.toLocaleLowerCase('ru') === 'существующего' ? 'existing-floor' : 'finished-floor',
    minimumMm,
    maximumMm,
  }
}
