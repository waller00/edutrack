'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { api } from '@/lib/api/client'
import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { withSchoolYear } from '@/lib/admin/school-year-query'
import { Check, Field, inputClass } from './fields'
import SettingsDetails from '@/components/admin/settings/SettingsDetails'
import ScopedCycleNote from './ScopedCycleNote'

type RuleType = 'ALERT_SUBJECTS' | 'SCORE_DROP' | 'NO_ASSESSMENTS'
type RuleSource = 'YEAR' | 'GENERAL' | 'DEFAULT'

export type AlertRule = {
  type: RuleType
  threshold: number
  isActive: boolean
  source: RuleSource
}

type RulesResponse = { schoolYearId: string; data: AlertRule[] }

const RULE_TEXT: Record<
  RuleType,
  {
    title: string
    shortHint: string
    hint: string
    unit: 'subjects' | 'points' | null
  }
> = {
  ALERT_SUBJECTS: {
    title: 'Asignaturas en alerta',
    shortHint: 'Cantidad de asignaturas con nota de reunión en alerta.',
    hint:
      'El estudiante queda en alerta con esta cantidad o más de asignaturas en el tramo de alerta de la escala, ' +
      'mirando la nota de reunión (R). Es lo que marca la matriz de la reunión y lo que cuenta Rendimiento académico.',
    unit: 'subjects',
  },
  SCORE_DROP: {
    title: 'Caída del promedio',
    shortHint: 'Descenso del promedio entre dos reuniones.',
    hint: 'Se marca cuando el promedio de sus asignaturas baja esta cantidad de puntos o más de una reunión a la siguiente.',
    unit: 'points',
  },
  NO_ASSESSMENTS: {
    title: 'Sin evaluaciones',
    shortHint: 'Estudiantes sin evaluaciones en sus libretas.',
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
export function thresholdToInput(
  rule: Pick<AlertRule, 'type' | 'threshold'>,
): string {
  return RULE_TEXT[rule.type].unit === 'points'
    ? String(rule.threshold / 100)
    : String(rule.threshold)
}

export function inputToThreshold(type: RuleType, value: string): number | null {
  const clean = value.trim().replace(',', '.')
  if (!clean) return null
  const parsed = Number(clean)
  if (!Number.isFinite(parsed)) return null
  return RULE_TEXT[type].unit === 'points'
    ? Math.round(parsed * 100)
    : Math.round(parsed)
}

function RuleCard({
  rule,
  onSave,
}: {
  rule: AlertRule
  onSave: (rule: AlertRule) => Promise<string | null>
}) {
  const text = RULE_TEXT[rule.type]
  const [value, setValue] = useState(thresholdToInput(rule))
  const [active, setActive] = useState(rule.isActive)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const changed = value !== thresholdToInput(rule) || active !== rule.isActive

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
        <p className="mt-1 text-xs text-gray-600">{text.shortHint}</p>
        <p className="mt-1 text-[11px] text-gray-500">
          {SOURCE_TEXT[rule.source]}
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        {text.unit && (
          <div className="w-40">
            <Field
              label={text.unit === 'points' ? 'Puntos de caída' : 'Asignaturas'}
              htmlFor={`${id}-value`}
            >
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
        <Check
          id={`${id}-active`}
          label="Activa"
          checked={active}
          onChange={setActive}
        />
        <button
          type="button"
          disabled={saving || !changed}
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
      <SettingsDetails title={`Cómo funciona: ${text.title}`}>
        <p className="text-sm text-slate-600">{text.hint}</p>
      </SettingsDetails>
    </section>
  )
}

/**
 * Umbrales de alerta académica (§5.7). Se guardan para el ciclo elegido arriba: la regla del año
 * pisa a la general, así que los años anteriores siguen leyéndose con el umbral que tenían.
 */
export default function AlertRulesTab({
  onError,
}: {
  onError: (message: string) => void
}) {
  const schoolYear = useOptionalAdminSchoolYear()
  const query = schoolYear?.schoolYearScopedQuery ?? ''
  const schoolYearsLoading = schoolYear?.loading ?? false
  const loadRequest = useRef(0)
  const [rules, setRules] = useState<AlertRule[]>([])
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState<string | null>(null)

  const load = useCallback(async () => {
    const request = ++loadRequest.current
    setLoading(true)
    setSaved(null)
    if (schoolYearsLoading) return
    try {
      const res = await api<RulesResponse>(
        withSchoolYear('/admin/academic-config/alert-rules', query),
      )
      if (request === loadRequest.current) setRules(res.data)
    } catch (error) {
      if (request !== loadRequest.current) return
      setRules([])
      onError(
        error instanceof Error
          ? error.message
          : 'No se pudieron cargar los umbrales de alerta',
      )
    } finally {
      if (request === loadRequest.current) setLoading(false)
    }
  }, [query, schoolYearsLoading, onError])

  const cancelPendingLoad = useCallback(() => {
    loadRequest.current++
  }, [])
  useEffect(() => {
    void load()
    return cancelPendingLoad
  }, [load, cancelPendingLoad])

  async function save(rule: AlertRule): Promise<string | null> {
    const request = loadRequest.current
    setSaved(null)
    try {
      const res = await api<RulesResponse>(
        withSchoolYear('/admin/academic-config/alert-rules', query),
        {
          method: 'PUT',
          body: JSON.stringify({
            type: rule.type,
            threshold: rule.threshold,
            isActive: rule.isActive,
          }),
        },
      )
      if (request === loadRequest.current) {
        setRules(res.data)
        setSaved(`Se guardó la regla «${RULE_TEXT[rule.type].title}».`)
      }
      return null
    } catch (error) {
      return error instanceof Error
        ? error.message
        : 'No se pudo guardar el umbral'
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
      <header>
        <h2 className="text-lg font-semibold text-slate-900">
          Alertas académicas
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Ajustá cuándo se destaca a un estudiante para seguimiento.
        </p>
        <div className="mt-2">
          <ScopedCycleNote />
        </div>
      </header>
      {saved && (
        <p
          role="status"
          className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800"
        >
          {saved}
        </p>
      )}
      <div className="grid items-start gap-4 xl:grid-cols-3">
        {rules.map((rule) => (
          // La clave lleva lo guardado: si el servidor devuelve otro umbral, la tarjeta arranca de cero
          // con él. Antes un efecto lo copiaba después de montar y podía pisar lo recién escrito.
          <RuleCard
            key={`${rule.type}:${rule.threshold}:${rule.isActive}:${rule.source}`}
            rule={rule}
            onSave={save}
          />
        ))}
      </div>
      <SettingsDetails title="Alcance de las alertas">
        <p className="text-sm text-slate-600">
          Los cambios se guardan para este ciclo. Los ciclos anteriores
          conservan sus reglas; las reglas generales se usan cuando no hay una
          propia.
        </p>
        <p className="text-sm text-slate-600">
          Las alertas son informativas y no generan por sí solas promociones,
          repeticiones ni sanciones.
        </p>
      </SettingsDetails>
    </div>
  )
}
