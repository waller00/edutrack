'use client'

import { api } from '@/lib/api/client'
import { Loader2, Plug, RefreshCw, Save } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import SettingsDetails from './settings/SettingsDetails'

type MoodleSettings = {
  moodleConfigured: boolean
  moodleSyncEnabled: boolean
  moodleSyncEnabledEffective: boolean
  moodleSyncEnabledFromEnv: boolean
  moodleReconcileIntervalMs: number
  moodleSyncStudents: boolean
}

type MoodleHealth = {
  configured: boolean
  baseUrl: string | null
  syncEnabled: boolean
  connection: {
    ok: boolean
    siteName?: string
    moodleVersion?: string
    error?: string
  }
  outbox: {
    pending: number
    processing: number
    failed: number
    completed: number
  }
  reconcile?: {
    running: boolean
    startedAt: string | null
    finishedAt: string | null
    lastSummary: Record<string, number> | null
    lastError: string | null
  }
}

const shellCard =
  'space-y-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5'

export default function AdminMoodlePanel() {
  const [data, setData] = useState<MoodleSettings | null>(null)
  const [health, setHealth] = useState<MoodleHealth | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [savedData, setSavedData] = useState<MoodleSettings | null>(null)
  const [confirmReload, setConfirmReload] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<'status' | 'reconcile' | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const loadSettings = useCallback(async () => {
    const r = await api<MoodleSettings>('/admin/system-settings')
    setData(r)
    setSavedData(r)
  }, [])

  const loadHealth = useCallback(async () => {
    const r = await api<MoodleHealth>('/admin/moodle/status')
    setHealth(r)
  }, [])

  const loadAll = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    setConfirmReload(false)
    setMsg(null)
    try {
      await Promise.all([loadSettings(), loadHealth()])
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [loadSettings, loadHealth])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  useEffect(() => {
    if (!health?.reconcile?.running) return
    const t = setInterval(() => {
      void loadHealth().catch(() =>
        setMsg('No se pudo actualizar el estado de Moodle.'),
      )
    }, 5000)
    return () => clearInterval(t)
  }, [health?.reconcile?.running, loadHealth])

  async function save() {
    if (!data) return
    setSaving(true)
    setMsg(null)
    try {
      const updated = await api<MoodleSettings>('/admin/system-settings', {
        method: 'PUT',
        body: JSON.stringify({
          moodleSyncEnabled: data.moodleSyncEnabled,
          moodleReconcileIntervalMs: data.moodleReconcileIntervalMs,
          moodleSyncStudents: data.moodleSyncStudents,
        }),
      })
      setData(updated)
      setSavedData(updated)
      setConfirmReload(false)
      setMsg('Configuración Moodle guardada.')
      await loadHealth().catch(() =>
        setMsg(
          'Configuración Moodle guardada. No se pudo actualizar el estado de conexión.',
        ),
      )
    } catch {
      setMsg('No se pudo guardar.')
    } finally {
      setSaving(false)
    }
  }

  async function testConnection() {
    setBusy('status')
    setMsg(null)
    try {
      await loadHealth()
      setMsg('Estado actualizado.')
    } catch {
      setMsg('No se pudo consultar Moodle.')
    } finally {
      setBusy(null)
    }
  }

  async function reconcileNow() {
    setBusy('reconcile')
    setMsg(null)
    try {
      const r = await api<{
        message: string
        reconcile?: MoodleHealth['reconcile']
      }>('/admin/moodle/reconcile', {
        method: 'POST',
      })
      setMsg(r.message)
      await loadHealth()
    } catch (error: unknown) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'No se pudo iniciar la sincronización.'
      setMsg(message)
    } finally {
      setBusy(null)
    }
  }

  const dirty =
    data?.moodleSyncEnabled !== savedData?.moodleSyncEnabled ||
    data?.moodleSyncStudents !== savedData?.moodleSyncStudents ||
    data?.moodleReconcileIntervalMs !== savedData?.moodleReconcileIntervalMs

  if (loading)
    return (
      <p
        role="status"
        className={`${shellCard} flex items-center gap-2 text-sm text-slate-500`}
      >
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Cargando Moodle…
      </p>
    )
  if (loadError || !data)
    return (
      <div
        role="alert"
        className={`${shellCard} flex flex-wrap items-center justify-between gap-3 text-sm text-red-800`}
      >
        <p>No se pudo cargar la configuración de Moodle.</p>
        <button
          type="button"
          onClick={() => void loadAll()}
          className="font-medium hover:underline"
        >
          Reintentar
        </button>
      </div>
    )

  return (
    <div className="space-y-4">
      {msg && (
        <p
          role={msg.includes('No se pudo') ? 'alert' : 'status'}
          className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"
        >
          {msg}
        </p>
      )}
      <section className={shellCard}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-900">Integración Moodle</h2>
            <p className="mt-1 text-sm text-slate-500">
              Sincronizá usuarios, cursos e inscripciones con el aula virtual.
            </p>
          </div>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${health?.connection.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}
          >
            {!data.moodleConfigured
              ? 'Sin configurar'
              : health?.connection.ok
                ? 'Conectado'
                : 'Sin conexión'}
          </span>
        </div>
        {!data.moodleConfigured && (
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            La conexión debe configurarse en el servidor antes de sincronizar.
          </p>
        )}
        {health?.reconcile?.running && (
          <p
            role="status"
            className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800"
          >
            Sincronización en curso. Podés salir de esta pantalla; seguirá en
            segundo plano.
          </p>
        )}
        {health?.reconcile?.lastError && (
          <p
            role="alert"
            className="rounded-lg bg-red-50 p-3 text-sm text-red-800"
          >
            {health.reconcile.lastError}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary inline-flex w-full items-center justify-center gap-2 disabled:opacity-60 sm:w-auto"
            disabled={busy !== null || saving}
            onClick={() => void testConnection()}
          >
            {busy === 'status' ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Plug className="h-4 w-4" aria-hidden />
            )}
            Probar conexión
          </button>
          <button
            type="button"
            className="btn-secondary inline-flex w-full items-center justify-center gap-2 disabled:opacity-60 sm:w-auto"
            disabled={
              busy !== null ||
              saving ||
              !data.moodleConfigured ||
              health?.reconcile?.running
            }
            onClick={() => void reconcileNow()}
          >
            {busy === 'reconcile' || health?.reconcile?.running ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="h-4 w-4" aria-hidden />
            )}
            {health?.reconcile?.running
              ? 'Sincronizando…'
              : 'Sincronizar ahora'}
          </button>
        </div>
      </section>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
        className="space-y-4"
      >
        <section className={shellCard}>
          <label className="flex cursor-pointer items-start justify-between gap-4">
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-slate-900">
                Sincronización automática
              </span>
              <span className="mt-1 block text-xs text-slate-500">
                Actualizá Moodle cuando haya cambios en EduTrack.
              </span>
            </span>
            <input
              aria-label="Sincronización automática"
              type="checkbox"
              checked={data.moodleSyncEnabled}
              disabled={saving}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 accent-emerald-600"
              onChange={(e) =>
                setData((previous) =>
                  previous
                    ? { ...previous, moodleSyncEnabled: e.target.checked }
                    : previous,
                )
              }
            />
          </label>
          {data.moodleSyncEnabledFromEnv && !data.moodleSyncEnabled && (
            <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
              La sincronización sigue activa por la configuración del servidor.
              Para desactivarla por completo, revisá esa configuración.
            </p>
          )}
          <SettingsDetails
            title="Opciones de sincronización"
            description={`Revisar cursos cada ${data.moodleReconcileIntervalMs / 60000} minutos`}
          >
            <div>
              <label
                htmlFor="moodle-interval"
                className="mb-1.5 block text-sm font-medium text-slate-700"
              >
                Intervalo de revisión (minutos)
              </label>
              <input
                id="moodle-interval"
                type="number"
                min={1}
                max={1440}
                step="any"
                required
                disabled={saving}
                className="input-field w-full text-sm sm:max-w-xs"
                value={data.moodleReconcileIntervalMs / 60000}
                onChange={(e) =>
                  setData((previous) =>
                    previous
                      ? {
                          ...previous,
                          moodleReconcileIntervalMs: Math.round(
                            Number(e.target.value) * 60000,
                          ),
                        }
                      : previous,
                  )
                }
              />
              <p className="mt-1.5 text-xs text-slate-500">
                Entre 1 minuto y 24 horas. El valor habitual es 15 minutos.
              </p>
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-slate-50 p-3">
              <input
                aria-label="Sincronizar estudiantes"
                type="checkbox"
                checked={data.moodleSyncStudents}
                disabled={saving}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 accent-emerald-600"
                onChange={(e) =>
                  setData((previous) =>
                    previous
                      ? { ...previous, moodleSyncStudents: e.target.checked }
                      : previous,
                  )
                }
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-700">
                  Sincronizar estudiantes
                </span>
                <span className="mt-1 block text-xs text-slate-500">
                  Incluye las cuentas de estudiantes y sus inscripciones en los
                  cursos.
                </span>
              </span>
            </label>
          </SettingsDetails>
        </section>
        {confirmReload && (
          <div
            role="alert"
            className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
          >
            <p>Tenés cambios de Moodle sin guardar. Al recargar se perderán.</p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setConfirmReload(false)}
                className="font-medium hover:underline"
              >
                Seguir editando
              </button>
              <button
                type="button"
                onClick={() => void loadAll()}
                className="font-medium text-red-700 hover:underline"
              >
                Descartar cambios y recargar
              </button>
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
          <button
            type="button"
            disabled={saving || busy !== null}
            onClick={() => {
              if (dirty) setConfirmReload(true)
              else void loadAll()
            }}
            className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-emerald-700 disabled:opacity-50"
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
            Recargar
          </button>
          <div className="flex w-full flex-wrap items-center justify-end gap-3 sm:w-auto">
            {dirty && (
              <span className="text-xs text-amber-700">
                Cambios sin guardar
              </span>
            )}
            <button
              type="submit"
              disabled={saving || busy !== null}
              className="btn-primary inline-flex w-full items-center justify-center gap-2 disabled:opacity-60 sm:w-auto"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Save className="h-4 w-4" aria-hidden />
              )}
              {saving ? 'Guardando…' : 'Guardar Moodle'}
            </button>
          </div>
        </div>
      </form>
      <SettingsDetails
        title="Detalles de conexión y actividad"
        description={
          health
            ? `${health.outbox.pending} pendientes · ${health.outbox.failed} fallidas`
            : 'Información de conexión y últimas sincronizaciones'
        }
      >
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-slate-500">Dirección de Moodle</dt>
            <dd className="mt-1 break-all text-slate-700">
              {health?.baseUrl ?? 'Sin dirección configurada'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Conexión</dt>
            <dd className="mt-1 text-slate-700">
              {health?.connection.ok
                ? `${health.connection.siteName ?? 'Moodle'}${health.connection.moodleVersion ? ` (${health.connection.moodleVersion})` : ''}`
                : (health?.connection.error ?? 'Sin probar')}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Sincronización efectiva</dt>
            <dd className="mt-1 text-slate-700">
              {data.moodleSyncEnabledEffective ? 'Activa' : 'Desactivada'}
            </dd>
          </div>
          {health && (
            <div>
              <dt className="text-xs text-slate-500">
                Tareas de sincronización
              </dt>
              <dd className="mt-1 text-slate-700">
                {health.outbox.pending} pendientes · {health.outbox.processing}{' '}
                en curso · {health.outbox.failed} fallidas ·{' '}
                {health.outbox.completed} completadas
              </dd>
            </div>
          )}
        </dl>
        {health?.reconcile?.lastSummary && (
          <p className="text-xs text-slate-500">
            Última sincronización: {health.reconcile.lastSummary.courses ?? 0}{' '}
            cursos, {health.reconcile.lastSummary.teacherEnrolments ?? 0}{' '}
            inscripciones docentes y{' '}
            {health.reconcile.lastSummary.studentEnrolments ?? 0} inscripciones
            de estudiantes. Avisos: {health.reconcile.lastSummary.errors ?? 0}.
          </p>
        )}
      </SettingsDetails>
    </div>
  )
}
