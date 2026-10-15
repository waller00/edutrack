'use client'

import { api } from '@/lib/api/client'
import { formatDateTimeInUruguay } from '@/lib/forms/datetime-uy'
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Loader2,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Search,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import SettingsDetails from './settings/SettingsDetails'

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
  secret: string
  allowedIpsText: string
  isActive: boolean
}

type PanelMode = 'view' | 'edit' | 'create'

const emptyForm: DeviceForm = {
  code: '',
  name: '',
  admsSerial: '',
  secret: '',
  allowedIpsText: '',
  isActive: true,
}

function toForm(device: BiometricDevice): DeviceForm {
  return {
    code: device.code,
    name: device.name,
    admsSerial: device.admsSerial || '',
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

/**
 * Qué le falta al lector para recibir marcas directo del reloj (iClock). El protocolo no autentica
 * al equipo: sin número de serie ni IPs permitidas el backend rechaza sus marcas.
 */
function iclockMissing(device: Pick<BiometricDevice, 'admsSerial' | 'allowedIps'>): string[] {
  const missing: string[] = []
  if (!device.admsSerial?.trim()) missing.push('número de serie')
  if (device.allowedIps.length === 0) missing.push('IPs permitidas')
  return missing
}

function formatDate(value?: string | null) {
  if (!value) return 'Sin conexión'
  try {
    return formatDateTimeInUruguay(value)
  } catch {
    return 'Sin conexión'
  }
}

function DetailRow({
  label,
  value,
}: {
  label: string
  value: string | number
}) {
  return (
    <div className="rounded-lg border border-gray-100 bg-slate-50/60 px-3 py-2">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium text-gray-900">
        {value}
      </dd>
    </div>
  )
}

export default function AdminBiometricDevicesPanel() {
  const [devices, setDevices] = useState<BiometricDevice[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [search, setSearch] = useState('')
  const [discardAction, setDiscardAction] = useState<
    'create' | 'close' | 'reload' | null
  >(null)
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
    setLoadError(false)
    setMsg(null)
    try {
      const res = await api<{ devices: BiometricDevice[] }>(
        '/biometric/admin/devices',
      )
      setDevices(res.devices)
      setSelectedId((current) =>
        res.devices.some((device) => device.id === current) ? current : null,
      )
    } catch (error) {
      setLoadError(true)
      setMsg(
        error instanceof Error
          ? error.message
          : 'No se pudieron cargar los lectores.',
      )
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
    setSelectedId(null)
    setForm(emptyForm)
  }

  async function save() {
    setSaving(true)
    setMsg(null)
    setDiscardAction(null)
    const body: Record<string, unknown> = {
      code: form.code.trim(),
      name: form.name.trim(),
      admsSerial: form.admsSerial.trim() || null,
      allowedIps: ipsFromText(form.allowedIpsText),
      isActive: form.isActive,
    }
    if (form.secret.trim()) body.secret = form.secret

    try {
      if (mode === 'edit' && selectedId) {
        const res = await api<{ device: BiometricDevice }>(
          `/biometric/admin/devices/${selectedId}`,
          {
            method: 'PUT',
            body: JSON.stringify(body),
          },
        )
        setDevices((prev) =>
          prev.map((device) =>
            device.id === selectedId ? res.device : device,
          ),
        )
        setSelectedId(res.device.id)
        setMode('view')
        setMsg('Lector actualizado correctamente.')
      } else {
        const res = await api<{ device: BiometricDevice }>(
          '/biometric/admin/devices',
          {
            method: 'POST',
            body: JSON.stringify({ ...body, secret: form.secret }),
          },
        )
        setDevices((prev) => [res.device, ...prev])
        setSelectedId(res.device.id)
        setMode('view')
        setForm(emptyForm)
        setMsg('Lector creado correctamente.')
      }
    } catch (error) {
      setMsg(
        error instanceof Error
          ? error.message
          : 'No se pudo guardar el lector.',
      )
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(device: BiometricDevice) {
    setSaving(true)
    setMsg(null)
    try {
      const res = await api<{ device: BiometricDevice }>(
        `/biometric/admin/devices/${device.id}`,
        {
          method: 'PUT',
          body: JSON.stringify({ isActive: !device.isActive }),
        },
      )
      setDevices((prev) =>
        prev.map((row) => (row.id === device.id ? res.device : row)),
      )
      setMsg(
        res.device.isActive ? 'Lector habilitado.' : 'Lector deshabilitado.',
      )
    } catch (error) {
      setMsg(
        error instanceof Error
          ? error.message
          : 'No se pudo cambiar el estado.',
      )
    } finally {
      setSaving(false)
    }
  }

  const canSave =
    form.code.trim().length >= 2 &&
    form.name.trim().length >= 2 &&
    (mode === 'edit' || form.secret.length >= 8)
  const showForm = mode === 'edit' || mode === 'create'
  const showPanel = showForm || Boolean(selectedDevice)
  const originalForm =
    mode === 'edit' && selectedDevice ? toForm(selectedDevice) : emptyForm
  const dirty =
    showForm && JSON.stringify(form) !== JSON.stringify(originalForm)
  const normalized = (value: string) =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
  const visibleDevices = devices.filter((device) =>
    normalized(
      `${device.name} ${device.code} ${device.admsSerial ?? ''}`,
    ).includes(normalized(search)),
  )

  function perform(action: 'create' | 'close' | 'reload') {
    setDiscardAction(null)
    if (action === 'create') openCreate()
    else if (action === 'close') closePanel()
    else {
      closePanel()
      void load()
    }
  }
  function requestAction(action: 'create' | 'close' | 'reload') {
    if (dirty) setDiscardAction(action)
    else perform(action)
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-900">Lectores biométricos</h2>
          <p className="mt-1 text-sm text-slate-500">
            {activeCount} activos de {devices.length} configurados
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => requestAction('reload')}
            disabled={saving || loading}
            className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-emerald-700 disabled:opacity-50"
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
            Recargar
          </button>
          <button
            type="button"
            onClick={() => requestAction('create')}
            disabled={saving}
            className="btn-primary inline-flex items-center gap-2 disabled:opacity-60"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Nuevo lector
          </button>
        </div>
      </header>
      {msg && (
        <p
          role={loadError || msg.startsWith('No se') ? 'alert' : 'status'}
          className={`rounded-xl border p-3 text-sm ${loadError || msg.startsWith('No se') ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}
        >
          {msg}
        </p>
      )}
      {discardAction && (
        <div
          role="alert"
          className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
        >
          <p>Tenés cambios del lector sin guardar.</p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setDiscardAction(null)}
              className="font-medium hover:underline"
            >
              Seguir editando
            </button>
            <button
              type="button"
              onClick={() => perform(discardAction)}
              className="font-medium text-red-700 hover:underline"
            >
              Descartar cambios y continuar
            </button>
          </div>
        </div>
      )}
      <div
        className={`grid gap-4 ${showPanel ? 'lg:grid-cols-[minmax(0,1fr)_360px]' : ''}`}
      >
        <section
          aria-label="Lista de lectores"
          className={`min-w-0 rounded-xl border border-slate-200 bg-white p-4 ${showPanel ? 'hidden lg:block' : ''}`}
        >
          <label
            htmlFor="device-search"
            className="mb-1.5 block text-sm font-medium text-slate-700"
          >
            Buscar lector
          </label>
          <div className="relative mb-4">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <input
              id="device-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Nombre, código o número de serie"
              className="input-field w-full pl-9 text-sm"
            />
          </div>
          {loading ? (
            <p
              role="status"
              className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500"
            >
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Cargando lectores…
            </p>
          ) : loadError ? (
            <button
              type="button"
              onClick={() => void load()}
              className="py-4 text-sm font-medium text-emerald-700 hover:underline"
            >
              Reintentar
            </button>
          ) : visibleDevices.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              {devices.length === 0
                ? 'Todavía no hay lectores configurados.'
                : 'Ningún lector coincide con la búsqueda.'}
            </p>
          ) : (
            <ul className="space-y-2">
              {visibleDevices.map((device) => (
                <li key={device.id}>
                  <button
                    type="button"
                    aria-label={`Ver lector ${device.name}`}
                    aria-pressed={selectedId === device.id}
                    disabled={showForm || saving}
                    onClick={() => openView(device)}
                    className={`flex w-full items-start justify-between gap-3 rounded-lg border p-3 text-left transition focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-50 ${selectedId === device.id ? 'border-emerald-300 bg-emerald-50' : 'border-slate-100 hover:border-emerald-200 hover:bg-slate-50'}`}
                  >
                    <span className="min-w-0">
                      <span className="block break-words text-sm font-semibold text-slate-900">
                        {device.name}
                      </span>
                      <span className="mt-1 block break-all text-xs text-slate-500">
                        {device.code}
                      </span>
                      <span className="mt-1 block text-xs text-slate-500">
                        Última conexión: {formatDate(device.lastSeenAt)}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${device.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}
                      >
                        {device.isActive ? 'Activo' : 'Deshabilitado'}
                      </span>
                      <span className="text-xs font-medium text-emerald-700">
                        Ver detalle
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        {showPanel && (
          <aside
            aria-label="Detalle del lector"
            className="min-w-0 space-y-4 rounded-xl border border-slate-200 bg-white p-4"
          >
            <button
              type="button"
              disabled={saving}
              onClick={() => requestAction('close')}
              className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-emerald-700 disabled:opacity-50"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Volver a lectores
            </button>
            {showForm ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  void save()
                }}
                className="space-y-4"
              >
                <div>
                  <h3 className="font-semibold text-slate-900">
                    {mode === 'create' ? 'Nuevo lector' : 'Editar lector'}
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    {mode === 'edit'
                      ? selectedDevice?.name
                      : 'Completá los datos del equipo.'}
                  </p>
                </div>
                <fieldset disabled={saving} className="min-w-0 space-y-3">
                  <div>
                    <label
                      htmlFor="device-name"
                      className="mb-1.5 block text-sm font-medium text-slate-700"
                    >
                      Nombre
                    </label>
                    <input
                      id="device-name"
                      className="input-field w-full text-sm"
                      value={form.name}
                      onChange={(e) =>
                        setForm((previous) => ({
                          ...previous,
                          name: e.target.value,
                        }))
                      }
                      required
                      minLength={2}
                      placeholder="Entrada principal"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="device-code"
                      className="mb-1.5 block text-sm font-medium text-slate-700"
                    >
                      Código
                    </label>
                    <input
                      id="device-code"
                      className="input-field w-full text-sm"
                      value={form.code}
                      onChange={(e) =>
                        setForm((previous) => ({
                          ...previous,
                          code: e.target.value,
                        }))
                      }
                      required
                      minLength={2}
                      placeholder="F22-ENTRADA"
                    />
                  </div>
                  {mode === 'create' && (
                    <div>
                      <label
                        htmlFor="device-secret"
                        className="mb-1.5 block text-sm font-medium text-slate-700"
                      >
                        Clave del lector
                      </label>
                      <input
                        id="device-secret"
                        type="password"
                        autoComplete="new-password"
                        required
                        minLength={8}
                        className="input-field w-full text-sm"
                        value={form.secret}
                        onChange={(e) =>
                          setForm((previous) => ({
                            ...previous,
                            secret: e.target.value,
                          }))
                        }
                        placeholder="Mínimo 8 caracteres"
                      />
                    </div>
                  )}
                  <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg bg-slate-50 p-3">
                    <span className="text-sm font-medium text-slate-700">
                      Lector habilitado
                    </span>
                    <input
                      aria-label="Lector habilitado"
                      type="checkbox"
                      className="h-4 w-4 shrink-0 rounded border-slate-300 accent-emerald-600"
                      checked={form.isActive}
                      onChange={(e) =>
                        setForm((previous) => ({
                          ...previous,
                          isActive: e.target.checked,
                        }))
                      }
                    />
                  </label>
                  <SettingsDetails
                    title="Conexión y opciones avanzadas"
                    description="Número de serie y restricciones de acceso."
                  >
                    <div>
                      <label
                        htmlFor="device-serial"
                        className="mb-1.5 block text-sm font-medium text-slate-700"
                      >
                        Número de serie (ADMS)
                      </label>
                      <input
                        id="device-serial"
                        className="input-field w-full text-sm"
                        value={form.admsSerial}
                        onChange={(e) =>
                          setForm((previous) => ({
                            ...previous,
                            admsSerial: e.target.value,
                          }))
                        }
                        placeholder="El que muestra el equipo"
                      />
                      <p className="mt-1.5 text-xs text-slate-500">
                        Necesario para recibir marcas directo del reloj (iClock).
                      </p>
                    </div>
                    <div>
                      <label
                        htmlFor="device-ips"
                        className="mb-1.5 block text-sm font-medium text-slate-700"
                      >
                        IPs permitidas
                      </label>
                      <textarea
                        id="device-ips"
                        className="input-field min-h-20 w-full text-sm"
                        value={form.allowedIpsText}
                        onChange={(e) =>
                          setForm((previous) => ({
                            ...previous,
                            allowedIpsText: e.target.value,
                          }))
                        }
                        placeholder="Una por línea o separadas por comas"
                      />
                      <p className="mt-1.5 text-xs text-slate-500">
                        Necesario para iClock: el reloj solo puede enviar marcas
                        desde estas IPs (la IP pública del liceo). Vacío: no
                        recibe marcas por iClock.
                      </p>
                    </div>
                    {mode === 'edit' && (
                      <div>
                        <label
                          htmlFor="device-secret"
                          className="mb-1.5 block text-sm font-medium text-slate-700"
                        >
                          Nueva clave del lector
                        </label>
                        <input
                          id="device-secret"
                          type="password"
                          autoComplete="new-password"
                          className="input-field w-full text-sm"
                          value={form.secret}
                          onChange={(e) =>
                            setForm((previous) => ({
                              ...previous,
                              secret: e.target.value,
                            }))
                          }
                          placeholder="Dejar vacío para mantener la actual"
                        />
                      </div>
                    )}
                  </SettingsDetails>
                </fieldset>
                <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                  <button
                    type="submit"
                    disabled={!canSave || saving}
                    className="btn-primary inline-flex w-full items-center justify-center gap-2 disabled:opacity-60 sm:w-auto"
                  >
                    {saving ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <Check className="h-4 w-4" aria-hidden />
                    )}
                    {saving ? 'Guardando…' : 'Guardar lector'}
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => requestAction('close')}
                    className="btn-secondary inline-flex w-full items-center justify-center gap-2 disabled:opacity-60 sm:w-auto"
                  >
                    <X className="h-4 w-4" aria-hidden />
                    Cancelar
                  </button>
                </div>
              </form>
            ) : (
              selectedDevice && (
                <>
                  <div>
                    <h3 className="break-words font-semibold text-slate-900">
                      {selectedDevice.name}
                    </h3>
                    <p className="mt-1 break-all text-xs text-slate-500">
                      {selectedDevice.code}
                    </p>
                  </div>
                  <dl className="grid gap-2">
                    <DetailRow
                      label="Estado"
                      value={
                        selectedDevice.isActive ? 'Activo' : 'Deshabilitado'
                      }
                    />
                    <DetailRow
                      label="Última conexión"
                      value={formatDate(selectedDevice.lastSeenAt)}
                    />
                  </dl>
                  {iclockMissing(selectedDevice).length > 0 && (
                    <p
                      role="status"
                      className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
                    >
                      <AlertTriangle
                        className="mt-0.5 h-4 w-4 shrink-0"
                        aria-hidden
                      />
                      <span>
                        No recibe marcas del reloj (iClock): falta{' '}
                        {iclockMissing(selectedDevice).join(' e ')}.
                      </span>
                    </p>
                  )}
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => openEdit(selectedDevice)}
                    className="btn-secondary inline-flex w-full items-center justify-center gap-2 disabled:opacity-60"
                  >
                    <Pencil className="h-4 w-4" aria-hidden />
                    Editar lector
                  </button>
                  <SettingsDetails
                    title="Información técnica y uso"
                    description="Conexión, marcas y vínculos del equipo."
                  >
                    <dl className="grid gap-2">
                      <DetailRow
                        label="Serial ADMS"
                        value={selectedDevice.admsSerial || 'Sin serial'}
                      />
                      <DetailRow
                        label="Zona horaria"
                        value={selectedDevice.timezone}
                      />
                      <DetailRow
                        label="Vínculos"
                        value={selectedDevice._count.mappings}
                      />
                      <DetailRow
                        label="Marcas recibidas"
                        value={selectedDevice._count.punches}
                      />
                      <DetailRow
                        label="Solicitudes"
                        value={selectedDevice._count.linkRequests}
                      />
                      <DetailRow
                        label="Creado"
                        value={formatDate(selectedDevice.createdAt)}
                      />
                    </dl>
                    <div>
                      <p className="text-xs text-slate-500">IPs permitidas</p>
                      <p className="mt-1 break-all text-sm text-slate-700">
                        {selectedDevice.allowedIps.length
                          ? selectedDevice.allowedIps.join(', ')
                          : 'Ninguna: no recibe marcas por iClock'}
                      </p>
                    </div>
                  </SettingsDetails>
                  <SettingsDetails
                    title="Cambiar estado del lector"
                    description={
                      selectedDevice.isActive
                        ? 'Deshabilitar el registro de nuevas marcas.'
                        : 'Habilitar el registro de nuevas marcas.'
                    }
                  >
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void toggleActive(selectedDevice)}
                      className="btn-secondary inline-flex w-full items-center justify-center gap-2 disabled:opacity-60"
                    >
                      <Power className="h-4 w-4" aria-hidden />
                      {selectedDevice.isActive
                        ? 'Deshabilitar lector'
                        : 'Habilitar lector'}
                    </button>
                  </SettingsDetails>
                </>
              )
            )}
          </aside>
        )}
      </div>
    </div>
  )
}
