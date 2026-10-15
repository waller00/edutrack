import { expect, it } from 'vitest'
import express from 'express'
import request from 'supertest'
import { accessLog } from './access-log.js'

it('omite parámetros, cabeceras y Referer del log sin alterar el callback', async () => {
  const lines: string[] = []
  const app = express()
  app.use(accessLog({ write: (line) => { lines.push(line) } }))
  app.get('/auth/callback', (req, res) => res.json({ code: req.query.code, state: req.query.state }))
  const response = await request(app).get('/auth/callback?code=CODE_SECRET&state=STATE_SECRET')
    .set('Referer', 'https://auth.test/?id_token_hint=ID_SECRET')
    .set('Authorization', 'Bearer BEARER_SECRET').set('Cookie', 'sid=SID_SECRET')
  expect(response.body).toEqual({ code: 'CODE_SECRET', state: 'STATE_SECRET' })
  expect(lines).toHaveLength(1)
  expect(lines[0]).toMatch(/^GET \/auth\/callback 200 /)
  expect(lines[0]).not.toContain('SECRET')
  expect(lines[0]).not.toContain('?')
})
