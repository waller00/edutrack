import morgan from 'morgan'

// Mantener intactos los parámetros del request; sanear sólo su representación.
morgan.token('safe-url', (req) => (req.originalUrl || req.url || '').split('?')[0])

export function accessLog(stream?: { write: (line: string) => void }) {
  return morgan(':method :safe-url :status :response-time ms - :res[content-length]', { stream })
}
