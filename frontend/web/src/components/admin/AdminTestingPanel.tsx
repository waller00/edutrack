'use client'

import * as Sentry from '@sentry/nextjs'
import { api } from '@/lib/api/client'
import { getRoleLabel } from '@/lib/roles/display'
import { formatDateTimeInUruguay } from '@/lib/forms/datetime-uy'
import { AlertTriangle, Bug, Loader2, LogIn, LogOut, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

type TestingUser = {
  id: string
  label: string
  email: string
  username: string | null
  role: string
  mappings: Array<{
    id: string
    deviceUserId: string
    deviceId: string
    device: { code: string; name: string }
  }>
}

type TestingDevice = {
  id: string
  code: string
  name: string
  admsSerial: string | null
}

type TestingContext = {
  enabled: boolean
  devices: TestingDevice[]
  users: TestingUser[]
}

function localInputToIso(value: string) {
  if (!value) return undefined
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return undefined
  return d.toISOString()
}

function nowForDatetimeLocal() {
  const d = new Date()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}

export default function AdminTestingPanel() {
  const [ctx, setCtx] = useState<TestingContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [userId, setUserId] = useState('')
  const [deviceId, setDeviceId] = useState('')
  const [punchType, setPunchType] = useState<'CHECK_IN' | 'CHECK_OUT'>('CHECK_IN')
  const [timestampLocal, setTimestampLocal] = useState('')
  const [simulating, setSimulating] = useState(false)
  const [sendingSentryTest, setSendingSentryTest] = useState(false)

  const [wipeConfirm, setWipeConfirm] = useState('')
  const [resetConfirm, setResetConfirm] = useState('')
  const [wiping, setWiping] = useState(false)
  const [resetting, setResetting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api<TestingContext>('/admin/testing/context')
      setCtx(data)
      setUserId((prev) => prev || data.users[0]?.id || '')
      setDeviceId((prev) => prev || data.devices[0]?.id || '')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el panel de pruebas.')
      setCtx(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const selectedUser = useMemo(
    () => ctx?.users.find((u) => u.id === userId) ?? null,
    [ctx, userId],
  )

  const selectedDevice = useMemo(
    () => ctx?.devices.find((d) => d.id === deviceId) ?? null,
    [ctx, deviceId],
  )

  async function simulatePunch() {
    if (!userId || !deviceId) {
      setMsg(null)
      setError('Elegí usuario y lector.')
      return
    }
    setSimulating(true)
    setMsg(null)
    setError(null)
    try {
      const res = await api<{
        message: string
        duplicate?: boolean
        deviceUserId?: string
        occurredAt?: string
      }>('/admin/testing/simulate-adms', {
        method: 'POST',
        body: JSON.stringify({
          userId,
          deviceId,
          punchType,
          ...(timestampLocal ? { timestamp: localInputToIso(timestampLocal) } : {}),
        }),
      })
      setMsg(
        `${res.message}${res.deviceUserId ? ` · PIN ${res.deviceUserId}` : ''}${
          res.occurredAt ? ` · ${formatDateTimeInUruguay(res.occurredAt, { seconds: true })}` : ''
        }`,
      )
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error simulando marcación.')
    } finally {
      setSimulating(false)
    }
  }

  async function sendSentryTestEvent() {
    setSendingSentryTest(true)
    setMsg(null)
    setError(null)
    try {
      Sentry.captureException(new Error('Sentry frontend smoke test'))
      await Sentry.flush(2000)
      setMsg('Evento de prueba enviado a Sentry. Revisá el proyecto en unos segundos.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo enviar el evento de prueba a Sentry.')
    } finally {
      setSendingSentryTest(false)
    }
  }

  async function wipeOperational() {
    setWiping(true)
    setMsg(null)
    setError(null)
    try {
      const res = await api<{ message: string }>('/admin/testing/wipe-operational', {
        method: 'POST',
        body: JSON.stringify({ confirm: wipeConfirm }),
      })
      setMsg(res.message)
      setWipeConfirm('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo limpiar datos operativos.')
    } finally {
      setWiping(false)
    }
  }

  async function resetAll() {
    setResetting(true)
    setMsg(null)
    setError(null)
    try {
      const res = await api<{
        message: string
        admin: { username: string; email: string; password: string }
      }>('/admin/testing/reset-all', {
        method: 'POST',
        body: JSON.stringify({ confirm: resetConfirm }),
      })
      setMsg(`${res.message} Acceso: ${res.admin.username} / ${res.admin.password}`)
      setResetConfirm('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo reiniciar la base.')
    } finally {
      setResetting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-gray-200 bg-white py-16 shadow-sm">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600/70" aria-hidden />
        <p className="text-sm text-gray-500">Cargando herramientas de prueba…</p>
      </div>
    )
  }

  if (ctx && !ctx.enabled) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 sm:p-6">
        <p className="font-semibold">Panel deshabilitado en este entorno</p>
        <p className="mt-2 text-amber-900/90">
          En el servidor de testing, agregá <code className="rounded bg-white px-1">ALLOW_ADMIN_TESTING_TOOLS=1</code>{' '}
          al servicio <code className="rounded bg-white px-1">auth</code> y reiniciá los contenedores.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-950">
        <div className="flex gap-3">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" aria-hidden />
          <div>
            <p className="font-semibold">Solo para entornos de prueba</p>
            <p className="mt-1 text-amber-900/90">
              Simula fichadas ADMS como si vinieran del reloj. Si el usuario no tiene PIN en el lector, se crea uno
              automático para testing.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}
      {msg && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {msg}
        </div>
      )}

      <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Observabilidad</h2>
          <p className="mt-1 text-sm text-gray-600">
            Envía un error controlado desde el frontend para verificar Sentry y el túnel de monitoreo.
          </p>
        </div>
        <button
          type="button"
          disabled={sendingSentryTest}
          onClick={() => void sendSentryTestEvent()}
          className="btn-secondary inline-flex items-center gap-2 disabled:opacity-50"
        >
          {sendingSentryTest ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Bug className="h-4 w-4" aria-hidden />
          )}
          Enviar error de prueba a Sentry
        </button>
      </section>

      <section className="space-y-5 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Simular marcación ADMS</h2>
          <p className="mt-1 text-sm text-gray-600">
            Elegí usuario, lector y tipo de marcación. Por defecto usa la hora actual.
          </p>
        </div>

        {ctx?.devices.length === 0 ? (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            Creá al menos un lector en la pestaña <strong>Lectores</strong> antes de simular fichadas.
          </p>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">Usuario</span>
            <select
              className="w-full rounded-lg border border-gray-200 px-3 py-2"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            >
              <option value="">— Elegir —</option>
              {ctx?.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label} ({getRoleLabel(u.role)})
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">Lector biométrico</span>
            <select
              className="w-full rounded-lg border border-gray-200 px-3 py-2"
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
            >
              <option value="">— Elegir —</option>
              {ctx?.devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.code})
                </option>
              ))}
            </select>
          </label>
        </div>

        {selectedUser && selectedDevice && (
          <p className="text-xs text-gray-500">
            PIN en {selectedDevice.code}:{' '}
            {selectedUser.mappings.find((m) => m.deviceId === selectedDevice.id)?.deviceUserId ??
              'se creará al simular'}
          </p>
        )}

        <div className="grid gap-3 sm:flex sm:flex-wrap">
          <button
            type="button"
            onClick={() => setPunchType('CHECK_IN')}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium border ${
              punchType === 'CHECK_IN'
                ? 'border-emerald-600 bg-emerald-600 text-white'
                : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            <LogIn className="h-4 w-4" aria-hidden />
            Entrada
          </button>
          <button
            type="button"
            onClick={() => setPunchType('CHECK_OUT')}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium border ${
              punchType === 'CHECK_OUT'
                ? 'border-emerald-600 bg-emerald-600 text-white'
                : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            <LogOut className="h-4 w-4" aria-hidden />
            Salida
          </button>
        </div>

        <label className="block text-sm max-w-sm">
          <span className="mb-1 block font-medium text-gray-700">Fecha y hora (opcional)</span>
          <input
            type="datetime-local"
            className="w-full rounded-lg border border-gray-200 px-3 py-2"
            value={timestampLocal}
            onChange={(e) => setTimestampLocal(e.target.value)}
          />
          <button
            type="button"
            className="mt-1 text-xs text-emerald-700 hover:underline"
            onClick={() => setTimestampLocal(nowForDatetimeLocal())}
          >
            Usar ahora
          </button>
        </label>

        <button
          type="button"
          disabled={simulating || !userId || !deviceId || (ctx?.devices.length ?? 0) === 0}
          onClick={() => void simulatePunch()}
          className="btn-primary inline-flex items-center gap-2 disabled:opacity-50"
        >
          {simulating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Simular marcación
        </button>
      </section>

      <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Limpiar datos de prueba</h2>
          <p className="mt-1 text-sm text-gray-600">
            Borra eventos, asistencias, fichadas, cursos y estudiantes. <strong>Conserva usuarios y lectores.</strong>
          </p>
        </div>
        <label className="block text-sm max-w-xs">
          <span className="mb-1 block font-medium text-gray-700">Escribí LIMPIAR para confirmar</span>
          <input
            className="w-full rounded-lg border border-gray-200 px-3 py-2"
            value={wipeConfirm}
            onChange={(e) => setWipeConfirm(e.target.value)}
            placeholder="LIMPIAR"
          />
        </label>
        <button
          type="button"
          disabled={wiping || wipeConfirm !== 'LIMPIAR'}
          onClick={() => void wipeOperational()}
          className="btn-secondary inline-flex items-center gap-2 disabled:opacity-50"
        >
          {wiping ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
          Vaciar datos operativos
        </button>
      </section>

      <section className="space-y-4 rounded-xl border border-red-200 bg-red-50/40 p-4 shadow-sm sm:p-6">
        <div>
          <h2 className="text-lg font-semibold text-red-900">Reset total (solo admin)</h2>
          <p className="mt-1 text-sm text-red-800/90">
            Elimina todos los usuarios y datos. Deja un único admin con contraseña temporal generada y ciclo lectivo vacío.
          </p>
        </div>
        <label className="block text-sm max-w-xs">
          <span className="mb-1 block font-medium text-red-900">Escribí BORRAR TODO para confirmar</span>
          <input
            className="w-full rounded-lg border border-red-200 px-3 py-2 bg-white"
            value={resetConfirm}
            onChange={(e) => setResetConfirm(e.target.value)}
            placeholder="BORRAR TODO"
          />
        </label>
        <button
          type="button"
          disabled={resetting || resetConfirm !== 'BORRAR TODO'}
          onClick={() => void resetAll()}
          className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {resetting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
          Reset completo
        </button>
      </section>
    </div>
  )
}
