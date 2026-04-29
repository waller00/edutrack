import type { LivenessSessionStatus } from '@prisma/client'
import { prisma } from './prisma.js'
import { diditStringToLivenessStatus } from './didit-status.js'

export const DIDIT_DECISION_BASE = 'https://verification.didit.me/v3/session/'

function isTerminal(s: LivenessSessionStatus) {
  return s === 'APPROVED' || s === 'DECLINED' || s === 'ABANDONED' || s === 'EXPIRED' || s === 'ERROR'
}

/**
 * Si el webhook no actualizó la fila, consultamos el estado en Didit y persistimos (misma lógica de fusión que el webhook).
 */
export async function syncLivenessSessionFromDiditApi(internalRowId: string): Promise<void> {
  const apiKey = (process.env.DIDIT_API_KEY || '').trim()
  if (!apiKey) return

  const found = await prisma.livenessSession.findUnique({ where: { id: internalRowId } })
  if (!found?.diditSessionId?.trim()) return

  let body: { status?: string }
  try {
    const url = `${DIDIT_DECISION_BASE}${encodeURIComponent(found.diditSessionId.trim())}/decision/`
    const dr = await fetch(url, { headers: { 'x-api-key': apiKey } })
    const text = await dr.text()
    try {
      body = text ? JSON.parse(text) : {}
    } catch {
      return
    }
    if (!dr.ok) {
      console.warn('[Didit sync decision]', dr.status, text?.slice(0, 200))
      return
    }
  } catch (e) {
    console.warn('[Didit sync decision] fetch', e)
    return
  }

  const raw = body.status
  const incoming = diditStringToLivenessStatus(raw)
  let merged: LivenessSessionStatus = incoming
  if (found.status === 'APPROVED') {
    merged = 'APPROVED'
  } else if (incoming === 'PENDING' && isTerminal(found.status)) {
    merged = found.status
  }
  if (merged === found.status) return

  await prisma.livenessSession.update({
    where: { id: found.id },
    data: {
      status: merged,
      diditStatusRaw: typeof raw === 'string' ? raw : found.diditStatusRaw,
    },
  })
}

/** Lee el JSON completo de decision (OCR dentro de id_verifications, etc.). */
export async function fetchDiditDecisionJson(diditSessionId: string): Promise<unknown | null> {
  const apiKey = (process.env.DIDIT_API_KEY || '').trim()
  if (!apiKey || !diditSessionId.trim()) return null
  try {
    const url = `${DIDIT_DECISION_BASE}${encodeURIComponent(diditSessionId.trim())}/decision/`
    const dr = await fetch(url, { headers: { 'x-api-key': apiKey } })
    const text = await dr.text()
    if (!dr.ok) {
      console.warn('[Didit fetch decision]', dr.status, text?.slice(0, 240))
      return null
    }
    return text ? JSON.parse(text) : null
  } catch (e) {
    console.warn('[Didit fetch decision]', e)
    return null
  }
}
