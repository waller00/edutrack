'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ImageIcon, Loader2, Trash2 } from 'lucide-react'
import { api } from '@/lib/api/client'
import { apiBlob, apiUpload } from '@/lib/api/binary'

export type InstitutionSettings = {
  name: string | null
  logo: { mimeType: string; byteSize: number; updatedAt: string } | null
}

/** Lo que pdfkit sabe dibujar en el boletín; el servidor lo vuelve a validar por la firma del archivo. */
const LOGO_TYPES = ['image/png', 'image/jpeg']
const LOGO_MAX_BYTES = 1_048_576

const cardClass = 'space-y-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5'

/** Por qué no se puede subir el archivo, o `null` si se puede. Se avisa antes de mandarlo. */
export function logoFileProblem(file: { type: string; size: number }): string | null {
  if (!LOGO_TYPES.includes(file.type)) return 'El logo tiene que ser PNG o JPEG.'
  if (file.size > LOGO_MAX_BYTES) return 'El logo supera 1 MB. Probá con una imagen más chica.'
  return null
}

/**
 * Nombre y logo de la institución: encabezan el boletín (arriba a la izquierda, como la planilla
 * impresa). Están acá y no en el código para que el mismo EduTrack sirva a cualquier liceo.
 */
export default function AdminInstitutionPanel() {
  const [settings, setSettings] = useState<InstitutionSettings | null>(null)
  const [name, setName] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState<'name' | 'logo' | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [loadError, setLoadError] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const apply = useCallback((next: InstitutionSettings) => {
    setSettings(next)
    setName(next.name ?? '')
  }, [])

  const load = useCallback(async () => {
    setLoadError(false)
    try {
      apply(await api<InstitutionSettings>('/admin/institution'))
    } catch {
      setLoadError(true)
    }
  }, [apply])

  useEffect(() => {
    void load()
  }, [load])

  const logoVersion = settings?.logo?.updatedAt ?? null
  useEffect(() => {
    if (!logoVersion) {
      setPreview(null)
      return
    }
    let cancelled = false
    apiBlob(`/admin/institution/logo?v=${Date.parse(logoVersion)}`)
      .then((blob) => {
        if (!cancelled) setPreview(blob ? URL.createObjectURL(blob) : null)
      })
      .catch(() => {
        // Que no se pueda ver la vista previa no impide cambiar el logo.
        if (!cancelled) setPreview(null)
      })
    return () => {
      cancelled = true
    }
  }, [logoVersion])

  // El object URL se libera al reemplazarlo o al desmontar.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview)
    }
  }, [preview])

  async function saveName() {
    setBusy('name')
    setMsg(null)
    try {
      apply(
        await api<InstitutionSettings>('/admin/institution', {
          method: 'PUT',
          body: JSON.stringify({ name: name.trim() || null }),
        }),
      )
      setMsg({ ok: true, text: 'Nombre guardado.' })
    } catch {
      setMsg({ ok: false, text: 'No se pudo guardar el nombre.' })
    } finally {
      setBusy(null)
    }
  }

  async function upload(file: File) {
    const problem = logoFileProblem(file)
    if (problem) {
      setMsg({ ok: false, text: problem })
      if (inputRef.current) inputRef.current.value = ''
      return
    }
    setBusy('logo')
    setMsg(null)
    try {
      apply(await apiUpload<InstitutionSettings>('/admin/institution/logo', file))
      setMsg({ ok: true, text: 'Logo guardado.' })
    } catch (error) {
      setMsg({ ok: false, text: error instanceof Error ? error.message : 'No se pudo guardar el logo.' })
    } finally {
      setBusy(null)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function removeLogo() {
    setBusy('logo')
    setMsg(null)
    try {
      apply(await api<InstitutionSettings>('/admin/institution/logo', { method: 'DELETE' }))
      setMsg({ ok: true, text: 'Logo quitado.' })
    } catch {
      setMsg({ ok: false, text: 'No se pudo quitar el logo.' })
    } finally {
      setBusy(null)
    }
  }

  if (loadError) {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
      >
        <p>No se pudieron cargar los datos de la institución.</p>
        <button type="button" onClick={() => void load()} className="font-medium hover:underline">
          Reintentar
        </button>
      </div>
    )
  }
  if (!settings) {
    return (
      <p role="status" className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Cargando institución…
      </p>
    )
  }

  const nameDirty = name.trim() !== (settings.name ?? '')

  return (
    <div className="space-y-4">
      {msg && (
        <p
          role={msg.ok ? 'status' : 'alert'}
          className={`rounded-xl border p-3 text-sm ${msg.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}
        >
          {msg.text}
        </p>
      )}

      <section className={cardClass}>
        <div>
          <h2 className="font-semibold text-slate-900">Nombre de la institución</h2>
          <p className="mt-1 text-sm text-slate-500">Encabeza el boletín, junto al logo.</p>
        </div>
        <div className="flex flex-col gap-2 sm:max-w-xl sm:flex-row sm:items-end">
          <label className="flex-1 text-sm">
            <span className="mb-1.5 block font-medium text-slate-700">Nombre</span>
            <input
              className="input-field w-full"
              value={name}
              maxLength={120}
              disabled={busy !== null}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej.: Instituto de Educación Integral"
            />
          </label>
          <button
            type="button"
            className="btn-primary text-sm"
            disabled={busy !== null || !nameDirty}
            onClick={() => void saveName()}
          >
            {busy === 'name' ? 'Guardando…' : 'Guardar nombre'}
          </button>
        </div>
      </section>

      <section className={cardClass}>
        <div>
          <h2 className="font-semibold text-slate-900">Logo</h2>
          <p className="mt-1 text-sm text-slate-500">
            Va arriba a la izquierda del boletín. PNG o JPEG de hasta 1 MB; conviene recortado, sin márgenes.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-slate-50">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element -- blob local, no una URL remota
              <img src={preview} alt="Logo de la institución" className="h-full w-full object-contain" />
            ) : (
              <ImageIcon className="h-8 w-8 text-slate-300" aria-label="Sin logo" />
            )}
          </div>
          <div className="flex flex-col items-start gap-2">
            <input
              ref={inputRef}
              id="institution-logo"
              type="file"
              accept={LOGO_TYPES.join(',')}
              className="sr-only"
              disabled={busy !== null}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void upload(file)
              }}
            />
            <label htmlFor="institution-logo" className="btn-secondary cursor-pointer text-sm">
              {busy === 'logo' ? 'Procesando…' : settings.logo ? 'Cambiar logo' : 'Subir logo'}
            </label>
            {settings.logo && (
              <button
                type="button"
                onClick={() => void removeLogo()}
                disabled={busy !== null}
                className="inline-flex items-center gap-1 text-xs text-red-600 hover:underline disabled:opacity-50"
              >
                <Trash2 className="h-3 w-3" aria-hidden />
                Quitar logo
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
