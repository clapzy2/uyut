// Редакторский шаблон PDF проекта: HTML для печати в Chromium, шрифты и колонтитул.
export { fontFaceCss } from './fonts'
export { formatArea, formatPrice, pluralItems, pluralPositions } from './format'
export { footerTemplate, renderProjectHtml } from './template'
export type {
  PdfContact,
  PdfData,
  PdfImage,
  PdfObject,
  PdfRoom,
  PdfShoppingGroup,
  PdfShoppingItem,
} from './types'
