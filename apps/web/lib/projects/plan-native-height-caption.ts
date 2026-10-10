import { nativeCeilingDatumDeclarationTopic } from './plan-native-height-datum-caption'

export type NativeHeightCaption = {
  valueMm: number
  quantityKind:
    | 'finished-ceiling'
    | 'opening-height'
    | 'beam-level'
    | 'threshold-level'
    | 'unclassified-height'
  datum: 'unspecified' | 'existing-floor' | 'finished-floor'
  issueCodes: string[]
}

// Negation or uncertainty withholds both the object and the reference level.
const qualifiedHeight =
  /(?:^|[^\p{L}\d])(?:не|нет|без|отсутств[а-яё]*|не(?:проверен|извест|уточн|определ|замерен|измерен|подтвержд)[а-яё]*|предполага[а-яё]*|будущ[а-яё]*|планиру[а-яё]*)(?=$|[^\p{L}\d])|\?/iu
const heightTopic =
  /(?:^\s*[hн](?:[12](?=\s|[-–—=:])|(?=\s|[-–—=:]|пр\.?))|высот|натяжн|подвесн|потолок|балк[аи]|отметк|уровень\s+(?:(?:верха|низа)\s+)?порога)/iu
const thresholdLevel =
  /(?:^|[^\p{L}\d])(?:уровень|отметка)\s+(?:(?:верха|низа)\s+)?порога(?=$|[^\p{L}\d])/iu
const quantity =
  /(?:^|[\s=:+−–—-])((?:\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d+)(?:[.,]\d+)?)\s*(мм|см|mm|cm|м|m)(?=$|[\s.,;:)])/giu

function kindOf(text: string): NativeHeightCaption['quantityKind'] {
  if (qualifiedHeight.test(text)) return 'unclassified-height'
  if (/(?:^|[^\p{L}\d])[hн][12](?=\s|[-–—=:])/iu.test(text)) return 'unclassified-height'
  const finished =
    /(?:натяжн|подвесн|чистов|чист)[а-яё]*\s+потол[а-яё]*|потол[а-яё]*\s*[-:–—]?\s+(?:натяжн|подвесн|чистов|чист)[а-яё]*|^(?:натяжной|подвесной)\s*[-=–—:]\s*\d/iu.test(
      text,
    )
  const otherObject = /шкаф|светильн|люстр|гарнитур|мебел/iu.test(text)
  const structural = /плит[а-яё]*|перекрыти[а-яё]*|конструктивн[а-яё]*|толщин/iu.test(text)
  const opening = /(?:[hн]\s*пр\.?|высот[а-яё]*\s+(?:дверного\s+|оконного\s+)?про[её]м)/iu.test(
    text,
  )
  const beam =
    /(?:до\s+(?:низа\s+)?балки|низ\s+балки|(?:уровень|отметка)\s+(?:низа\s+)?балки)/iu.test(text)
  const threshold = thresholdLevel.test(text)
  if (
    Number(finished) + Number(opening) + Number(beam) + Number(threshold) !== 1 ||
    (finished && (structural || otherObject)) ||
    (threshold && (structural || otherObject))
  )
    return 'unclassified-height'
  if (threshold) return 'threshold-level'
  return finished ? 'finished-ceiling' : opening ? 'opening-height' : 'beam-level'
}

/** One literal caption only. No source ownership, floor-level propagation or model acceptance. */
export function nativeHeightCaption(
  text: string,
):
  | { status: 'not-height' }
  | { status: 'unresolved'; code: string }
  | { status: 'observed'; observation: NativeHeightCaption } {
  if (!heightTopic.test(text) && !nativeCeilingDatumDeclarationTopic(text))
    return { status: 'not-height' }
  const matches = [...text.matchAll(quantity)]
  if (matches.length !== 1)
    return {
      status: 'unresolved',
      code: matches.length ? 'multiple-height-quantities' : 'no-literal-unit-qualified-height',
    }
  const match = matches[0] as RegExpMatchArray
  const raw = match[1] as string
  const unit = (match[2] as string).toLocaleLowerCase('ru')
  const prefix = text.slice(0, match.index ?? 0)
  const suffix = text.slice((match.index ?? 0) + match[0].length)
  const rest = `${prefix}${suffix}`.replace(/(?:^|[^\p{L}\d])[hн][12](?=$|\s|[-–—=:])/giu, '')
  if (/\d/u.test(rest)) return { status: 'unresolved', code: 'ambiguous-numeric-height-caption' }

  const beforeNumber = prefix + match[0].slice(0, match[0].indexOf(raw))
  const signedToken = /([+−–—±-](?:\s*[+−–—±-])*)\s*$/u.exec(beforeNumber)?.[1]?.replace(/\s/gu, '')
  if (
    thresholdLevel.test(text) &&
    signedToken !== undefined &&
    !['+', '-', '−'].includes(signedToken)
  )
    return { status: 'unresolved', code: 'ambiguous-height-sign' }
  const sign = /([-−])\s*$/u.exec(beforeNumber)
  const stem = sign ? beforeNumber.slice(0, sign.index).trim() : ''
  const conventionalSeparator = /^(?:[hн][12]?[^=:\d−-]*|натяжн[а-яё]*|подвесн[а-яё]*)$/iu.test(
    stem,
  )
  const negative = Boolean(sign && (sign[1] === '−' || !conventionalSeparator))
  const multiplier = unit === 'м' || unit === 'm' ? 1000 : unit === 'см' || unit === 'cm' ? 10 : 1
  const valueMm =
    Number(raw.replace(/[ \u00a0\u202f]/gu, '').replace(',', '.')) *
    multiplier *
    (negative ? -1 : 1)
  if (!Number.isFinite(valueMm)) return { status: 'unresolved', code: 'invalid-height-quantity' }

  const quantityKind = kindOf(text)
  const existingFloor = /от\s+(?:уровня\s+)?существующего\s+пола/iu.test(text)
  const finishedFloor = /от\s+(?:уровня\s+)?(?:чистого|чистового|готового)\s+пола/iu.test(text)
  const datum =
    qualifiedHeight.test(text) || existingFloor === finishedFloor
      ? 'unspecified'
      : existingFloor
        ? 'existing-floor'
        : 'finished-floor'
  const issueCodes: string[] = []
  if (quantityKind === 'unclassified-height') issueCodes.push('height-role-unclassified')
  if (datum === 'unspecified') issueCodes.push('height-datum-unverified')
  if (existingFloor && finishedFloor) issueCodes.push('ambiguous-height-datum')
  // A signed threshold elevation is not an aperture height or local bottomCm.
  const outsideRange =
    quantityKind === 'threshold-level'
      ? valueMm < -6000 || valueMm > 6000
      : valueMm <= 0 || valueMm > 6000
  if (outsideRange) issueCodes.push('height-outside-model-range')
  return { status: 'observed', observation: { valueMm, quantityKind, datum, issueCodes } }
}
