'use client'

import { api } from '@/lib/api/client'
import { Check, Eye, Fingerprint, Loader2, Pencil, Plus, Power, RefreshCw, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

type DeviceCounts = {
  mappings: number
  punches: number
  linkRequests: number
}

type BiometricDevice = {
  id: string
  code: string
  name: string
  admsSerial?: string | null
  timezone: string
  isActive: boolean
  allowedIps: string[]
  lastSeenAt?: string | null
  createdAt: string
  updatedAt: string
  _count: DeviceCounts
}

type DeviceForm = {
  code: string
  name: string
  admsSerial: string
  timezone: string
  secret: string
  allowedIpsText: string
  isActive: boolean
}

type PanelMode = 'view' | 'edit' | 'create'

const emptyForm: DeviceForm = {
  code: '',
  name: '',
  admsSerial: '',
  timezone: 'America/Montevideo',
  secret: '',
  allowedIpsText: '',
  isActive: true,
}

function toForm(device: BiometricDevice): DeviceForm {
  return {
    code: device.code,
    name: device.name,
    admsSerial: device.admsSerial || '',
    timezone: device.timezone || 'America/Montevideo',
    secret: '',
    allowedIpsText: device.allowedIps.join('\n'),
    isActive: device.isActive,
  }
}

function ipsFromText(value: string) {
  return value
    .split(/[\n,]/)
    .map((ip) => ip.trim())
    .filter(Boolean)
}

function formatDate(value?: string | null) {
  if (!value) return 'Sin conexión'
  try {
    return new Intl.DateTimeFormat('es-UY', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(value))
  } catch {
    return 'Sin conexión'
  }
}

function DetailRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-slate-50/60 px-3 py-2">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium text-gray-900">{value}</dd>
    </div>
  )
}

export default function AdminBiometricDevicesPanel() {
  const [devices, setDevices] = useState<BiometricDevice[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mode, setMode] = useState<PanelMode>('view')
  const [form, setForm] = useState<DeviceForm>(emptyForm)
  const [msg, setMsg] = useState<string | null>(null)

  const selectedDevice = useMemo(
    () => devices.find((device) => device.id === selectedId) || null,
    [devices, selectedId],
  )

  const activeCount = devices.filter((device) => device.isActive).length

  const load = useCallback(async () => {
    setLoading(true)
    setMsg(null)
    try {
      const res = await api<{ devices: BiometricDevice[] }>('/biometric/admin/devices')
      setDevices(res.devices)
      setSelectedId((current) => current || res.devices[0]?.id || null)
    } catch (error) {
      setMsg(error instanceof Error ? error.message : 'No se pudieron cargar los lectores.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function openCreate() {
    setSelectedId(null)
    setMode('create')
    setForm(emptyForm)
    setMsg(null)
  }

  function openView(device: BiometricDevice) {
    setSelectedId(device.id)
    setMode('view')
    setMsg(null)
  }

  function openEdit(device: BiometricDevice) {
    setSelectedId(device.id)
    setMode('edit')
    setForm(toForm(device))
    setMsg(null)
  }

  function closePanel() {
    setMode('view')
    setSelectedId(devices[0]?.id || null)
    setForm(emptyForm)
  }

  async function save() {
    setSaving(true)
    setMsg(null)
    const body: Record<string, unknown> = {
      code: form.code.trim(),
      name: form.name.trim(),
      admsSerial: form.admsSerial.trim() || null,
      timezone: form.timezone.trim() || 'America/Montevideo',
      allowedIps: ipsFromText(form.allowedIpsText),
      isActive: form.isActive,
    }
    if (form.secret.trim()) body.secret = form.secret

    try {
      if (mode === 'edit' && selectedId) {
        const res = await api<{ device: BiometricDevice }>(`/biometric/admin/devices/${selectedId}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        })
        setDevices((prev) => prev.map((device) => (device.id === selectedId ? res.device : device)))
        setSelectedId(res.device.id)
        setMode('view')
        setMsg('Lector actualizado correctamente.')
      } else {
        const res = await api<{ device: BiometricDevice }>('/biometric/admin/devices', {
          method: 'POST',
          body: JSON.stringify({ ...body, secret: form.secret }),
        })
        setDevices((prev) => [res.device, ...prev])
        setSelectedId(res.device.id)
        setMode('view')
        setForm(emptyForm)
        setMsg('Lector creado correctamente.')
      }
    } catch (error) {
      setMsg(error instanceof Error ? error.message : 'No se pudo guardar el lector.')
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(device: BiometricDevice) {
    setSaving(true)
    setMsg(null)
    try {
      const res = await api<{ device: BiometricDevice }>(`/biometric/admin/devices/${device.id}`, {
        method: 'PUT',
        body: JSON.stringify({ isActive: !device.isActive }),
      })
      setDevices((prev) => prev.map((row) => (row.id === device.id ? res.device : row)))
      setMsg(res.device.isActive ? 'Lector habilitado.' : 'Lector deshabilitado.')
    } catch (error) {
      setMsg(error instanceof Error ? error.message : 'No se pudo cambiar el estado.')
    } finally {
      setSaving(false)
    }
  }

  const canSave = form.code.trim().length >= 2 && form.name.trim().length >= 2 && (mode === 'edit' || form.secret.length >= 8)
  const showForm = mode === 'edit' || mode === 'create'

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-emerald-100 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
              <Fingerprint className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <h2 className="text-base font-semibold tracking-tight text-gray-900">Lectores biométricos</h2>
              <p className="text-sm text-gray-500">
                {activeCount} activos de {devices.length} configurados
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void load()} className="btn-secondary inline-flex items-center gap-2 text-sm">
              <RefreshCw className="h-4 w-4" aria-hidden />
              Recargar
            </button>
            <button type="button" onClick={openCreate} className="btn-primary inline-flex items-center gap-2 text-sm">
              <Plus className="h-4 w-4" aria-hidden />
              Nuevo lector
            </button>
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="grid grid-cols-[minmax(170px,1.4fr)_120px_120px_120px_110px] gap-3 border-b border-gray-100 bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500 max-lg:hidden">
            <span>Lector</span>
            <span>Estado</span>
            <span>Última conexión</span>
            <span>Uso</span>
            <span className="text-right">Acciones</span>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-500">
              <Loader2 className="h-5 w-5 animate-spin text-emerald-600" aria-hidden />
              Cargando lectores…
            </div>
          ) : devices.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-gray-500">Todavía no hay lectores configurados.</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {devices.map((device) => (
                <article
                  key={device.id}
                  className={`grid gap-3 px-4 py-3 transition hover:bg-slate-50 lg:grid-cols-[minmax(170px,1.4fr)_120px_120px_120px_110px] lg:items-center ${
                    selectedId === device.id ? 'bg-emerald-50/40' : ''
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-sm font-semibold text-gray-950">{device.name}</h3>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-gray-700">{device.code}</span>
                    </div>
                    <p className="mt-1 truncate text-xs text-gray-500">{device.admsSerial || 'Sin serial ADMS'}</p>
                  </div>

                  <div>
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${device.isActive ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100' : 'bg-gray-100 text-gray-600 ring-1 ring-gray-200'}`}>
                      {device.isActive ? 'Activo' : 'Deshabilitado'}
                    </span>
                  </div>

                  <p className="text-xs font-medium text-gray-700">{formatDate(device.lastSeenAt)}</p>

                  <p className="text-xs text-gray-500">
                    <strong className="text-gray-800">{device._count.mappings}</strong> vínculos ·{' '}
                    <strong className="text-gray-800">{device._count.punches}</strong> marcas
                  </p>

                  <div className="flex items-center gap-1.5 lg:justify-end">
                    <button type="button" onClick={() => openView(device)} className="rounded-lg border border-gray-200 bg-white p-2 text-gray-600 shadow-sm transition hover:bg-gray-50" title="Ver información">
                      <Eye className="h-4 w-4" aria-hidden />
                    </button>
                    <button type="button" onClick={() => openEdit(device)} className="rounded-lg border border-emerald-200 bg-white p-2 text-emerald-700 shadow-sm transition hover:bg-emerald-50" title="Editar lector">
                      <Pencil className="h-4 w-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => void toggleActive(device)}
                      disabled={saving}
                      className={`rounded-lg border bg-white p-2 shadow-sm transition disabled:opacity-60 ${
                        device.isActive ? 'border-red-200 text-red-700 hover:bg-red-50' : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                      }`}
                      title={device.isActive ? 'Deshabilitar lector' : 'Habilitar lector'}
                    >
                      <Power className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <aside className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          {showForm ? (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-950">{mode === 'create' ? 'Nuevo lector' : 'Editar lector'}</h3>
                  <p className="mt-1 text-xs text-gray-500">{mode === 'edit' ? selectedDevice?.name : 'Alta de terminal biométrica'}</p>
                </div>
                <button type="button" onClick={closePanel} className="rounded-lg border border-gray-200 p-2 text-gray-500 hover:bg-gray-50" title="Cerrar">
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>

              <div className="space-y-3">
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Nombre</span>
                  <input className="input-modern w-full text-sm" value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="Entrada principal" />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Código</span>
                  <input className="input-modern w-full font-mono text-sm" value={form.code} onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value }))} placeholder="F22-ENTRADA" />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Serial ADMS</span>
                  <input className="input-modern w-full text-sm" value={form.admsSerial} onChange={(e) => setForm((prev) => ({ ...prev, admsSerial: e.target.value }))} placeholder="Opcional" />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Secreto</span>
                  <input className="input-modern w-full text-sm" type="password" value={form.secret} onChange={(e) => setForm((prev) => ({ ...prev, secret: e.target.value }))} placeholder={mode === 'edit' ? 'Dejar vacío para mantener' : 'Mínimo 8 caracteres'} />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium uppercase tracking-wide text-gray-500">IPs permitidas</span>
                  <textarea className="input-modern min-h-20 w-full text-sm" value={form.allowedIpsText} onChange={(e) => setForm((prev) => ({ ...prev, allowedIpsText: e.target.value }))} placeholder="Una por línea" />
                </label>
                <label className="flex items-center justify-between gap-4 rounded-lg border border-gray-100 bg-slate-50/60 px-3 py-2.5">
                  <span className="text-sm font-medium text-gray-800">Habilitado</span>
                  <input type="checkbox" className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500" checked={form.isActive} onChange={(e) => setForm((prev) => ({ ...prev, isActive: e.target.checked }))} />
                </label>
              </div>

              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void save()} disabled={!canSave || saving} className="btn-primary inline-flex items-center gap-2 text-sm disabled:opacity-60">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
                  Guardar
                </button>
                <button type="button" onClick={closePanel} className="btn-secondary inline-flex items-center gap-2 text-sm">
                  <X className="h-4 w-4" aria-hidden />
                  Cancelar
                </button>
              </div>
            </div>
          ) : selectedDevice ? (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-gray-950">{selectedDevice.name}</h3>
                  <p className="mt-1 font-mono text-xs text-gray-500">{selectedDevice.code}</p>
                </div>
                <button type="button" onClick={() => openEdit(selectedDevice)} className="rounded-lg border border-emerald-200 p-2 text-emerald-700 hover:bg-emerald-50" title="Editar lector">
                  <Pencil className="h-4 w-4" aria-hidden />
                </button>
              </div>

              <dl className="grid gap-2">
                <DetailRow label="Estado" value={selectedDevice.isActive ? 'Activo' : 'Deshabilitado'} />
                <DetailRow label="Última conexión" value={formatDate(selectedDevice.lastSeenAt)} />
                <DetailRow label="Serial ADMS" value={selectedDevice.admsSerial || 'Sin serial'} />
                <DetailRow label="Zona horaria" value={selectedDevice.timezone} />
                <DetailRow label="Vínculos" value={selectedDevice._count.mappings} />
                <DetailRow label="Marcas recibidas" value={selectedDevice._count.punches} />
                <DetailRow label="Solicitudes" value={selectedDevice._count.linkRequests} />
                <DetailRow label="Creado" value={formatDate(selectedDevice.createdAt)} />
              </dl>

              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">IPs permitidas</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {selectedDevice.allowedIps.length > 0 ? (
                    selectedDevice.allowedIps.map((ip) => (
                      <span key={ip} className="rounded bg-slate-100 px-2 py-1 font-mono text-xs text-gray-700">{ip}</span>
                    ))
                  ) : (
                    <span className="text-sm text-gray-500">Sin restricción por IP</span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex min-h-64 items-center justify-center text-center text-sm text-gray-500">
              Seleccioná un lector para ver su información.
            </div>
          )}
        </aside>
      </div>

      {msg ? (
        <div className={`rounded-lg border px-3 py-2.5 text-sm ${msg.includes('No se') || msg.includes('API') || msg.includes('existe') ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`} role="status">
          {msg}
        </div>
      ) : null}
    </div>
  )
}
