'use client'

import { api } from '@/lib/api/client'
import { BookOpen, Loader2, Plug, RefreshCw, Save } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

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
  connection: { ok: boolean; siteName?: string; moodleVersion?: string; error?: string }
  outbox: { pending: number; processing: number; failed: number; completed: number }
  reconcile?: {
    running: boolean
    startedAt: string | null
    finishedAt: string | null
    lastSummary: Record<string, number> | null
    lastError: string | null
  }
}

const shellCard = 'rounded-xl border border-gray-200/80 bg-white p-5 shadow-sm'
const labelCls = 'block text-xs font-medium uppercase tracking-wide text-gray-500'

export default function AdminMoodlePanel() {
  const [data, setData] = useState<MoodleSettings | null>(null)
  const [health, setHealth] = useState<MoodleHealth | null>(null)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<'status' | 'reconcile' | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const loadSettings = useCallback(async () => {
    const r = await api<MoodleSettings>('/admin/system-settings')
    setData(r)
  }, [])

  const loadHealth = useCallback(async () => {
    const r = await api<MoodleHealth>('/admin/moodle/status')
    setHealth(r)
  }, [])

  const loadAll = useCallback(async () => {
    try {
      await Promise.all([loadSettings(), loadHealth()])
    } catch {
      setData(null)
      setHealth(null)
    }
  }, [loadSettings, loadHealth])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  useEffect(() => {
    if (!health?.reconcile?.running) return
    const t = setInterval(() => {
      void loadHealth()
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
      setMsg('Configuración Moodle guardada.')
      await loadHealth()
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
      const r = await api<{ message: string; reconcile?: MoodleHealth['reconcile'] }>('/admin/moodle/reconcile', {
        method: 'POST',
      })
      setMsg(r.message)
      await loadHealth()
    } catch (error: unknown) {
      const message = error instanceof Error && error.message ? error.message : 'No se pudo iniciar la sincronización.'
      setMsg(message)
    } finally {
      setBusy(null)
    }
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-gray-200 bg-white py-16 shadow-sm">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600/70" aria-hidden />
        <p className="text-sm text-gray-500">Cargando Moodle…</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-emerald-100 bg-gradient-to-br from-white via-white to-emerald-50/40 p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-emerald-100">
              <BookOpen className="h-5 w-5 text-emerald-700" aria-hidden />
            </span>
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-gray-900">Integración Moodle</h2>
              <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-gray-600">
                Sincronización EduTrack → Moodle (usuarios, cursos e inscripciones). Requiere{' '}
                <code className="text-xs">MOODLE_BASE_URL</code> y <code className="text-xs">MOODLE_WS_TOKEN</code> en el
                servidor.
              </p>
            </div>
          </div>
          <div className="grid gap-2 sm:flex sm:flex-wrap">
            <button type="button" onClick={() => void loadAll()} className="btn-secondary inline-flex items-center gap-2 text-sm">
              <RefreshCw className="h-4 w-4" aria-hidden />
              Recargar
            </button>
            <button type="button" onClick={() => void save()} className="btn-primary inline-flex items-center gap-2 text-sm disabled:opacity-60" disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
              Guardar
            </button>
          </div>
        </div>
      </section>

      {msg && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">{msg}</div>
      )}

      <section className={`${shellCard} space-y-4`}>
        <h3 className="text-sm font-semibold text-gray-900">Estado de conexión</h3>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className={labelCls}>Configurado</dt>
            <dd className="mt-1 font-medium">{data.moodleConfigured ? 'Sí' : 'No (faltan env vars)'}</dd>
          </div>
          <div>
            <dt className={labelCls}>URL</dt>
            <dd className="mt-1 font-mono text-xs break-all">{health?.baseUrl ?? '—'}</dd>
          </div>
          <div>
            <dt className={labelCls}>Conexión REST</dt>
            <dd className="mt-1">
              {health?.connection.ok ? (
                <span className="text-emerald-700 font-medium">
                  OK — {health.connection.siteName}
                  {health.connection.moodleVersion ? ` (${health.connection.moodleVersion})` : ''}
                </span>
              ) : (
                <span className="text-red-700">{health?.connection.error ?? 'Sin probar'}</span>
              )}
            </dd>
          </div>
          <div>
            <dt className={labelCls}>Sync activo</dt>
            <dd className="mt-1">
              {data.moodleSyncEnabledEffective ? (
                <span className="text-emerald-700 font-medium">Sí</span>
              ) : (
                <span className="text-amber-700">No</span>
              )}
              {data.moodleSyncEnabledFromEnv && !data.moodleSyncEnabled && (
                <span className="block text-xs text-gray-500 mt-0.5">Forzado por MOODLE_SYNC_ENABLED en .env</span>
              )}
            </dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-2 pt-2">
          <button type="button" className="btn-secondary text-sm inline-flex items-center gap-2" disabled={busy !== null} onClick={() => void testConnection()}>
            {busy === 'status' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
            Probar conexión
          </button>
          <button type="button" className="btn-secondary text-sm inline-flex items-center gap-2" disabled={busy !== null || !data.moodleConfigured || health?.reconcile?.running} onClick={() => void reconcileNow()}>
            {busy === 'reconcile' || health?.reconcile?.running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {health?.reconcile?.running ? 'Sincronizando…' : 'Sincronizar ahora'}
          </button>
        </div>
        {health && (
          <div className="space-y-1 text-xs text-gray-500">
            <p>
              Outbox: {health.outbox.pending} pendientes, {health.outbox.failed} fallidas, {health.outbox.completed}{' '}
              completadas
            </p>
            {health.reconcile?.running && (
              <p className="text-emerald-700">Sincronización completa en curso. Podés salir de esta pantalla; sigue en segundo plano.</p>
            )}
            {!health.reconcile?.running && health.reconcile?.lastSummary && (
              <p>
                Última sincronización: cursos={health.reconcile.lastSummary.courses ?? 0}, inscripciones docentes=
                {health.reconcile.lastSummary.teacherEnrolments ?? 0}, inscripciones estudiantes=
                {health.reconcile.lastSummary.studentEnrolments ?? 0}
                {(health.reconcile.lastSummary.errors ?? 0) > 0 ? `, avisos=${health.reconcile.lastSummary.errors}` : ''}.
              </p>
            )}
          </div>
        )}
      </section>

      <section className={`${shellCard} space-y-5`}>
        <div className="border-b border-gray-100 pb-4">
          <h3 className="text-sm font-semibold text-gray-900">Worker de sincronización</h3>
          <p className="text-xs text-gray-500">Controla el outbox de usuarios y la reconciliación periódica de cursos.</p>
        </div>
        <label className="flex cursor-pointer flex-col gap-3 rounded-xl border border-gray-100 bg-slate-50/40 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span className="text-sm font-medium text-gray-800">Sincronización habilitada</span>
            <p className="text-xs text-gray-500 mt-0.5">Guarda en BD; también respeta MOODLE_SYNC_ENABLED=true en .env</p>
          </div>
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-gray-300 text-emerald-600"
            checked={data.moodleSyncEnabled}
            onChange={(e) => setData((prev) => (prev ? { ...prev, moodleSyncEnabled: e.target.checked } : prev))}
          />
        </label>
        <label className="block space-y-2 sm:max-w-sm">
          <span className={labelCls}>Intervalo reconciliación (ms)</span>
          <input
            type="number"
            min={60000}
            max={86400000}
            step={60000}
            className="input-modern w-full text-sm tabular-nums"
            value={data.moodleReconcileIntervalMs}
            onChange={(e) =>
              setData((prev) => (prev ? { ...prev, moodleReconcileIntervalMs: Number(e.target.value) || 900000 } : prev))
            }
          />
          <span className="text-xs text-gray-500">Default 900000 (15 min). Mínimo 60000 (1 min).</span>
        </label>
        <label className="flex cursor-pointer flex-col gap-3 rounded-xl border border-gray-100 bg-slate-50/40 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span className="text-sm font-medium text-gray-800">Sincronizar estudiantes (legacy)</span>
            <p className="text-xs text-gray-500 mt-0.5">Usuarios nologin en cursos por oferta completa</p>
          </div>
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-gray-300 text-emerald-600"
            checked={data.moodleSyncStudents}
            onChange={(e) => setData((prev) => (prev ? { ...prev, moodleSyncStudents: e.target.checked } : prev))}
          />
        </label>
      </section>
    </div>
  )
}
