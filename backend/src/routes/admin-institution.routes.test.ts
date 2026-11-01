import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import express from 'express'
import cookieParser from 'cookie-parser'
import { signAccessToken } from '../test-utils/bearer-token.js'

const { prismaMock, auditMock } = vi.hoisted(() => ({
  prismaMock: { institutionBranding: { findUnique: vi.fn(), upsert: vi.fn() } },
  auditMock: vi.fn(),
}))

vi.mock('../db/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('../services/audit-log.js', () => ({ recordAuditEvent: auditMock }))

import adminInstitutionRoutes from './admin-institution.js'
import { authGuard, requirePermission } from '../middlewares/auth.js'
import { loadInstitutionBranding } from '../services/institution-branding.js'

function app() {
  const a = express()
  a.use(express.json())
  a.use(cookieParser())
  a.use('/admin/institution', authGuard, requirePermission('settings.manage', 'all'), adminInstitutionRoutes)
  return a
}

const tok = (role = 'ADMIN') => signAccessToken({ sub: 'a-1', email: 'a@a.com', role: role as 'ADMIN' })

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP')])
const UPDATED = new Date('2026-11-01T12:00:00.000Z')

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.institutionBranding.findUnique.mockResolvedValue(null)
  prismaMock.institutionBranding.upsert.mockResolvedValue({})
})

describe('configuración de la institución', () => {
  it('sin configurar: sin nombre ni logo', async () => {
    const res = await request(app()).get('/admin/institution').set('Authorization', `Bearer ${tok()}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ name: null, logo: null })
  })

  it('informa el logo sin mandar los bytes', async () => {
    prismaMock.institutionBranding.findUnique.mockResolvedValue({
      name: 'Instituto',
      logoMimeType: 'image/png',
      logoByteSize: 1234,
      updatedAt: UPDATED,
    })
    const res = await request(app()).get('/admin/institution').set('Authorization', `Bearer ${tok()}`)
    expect(res.body).toEqual({
      name: 'Instituto',
      logo: { mimeType: 'image/png', byteSize: 1234, updatedAt: UPDATED.toISOString() },
    })
    expect(prismaMock.institutionBranding.findUnique.mock.calls[0][0].select).not.toHaveProperty('logoBytes')
  })

  it('guarda el nombre y lo audita', async () => {
    const res = await request(app())
      .put('/admin/institution')
      .set('Authorization', `Bearer ${tok()}`)
      .send({ name: '  Instituto de Educación Integral  ' })

    expect(res.status).toBe(200)
    expect(prismaMock.institutionBranding.upsert.mock.calls[0][0].update).toEqual({ name: 'Instituto de Educación Integral' })
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ metadata: { keysChanged: ['institutionName'] } }))
  })

  it('un nombre vacío lo borra', async () => {
    await request(app()).put('/admin/institution').set('Authorization', `Bearer ${tok()}`).send({ name: '  ' })
    expect(prismaMock.institutionBranding.upsert.mock.calls[0][0].update).toEqual({ name: null })
  })

  it('400 con un nombre demasiado largo', async () => {
    const res = await request(app())
      .put('/admin/institution')
      .set('Authorization', `Bearer ${tok()}`)
      .send({ name: 'x'.repeat(121) })
    expect(res.status).toBe(400)
    expect(prismaMock.institutionBranding.upsert).not.toHaveBeenCalled()
  })

  it('sólo con settings.manage: un docente no la ve', async () => {
    const res = await request(app()).get('/admin/institution').set('Authorization', `Bearer ${tok('TEACHER')}`)
    expect(res.status).toBe(403)
  })
})

describe('logo', () => {
  it.each([
    ['image/png', PNG],
    ['image/jpeg', JPEG],
  ])('guarda un %s válido', async (type, body) => {
    const res = await request(app())
      .put('/admin/institution/logo')
      .set('Authorization', `Bearer ${tok()}`)
      .set('Content-Type', type)
      .send(body)

    expect(res.status).toBe(200)
    const data = prismaMock.institutionBranding.upsert.mock.calls[0][0].update
    expect(data).toMatchObject({ logoMimeType: type, logoByteSize: body.length })
    expect(Buffer.isBuffer(data.logoBytes)).toBe(true)
  })

  it('415 ante un SVG: servido inline sería XSS', async () => {
    const res = await request(app())
      .put('/admin/institution/logo')
      .set('Authorization', `Bearer ${tok()}`)
      .set('Content-Type', 'image/svg+xml')
      .send(Buffer.from('<svg><script>alert(1)</script></svg>'))
    expect(res.status).toBe(415)
    expect(prismaMock.institutionBranding.upsert).not.toHaveBeenCalled()
  })

  it('415 ante un WebP: pdfkit no lo sabe dibujar', async () => {
    const res = await request(app())
      .put('/admin/institution/logo')
      .set('Authorization', `Bearer ${tok()}`)
      .set('Content-Type', 'image/png')
      .send(WEBP)
    expect(res.status).toBe(415)
  })

  it('400 si el archivo no es lo que declara', async () => {
    const res = await request(app())
      .put('/admin/institution/logo')
      .set('Authorization', `Bearer ${tok()}`)
      .set('Content-Type', 'image/png')
      .send(JPEG)
    expect(res.status).toBe(400)
  })

  it('400 si llega vacío', async () => {
    const res = await request(app())
      .put('/admin/institution/logo')
      .set('Authorization', `Bearer ${tok()}`)
      .set('Content-Type', 'image/png')
      .send(Buffer.alloc(0))
    expect([400, 415]).toContain(res.status)
    expect(prismaMock.institutionBranding.upsert).not.toHaveBeenCalled()
  })

  it('413 en JSON si supera 1 MB', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(1_100_000)])
    const res = await request(app())
      .put('/admin/institution/logo')
      .set('Authorization', `Bearer ${tok()}`)
      .set('Content-Type', 'image/png')
      .send(big)
    expect(res.status).toBe(413)
    expect(res.body.message).toMatch(/1 MB/)
  })

  it('lo sirve con ETag y responde 304 si no cambió', async () => {
    prismaMock.institutionBranding.findUnique.mockResolvedValue({
      logoBytes: PNG,
      logoMimeType: 'image/png',
      logoByteSize: PNG.length,
      updatedAt: UPDATED,
    })
    const first = await request(app()).get('/admin/institution/logo').set('Authorization', `Bearer ${tok()}`)
    expect(first.status).toBe(200)
    expect(first.headers['content-type']).toBe('image/png')
    expect(first.headers['x-content-type-options']).toBe('nosniff')

    const again = await request(app())
      .get('/admin/institution/logo')
      .set('Authorization', `Bearer ${tok()}`)
      .set('If-None-Match', first.headers.etag)
    expect(again.status).toBe(304)
  })

  it('404 si no hay logo', async () => {
    const res = await request(app()).get('/admin/institution/logo').set('Authorization', `Bearer ${tok()}`)
    expect(res.status).toBe(404)
  })

  it('quitarlo borra los bytes y lo audita', async () => {
    const res = await request(app()).delete('/admin/institution/logo').set('Authorization', `Bearer ${tok()}`)
    expect(res.status).toBe(200)
    expect(prismaMock.institutionBranding.upsert.mock.calls[0][0].update).toEqual({
      logoBytes: null,
      logoMimeType: null,
      logoByteSize: null,
    })
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ metadata: { keysChanged: ['institutionLogo'] } }))
  })

  it('500 en JSON si falla la base', async () => {
    prismaMock.institutionBranding.findUnique.mockRejectedValue(new Error('db down'))
    const res = await request(app()).get('/admin/institution/logo').set('Authorization', `Bearer ${tok()}`)
    expect(res.status).toBe(500)
  })
})

describe('loadInstitutionBranding', () => {
  it('trae el nombre y los bytes para el boletín', async () => {
    prismaMock.institutionBranding.findUnique.mockResolvedValue({ name: ' Instituto ', logoBytes: PNG })
    const branding = await loadInstitutionBranding()
    expect(branding.name).toBe('Instituto')
    expect(Buffer.isBuffer(branding.logo)).toBe(true)
  })

  it('sin configurar, todo null', async () => {
    expect(await loadInstitutionBranding()).toEqual({ name: null, logo: null })
  })
})
