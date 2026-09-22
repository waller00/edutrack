'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Save } from 'lucide-react'
import { api } from '@/lib/api/client'
import { useLibreta } from '@/contexts/LibretaContext'

type Planning = {
  formative: string | null
  replanning: string | null
  attachments: string | null
}

/**
 * Planificación de la libreta.
 *
 * SIGED usa un editor enriquecido; acá van dos áreas de texto simples y con etiqueta explícita.
 * Una barra de formato no aporta a un texto que se lee en pantalla y se imprime en el PDF, y sí
 * agrega una dependencia y una fuente de HTML pegado desde Word.
 */
export default function PlanificacionSection() {
  const { gradeBookId } = useLibreta()
  const [planning, setPlanning] = useState<Planning>({ formative: '', replanning: '', attachments: '' })
  const [canEdit, setCanEdit] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api<{ data: Planning; canEdit: boolean }>(`/gradebook/${gradeBookId}/planning`)
      setPlanning({
        formative: res.data.formative ?? '',
        replanning: res.data.replanning ?? '',
        attachments: res.data.attachments ?? '',
      })
      setCanEdit(res.canEdit)
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'No se pudo cargar la planificación' })
    } finally {
      setLoading(false)
    }
  }, [gradeBookId])

  useEffect(() => {
    void load()
  }, [load])

  async function save() {
    setSaving(true)
    setMessage(null)
    try {
      await api(`/gradebook/${gradeBookId}/planning`, { method: 'PUT', body: JSON.stringify(planning) })
      setMessage({ kind: 'ok', text: 'Planificación guardada.' })
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'No se pudo guardar' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 py-8 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Cargando planificación…
      </p>
    )
  }

  const blocks = [
    {
      key: 'formative' as const,
      title: 'A — Planificación formativa',
      hint: 'Qué contenidos y competencias vas a trabajar en el año, y con qué criterio los vas a evaluar.',
    },
    {
      key: 'replanning' as const,
      title: 'B — Replanificación',
      hint: 'Qué ajustaste sobre la marcha y por qué. Es lo que dirección e inspección leen para entender el desvío.',
    },
  ]

  return (
    <div className="space-y-4">
      {message && (
        <p
          role={message.kind === 'error' ? 'alert' : 'status'}
          className={`rounded-lg px-3 py-2 text-sm ${message.kind === 'error' ? 'bg-red-50 text-red-800' : 'bg-green-50 text-green-800'}`}
        >
          {message.text}
        </p>
      )}

      {blocks.map((block) => (
        <section key={block.key} className="rounded-lg border border-gray-200 bg-white p-3">
          <h2 className="text-sm font-semibold text-gray-900">{block.title}</h2>
          <p className="mb-2 text-xs text-gray-500">{block.hint}</p>
          <textarea
            value={planning[block.key] ?? ''}
            disabled={!canEdit}
            rows={10}
            aria-label={block.title}
            onChange={(e) => setPlanning({ ...planning, [block.key]: e.target.value })}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-50"
          />
        </section>
      ))}

      <section className="rounded-lg border border-gray-200 bg-white p-3">
        <h2 className="text-sm font-semibold text-gray-900">Material adjunto</h2>
        <p className="mb-2 text-xs text-gray-500">
          Enlace o referencia al material (Drive, Moodle). EduTrack no almacena archivos.
        </p>
        <input
          value={planning.attachments ?? ''}
          disabled={!canEdit}
          aria-label="Material adjunto"
          placeholder="https://…"
          onChange={(e) => setPlanning({ ...planning, attachments: e.target.value })}
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-50"
        />
      </section>

      {canEdit && (
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
          Guardar planificación
        </button>
      )}
    </div>
  )
}
