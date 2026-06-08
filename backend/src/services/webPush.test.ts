import { describe, it, expect, afterEach, vi } from 'vitest'

vi.mock('../db/prisma.js', () => ({ prisma: { webPushSubscription: { findMany: vi.fn() } } }))
vi.mock('web-push', () => ({ default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() } }))

import { isWebPushConfigured, getVapidPublicKey, sendWebPushPayloadToUser } from './webPush.js'

describe('webPush', () => {
  const orig = { ...process.env }
  afterEach(() => {
    process.env = { ...orig }
  })

  it('isWebPushConfigured / getVapidPublicKey reflejan el entorno', () => {
    delete process.env.VAPID_PUBLIC_KEY
    delete process.env.VAPID_PRIVATE_KEY
    delete process.env.VAPID_SUBJECT
    expect(isWebPushConfigured()).toBe(false)
    expect(getVapidPublicKey()).toBeNull()

    process.env.VAPID_PUBLIC_KEY = 'pub'
    process.env.VAPID_PRIVATE_KEY = 'priv'
    process.env.VAPID_SUBJECT = 'mailto:a@b.com'
    expect(isWebPushConfigured()).toBe(true)
    expect(getVapidPublicKey()).toBe('pub')
  })

  it('sendWebPushPayloadToUser: sin configurar devuelve 0/0 sin tocar la DB', async () => {
    delete process.env.VAPID_PUBLIC_KEY
    expect(await sendWebPushPayloadToUser('u1', { title: 't', body: 'b' })).toEqual({ sent: 0, failed: 0 })
  })
})
