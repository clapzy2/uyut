import { dirname, join } from 'node:path'

export function pdfStandardFontDataUrl(moduleUrl: string): string {
  // Resolve at runtime: Turbopack replaces imported createRequire.resolve with a module ID.
  // PDF.js uses the same builtin-module access for its native Node dependencies.
  const require_ = process.getBuiltinModule('module').createRequire(moduleUrl)
  const packagePath = require_.resolve('pdfjs-dist/package.json')
  return `${join(dirname(packagePath), 'standard_fonts').replaceAll('\\', '/')}/`
}
