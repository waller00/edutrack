'use client'
import { useCallback, useEffect, useState } from 'react'
import RoleGuard from '@/components/RoleGuard'
import { api } from '@/lib/api'
import { PendingButtonContent } from '@/components/PendingButtonContent'
import { Shield } from 'lucide-react'

type SettingsResponse = { livenessCheckEnabled: boolean; diditConfigured: boolean }

export default function AdminSystemSettingsPage() {
  const [data, setData] = useState<SettingsResponse | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    setMessage('')
    try {
      const r = await api<SettingsResponse>('/admin/system-settings')
      setData(r)
    } catch (e) {
      setMessage('No se pudo cargar la configuración.')
      setData(null)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function save(next: boolean) {
    if (!data) return
    setSaving(true)
    setMessage('')
    try {
      const r = await api<SettingsResponse>('/admin/system-settings', {
        method: 'PUT',
        body: JSON.stringify({ livenessCheckEnabled: next }),
      })
      setData(r)
      setMessage(next ? 'Prueba de vida activada: los nuevos registros deberán pasar por Didit además del DNI.' : 'Solo se exigirá el flujo actual (DNI / OCR).')
    } catch (e: unknown) {
      const err = e as { data?: { message?: string }; message?: string }
      const m = (typeof err.data?.message === 'string' && err.data.message) || err.message
      setMessage(m || 'No se pudo guardar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <RoleGuard allow={['ADMIN']}>
      <main className="mx-auto max-w-2xl p-6 space-y-6">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-emerald-100 p-3">
            <Shield className="h-8 w-8 text-emerald-700" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Seguridad del registro</h1>
            <p className="text-sm text-gray-600">Controlá si se exige prueba de vida (Didit) además de la verificación con DNI.</p>
          </div>
        </div>

        {!data ? (
          <p className="text-gray-500">{message || 'Cargando…'}</p>
        ) : (
          <div className="card space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium text-gray-900">Exigir prueba de vida (Didit)</p>
                <p className="text-sm text-gray-600">
                  Si está activo, al registrarse se deberá completar el flujo con Didit luego de verificar el DNI.
                </p>
                {!data.diditConfigured && (
                  <p className="text-sm text-amber-800 mt-2">
                    No hay API key ni workflow de Didit en el backend: definí <code className="text-xs bg-amber-50 px-1">DIDIT_API_KEY</code> y{' '}
                    <code className="text-xs bg-amber-50 px-1">DIDIT_WORKFLOW_ID</code> (y el webhook) en el servidor.
                  </p>
                )}
              </div>
              <label className="inline-flex cursor-pointer items-center gap-2">
                <span className="text-sm text-gray-700">{data.livenessCheckEnabled ? 'Activado' : 'Desactivado'}</span>
                <input
                  type="checkbox"
                  className="h-5 w-5 rounded border-gray-300"
                  checked={data.livenessCheckEnabled}
                  disabled={saving}
                  onChange={(e) => {
                    void save(e.target.checked)
                  }}
                />
              </label>
            </div>
            {message && <p className="text-sm text-gray-700">{message}</p>}
            <div className="pt-2 border-t border-gray-100">
              <p className="text-xs text-gray-500">
                En la consola de Didit creá un workflow con liveness (o el que corresponda), copiá el ID de workflow, y configurá la URL del
                webhook apuntando a <code className="bg-gray-100 px-1">POST /webhooks/didit</code> de este backend.
              </p>
            </div>
            <div>
              <button
                type="button"
                onClick={() => void load()}
                className="btn-secondary text-sm"
                disabled={saving}
              >
                <PendingButtonContent pending={saving} pendingText="Actualizando…" idle="Recargar" />
              </button>
            </div>
          </div>
        )}
      </main>
    </RoleGuard>
  )
}
