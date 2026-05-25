'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Fingerprint, Loader2 } from 'lucide-react'
import { api } from '@/lib/api/client'
import { PendingButtonContent } from '@/components/common/PendingButtonContent'

type BiometricDevice = { id: string; code: string; name: string; admsSerial?: string | null }
type BiometricMapping = {
  id: string
  deviceUserId: string
  device: { id: string; code: string; name: string }
}
type LinkRequest = {
  id: string
  status: 'WAITING_PUNCH' | 'PENDING_CONFIRM' | 'EXPIRED' | 'CANCELLED' | 'CONFIRMED'
  candidateDeviceUserId?: string | null
  expiresAt: string
  device: BiometricDevice
}

export default function BiometricLinkSection({
  role,
  targetUserId,
  targetUserName,
  onChanged,
}: {
  role?: string
  targetUserId?: string
  targetUserName?: string
  onChanged?: () => void
}) {
  const [mapping, setMapping] = useState<BiometricMapping | null>(null)
  const [linkRequest, setLinkRequest] = useState<LinkRequest | null>(null)
  const [devices, setDevices] = useState<BiometricDevice[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState('')
  const [ttlSeconds, setTtlSeconds] = useState(120)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const isAdminMode = Boolean(targetUserId)
  const isStudent = !isAdminMode && role === 'STUDENT'
  const targetBase = targetUserId ? `/biometric/admin/users/${targetUserId}/biometric` : '/biometric'
  const activePath = targetUserId ? targetBase : '/biometric/link-requests/active'
  const mappingDeletePath = targetUserId ? `${targetBase}/mapping` : '/biometric/me/mapping'
  const linkRequestsPath = targetUserId ? `${targetBase}/link-requests` : '/biometric/link-requests'

  const refresh = useCallback(async () => {
    try {
      const [activeRes, devicesRes] = await Promise.all([
        api(activePath) as Promise<{
          linkRequest: LinkRequest | null
          mapping: BiometricMapping | null
          ttlSeconds: number
        }>,
        api('/biometric/devices') as Promise<{ devices: BiometricDevice[] }>,
      ])
      setLinkRequest(activeRes.linkRequest)
      setMapping(activeRes.mapping)
      setTtlSeconds(activeRes.ttlSeconds ?? 120)
      setDevices(devicesRes.devices ?? [])
      if (devicesRes.devices?.length === 1) {
        setSelectedDeviceId(devicesRes.devices[0]!.id)
      }
    } catch {
      setMsg('No se pudo cargar la información del lector biométrico.')
    } finally {
      setLoading(false)
    }
  }, [activePath])

  useEffect(() => {
    if (isStudent) {
      setLoading(false)
      return
    }
    void refresh()
  }, [isStudent, refresh])

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    const active =
      linkRequest?.status === 'WAITING_PUNCH' || linkRequest?.status === 'PENDING_CONFIRM'
    if (!active) return
    pollRef.current = setInterval(() => {
      void refresh()
    }, 2500)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [linkRequest?.status, refresh])

  async function startLink() {
    setMsg('')
    setBusy(true)
    try {
      const body: { deviceId?: string } = {}
      if (devices.length > 1 && selectedDeviceId) body.deviceId = selectedDeviceId
      await api(linkRequestsPath, { method: 'POST', body: JSON.stringify(body) })
      await refresh()
      setMsg(isAdminMode ? 'Pedile al usuario que marque en el lector elegido.' : 'Ahora marcá en el lector con tu huella registrada en el equipo.')
    } catch (e: unknown) {
      const err = e as { message?: string }
      setMsg(err?.message || 'No se pudo iniciar la vinculación.')
    } finally {
      setBusy(false)
    }
  }

  async function confirmLink() {
    if (!linkRequest?.id) return
    setBusy(true)
    setMsg('')
    try {
      const res = (await api(`${linkRequestsPath}/${linkRequest.id}/confirm`, {
        method: 'POST',
      })) as { message?: string }
      await refresh()
      onChanged?.()
      setMsg(res.message || 'Huella vinculada correctamente.')
    } catch (e: unknown) {
      const err = e as { message?: string }
      setMsg(err?.message || 'No se pudo confirmar.')
    } finally {
      setBusy(false)
    }
  }

  async function cancelLink() {
    if (!linkRequest?.id) return
    setBusy(true)
    try {
      await api(`${linkRequestsPath}/${linkRequest.id}/cancel`, { method: 'POST' })
      await refresh()
      setMsg('Vinculación cancelada.')
    } catch {
      setMsg('No se pudo cancelar.')
    } finally {
      setBusy(false)
    }
  }

  async function unlink() {
    if (!globalThis.confirm(isAdminMode ? '¿Desvincular el lector biométrico de este usuario?' : '¿Desvincular tu cuenta del lector biométrico?')) return
    setBusy(true)
    try {
      await api(mappingDeletePath, { method: 'DELETE' })
      await refresh()
      onChanged?.()
      setMsg('Vínculo eliminado.')
    } catch {
      setMsg('No se pudo desvincular.')
    } finally {
      setBusy(false)
    }
  }

  if (isStudent) return null
  if (loading) {
    return (
      <section className="card">
        <div className="flex items-center gap-2 text-gray-600 p-4">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
          Cargando lector biométrico…
        </div>
      </section>
    )
  }

  if (devices.length === 0) return null

  const waiting = linkRequest?.status === 'WAITING_PUNCH'
  const pendingConfirm = linkRequest?.status === 'PENDING_CONFIRM'

  return (
    <section className="card">
      <div className="card-header">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center">
            <Fingerprint className="h-4 w-4 text-emerald-600" aria-hidden />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Lector biométrico (huella)</h2>
            <p className="text-sm text-gray-600">
              {isAdminMode
                ? `Vinculación administrada${targetUserName ? ` para ${targetUserName}` : ''}.`
                : 'La huella se registra en el F22; acá vinculás tu cuenta EduTrack con tu PIN del lector.'}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {msg && (
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-800 text-sm">{msg}</div>
        )}

        {mapping ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            <p className="font-medium">Vinculado a {mapping.device.name}</p>
            <p>
              PIN en el lector: <span className="font-mono font-semibold">{mapping.deviceUserId}</span>
            </p>
            <button type="button" className="btn-secondary mt-3" disabled={busy} onClick={() => void unlink()}>
              <PendingButtonContent pending={busy} pendingText="Procesando…" idle="Desvincular lector" />
            </button>
          </div>
        ) : (
          <>
            {devices.length > 1 && !linkRequest && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Lector</label>
                <select
                  className="input-field"
                  value={selectedDeviceId}
                  onChange={(e) => setSelectedDeviceId(e.target.value)}
                  aria-label="Seleccionar lector biométrico"
                >
                  <option value="">Elegí un lector</option>
                  {devices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.code})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {waiting && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <p className="font-medium">Esperando marca en {linkRequest?.device.name}</p>
                <p>{isAdminMode ? 'El usuario debe apoyar el dedo' : 'Poné el dedo'} en el lector (tenés ~{ttlSeconds}s).</p>
              </div>
            )}

            {pendingConfirm && linkRequest?.candidateDeviceUserId && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm">
                <p className="font-medium text-emerald-900">
                  Se detectó el lector {linkRequest.device.name}, PIN{' '}
                  <span className="font-mono">{linkRequest.candidateDeviceUserId}</span>
                </p>
                <p className="text-emerald-800 mt-1">
                  {isAdminMode ? '¿Confirmar vínculo con este usuario?' : '¿Confirmar vínculo con tu cuenta?'}
                </p>
                <div className="flex flex-wrap gap-2 mt-3">
                  <button type="button" className="btn-primary" disabled={busy} onClick={() => void confirmLink()}>
                    <PendingButtonContent pending={busy} pendingText="Confirmando…" idle="Confirmar vínculo" />
                  </button>
                  <button type="button" className="btn-secondary" disabled={busy} onClick={() => void cancelLink()}>
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {!linkRequest && (
              <div className="text-sm text-gray-600 space-y-2">
                <p>
                  <strong>Primera vez:</strong>{' '}
                  {isAdminMode
                    ? 'registrá o verificá la huella del usuario en el F22.'
                    : 'pedí al administrador que registre tu huella en el F22 (usuario/PIN en el equipo).'}
                </p>
                <p>
                  <strong>Luego:</strong>{' '}
                  {isAdminMode
                    ? 'iniciá la vinculación, pedile que marque en el lector y confirmá el PIN detectado.'
                    : 'tocá el botón, marcá en el lector y confirmá el PIN detectado.'}
                </p>
                <button
                  type="button"
                  className="btn-primary mt-2"
                  disabled={busy || (devices.length > 1 && !selectedDeviceId)}
                  onClick={() => void startLink()}
                >
                  <PendingButtonContent pending={busy} pendingText="Iniciando…" idle={isAdminMode ? 'Vincular huella' : 'Vincular mi huella'} />
                </button>
              </div>
            )}

            {linkRequest && !pendingConfirm && !waiting && (
              <button type="button" className="btn-primary" disabled={busy} onClick={() => void startLink()}>
                Reintentar vinculación
              </button>
            )}

            {linkRequest && (waiting || pendingConfirm) && (
              <button type="button" className="btn-secondary text-sm" disabled={busy} onClick={() => void cancelLink()}>
                Cancelar vinculación
              </button>
            )}
          </>
        )}
      </div>
    </section>
  )
}
