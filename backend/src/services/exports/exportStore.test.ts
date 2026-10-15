import { afterEach, describe, expect, it, vi } from 'vitest'
import { EXPORT_TTL_MS, createPendingExport, getExport, markDone } from './exportStore.js'

describe('exportStore', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('guarda la exportación terminada para descargarla', () => {
    const id = createPendingExport({ format: 'CSV', reportKey: 'k', filename: 'a.csv', contentType: 'text/csv' })
    markDone(id, Buffer.from('a,b'))
    expect(getExport(id)).toMatchObject({ status: 'DONE', filename: 'a.csv' })
  })

  it('libera el archivo cuando vence: no se acumulan en memoria', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-13T10:00:00.000Z'))
    const id = createPendingExport({ format: 'PDF', reportKey: 'k', filename: 'a.pdf', contentType: 'application/pdf' })
    markDone(id, Buffer.alloc(1024))

    vi.setSystemTime(new Date(Date.now() + EXPORT_TTL_MS - 1000))
    expect(getExport(id)).not.toBeNull()

    vi.setSystemTime(new Date(Date.now() + 2000))
    expect(getExport(id)).toBeNull()
  })
})
