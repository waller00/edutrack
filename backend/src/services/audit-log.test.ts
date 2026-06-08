import { describe, it, expect, vi } from 'vitest'

vi.mock('../db/prisma.js', () => ({ prisma: {} }))

import { parseAuditActionFilter, getAuditActionCatalog, clientIpFromRequest, AUDIT_ACTION_LABELS } from './audit-log.js'
import { AuditAction } from '@prisma/client'

describe('audit-log', () => {
  it('parseAuditActionFilter: acepta acción válida, ignora inválida/undefined', () => {
    const valid = Object.values(AuditAction)[0] as string
    expect(parseAuditActionFilter(valid)).toBe(valid)
    expect(parseAuditActionFilter('NO_EXISTE')).toBeUndefined()
    expect(parseAuditActionFilter(undefined)).toBeUndefined()
  })

  it('getAuditActionCatalog: devuelve code+label para cada acción etiquetada', () => {
    const cat = getAuditActionCatalog()
    expect(cat.length).toBe(Object.keys(AUDIT_ACTION_LABELS).length)
    expect(cat[0]).toHaveProperty('code')
    expect(cat[0]).toHaveProperty('label')
  })

  it('clientIpFromRequest: prioriza x-forwarded-for, limpia IPv6-mapped, o undefined', () => {
    expect(clientIpFromRequest({ headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }, ip: '9.9.9.9' })).toBe('1.2.3.4')
    expect(clientIpFromRequest({ headers: {}, ip: '::ffff:10.0.0.1' })).toBe('10.0.0.1')
    expect(clientIpFromRequest({ headers: {}, ip: undefined as unknown as string })).toBeUndefined()
  })
})
