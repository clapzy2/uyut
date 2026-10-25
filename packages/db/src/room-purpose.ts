import { isPlanRoomSourceNumber } from './source-room-number'

const wetRoomName =
  /^(?:ванна|ванная(?: комната)?|[сc]анузел|душевая(?: комната)?|туалет|wc|[сc]\s*\/\s*у|bathroom|baño)$/iu
const roomNumberSuffix = /(?:\s+(?:#|№)?\s*|\s*[#№]\s*)(\d{1,5}(?:\.\d{1,3})?)$/u
const prefixQualifier = /^(?:гостев(?:ой|ая) |основн(?:ой|ая) |совмещ[её]нн(?:ый|ая)\s*)/iu
const qualifier = '(?:гостев(?:ой|ая)|основн(?:ой|ая)|совмещ[её]нн(?:ый|ая))'
const suffixQualifier = new RegExp(`(?: ${qualifier}|\\s*\\(${qualifier}\\))$`, 'iu')
const showerSuffix = /(?: с душем|\s*\(с душем\))$/iu

/** Only a complete room name identifies its purpose; nearby facilities do not. */
export function isWetRoomName(name: string): boolean {
  let normalized = name.trim().replace(/\s+/gu, ' ')
  const number = roomNumberSuffix.exec(normalized)
  if (number) {
    if (!isPlanRoomSourceNumber(Number(number[1]))) return false
    normalized = normalized.slice(0, number.index).trim()
  }
  normalized = normalized.replace(showerSuffix, '')
  // Strip one purpose qualifier; descriptions of adjoining rooms stay unknown.
  normalized = prefixQualifier.test(normalized)
    ? normalized.replace(prefixQualifier, '')
    : normalized.replace(suffixQualifier, '')
  return wetRoomName.test(normalized)
}
