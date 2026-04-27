import { prisma } from './prisma.js'

const DEFAULT_ID = 'default'

export function isDiditConfigured() {
  const key = (process.env.DIDIT_API_KEY || '').trim()
  const wid = (process.env.DIDIT_WORKFLOW_ID || '').trim()
  return Boolean(key && wid)
}

export async function getOrCreateSystemSettings() {
  return prisma.systemSettings.upsert({
    where: { id: DEFAULT_ID },
    create: { id: DEFAULT_ID, livenessCheckEnabled: false },
    update: {},
  })
}
