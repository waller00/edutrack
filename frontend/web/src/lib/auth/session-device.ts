/**
 * Nombre legible del dispositivo de una sesión ("Chrome en Windows") a partir del navegador con
 * que se ingresó. Sólo orienta a la persona: el `User-Agent` lo escribe el navegador.
 */
const BROWSERS: Array<[RegExp, string]> = [
  [/Edg(A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
]

const SYSTEMS: Array<[RegExp, string]> = [
  [/Android/, 'Android'],
  [/iPhone|iPod/, 'iPhone'],
  [/iPad/, 'iPad'],
  [/Windows/, 'Windows'],
  [/Mac OS X|Macintosh/, 'Mac'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
]

function firstMatch(userAgent: string, table: Array<[RegExp, string]>): string | null {
  return table.find(([pattern]) => pattern.test(userAgent))?.[1] ?? null
}

export function describeSessionDevice(userAgent: string | null | undefined): string {
  if (!userAgent) return 'Dispositivo sin identificar'
  const browser = firstMatch(userAgent, BROWSERS)
  const system = firstMatch(userAgent, SYSTEMS)
  if (browser && system) return `${browser} en ${system}`
  return browser ?? system ?? 'Dispositivo sin identificar'
}
