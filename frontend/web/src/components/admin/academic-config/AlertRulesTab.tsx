'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { api } from '@/lib/api/client'
import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { withSchoolYear } from '@/lib/admin/school-year-query'
import { Check, Field, inputClass } from './fields'

type RuleType = 'ALERT_SUBJECTS' | 'SCORE_DROP' | 'NO_ASSESSMENTS'
type RuleSource = 'YEAR' | 'GENERAL' | 'DEFAULT'

export type AlertRule = { type: RuleType; threshold: number; isActive: boolean; source: RuleSource }

type RulesResponse = { schoolYearId: string; data: AlertRule[] }

const RULE_TEXT: Record<RuleType, { title: string; hint: string; unit: 'subjects' | 'points' | null }> = {
  ALERT_SUBJECTS: {
    title: 'Asignaturas en alerta',
    hint:
      'El estudiante queda en alerta con esta cantidad o más de asignaturas en el tramo de alerta de la escala, ' +
      'mirando la nota de reunión (R). Es lo que marca la matriz de la reunión y lo que cuenta Inteligencia académica.',
    unit: 'subjects',
  },
  SCORE_DROP: {
    title: 'Caída del promedio',
    hint: 'Se marca cuando el promedio de sus asignaturas baja esta cantidad de puntos o más de una reunión a la siguiente.',
    unit: 'points',
  },
  NO_ASSESSMENTS: {
    title: 'Sin evaluaciones',
    hint: 'Se marca al estudiante que no tiene ninguna evaluación cargada en sus libretas.',
    unit: null,
  },
}

const SOURCE_TEXT: Record<RuleSource, string> = {
  YEAR: 'Propia de este ciclo',
  GENERAL: 'General: vale para los ciclos sin regla propia',
  DEFAULT: 'Valor por defecto',
}

/** El umbral como lo escribe la persona: asignaturas, o puntos (la API guarda centésimos). */
export function thresholdToInput(rule: Pick<AlertRule, 'type' | 'threshold'>): string {
  return RULE_TEXT[rule.type].unit === 'points' ? String(rule.threshold / 100) : String(rule.threshold)
}

export function inputToThreshold(type: RuleType, value: string): number | null {
  const clean = value.trim().replace(',', '.')
  if (!clean) return null
  const parsed = Number(clean)
  if (!Number.isFinite(parsed)) return null
  return RULE_TEXT[type].unit === 'points' ? Math.round(parsed * 100) : Math.round(parsed)
}

function RuleCard({ rule, onSave }: { rule: AlertRule; onSave: (rule: AlertRule) => Promise<string | null> }) {
  const text = RULE_TEXT[rule.type]
  const [value, setValue] = useState(thresholdToInput(rule))
  const [active, setActive] = useState(rule.isActive)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setValue(thresholdToInput(rule))
    setActive(rule.isActive)
  }, [rule])

  async function save() {
    const threshold = text.unit ? inputToThreshold(rule.type, value) : 0
    if (threshold === null) {
      setError('Escribí un número.')
      return
    }
    setSaving(true)
    setError(await onSave({ ...rule, threshold, isActive: active }))
    setSaving(false)
  }

  const id = `rule-${rule.type}`
  return (
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">{text.title}</h3>
        <p className="text-xs text-gray-600">{text.hint}</p>
        <p className="mt-1 text-[11px] text-gray-500">{SOURCE_TEXT[rule.source]}</p>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        {text.unit && (
          <div className="w-40">
            <Field label={text.unit === 'points' ? 'Puntos de caída' : 'Asignaturas'} htmlFor={`${id}-value`}>
              <input
                id={`${id}-value`}
                type="text"
                inputMode={text.unit === 'points' ? 'decimal' : 'numeric'}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>
        )}
        <Check id={`${id}-active`} label="Activa" checked={active} onChange={setActive} />
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      )}
    </section>
  )
}

/**
 * Umbrales de alerta académica (§5.7). Se guardan para el ciclo elegido arriba: la regla del año
 * pisa a la general, así que los años anteriores siguen leyéndose con el umbral que tenían.
 */
export default function AlertRulesTab({ onError }: { onError: (message: string) => void }) {
  const schoolYear = useOptionalAdminSchoolYear()
  const query = schoolYear?.schoolYearScopedQuery ?? ''
  const [rules, setRules] = useState<AlertRule[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api<RulesResponse>(withSchoolYear('/admin/academic-config/alert-rules', query))
      setRules(res.data)
    } catch (error) {
      onError(error instanceof Error ? error.message : 'No se pudieron cargar los umbrales de alerta')
    } finally {
      setLoading(false)
    }
  }, [query, onError])

  useEffect(() => {
    void load()
  }, [load])

  async function save(rule: AlertRule): Promise<string | null> {
    try {
      const res = await api<RulesResponse>(withSchoolYear('/admin/academic-config/alert-rules', query), {
        method: 'PUT',
        body: JSON.stringify({ type: rule.type, threshold: rule.threshold, isActive: rule.isActive }),
      })
      setRules(res.data)
      return null
    } catch (error) {
      return error instanceof Error ? error.message : 'No se pudo guardar el umbral'
    }
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 py-8 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Cargando umbrales…
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <p className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
        Cuándo un estudiante queda <strong>en alerta</strong> en la reunión y en los indicadores. Se guarda para
        el ciclo elegido arriba; los años anteriores conservan su umbral. Las alertas son informativas: no
        generan por sí solas promociones, repeticiones ni sanciones.
      </p>
      {rules.map((rule) => (
        <RuleCard key={rule.type} rule={rule} onSave={save} />
      ))}
    </div>
  )
}
