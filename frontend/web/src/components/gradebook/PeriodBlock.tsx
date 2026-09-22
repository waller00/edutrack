'use client'

import { useEffect, useState } from 'react'
import { Loader2, Lock, Plus } from 'lucide-react'
import { formatHundredths, resolveLevel } from '@/lib/academic-config/grade-value'
import { levelStyle } from '@/lib/academic-config/level-tokens'
import {
  ACTIVITY_CATEGORY_LABEL,
  ACTIVITY_CATEGORY_TITLE,
  type ActivityCategory,
} from '@/lib/gradebook/activity-category'
import { GRADE_1_TO_10, gradeSelectFromHundredths, gradeSelectToHundredths } from '@/lib/gradebook/grade-1-10'
import {
  blockCategories,
  gradesByCategory,
  judgementLabelOf,
  periodKind,
  type LibretaPeriod,
  type PeriodGradeValues,
} from '@/lib/gradebook/period-blocks'
import { gradeTooltipLine } from '@/lib/gradebook/student-evaluation-export'

/**
 * Un bloque de la carta del alumno, con la forma de la planilla del liceo:
 * tramo (Or · Otras · Ev · [Prueba] · C · R), entrega (informe · C · R) o diagnóstico (texto).
 *
 * C es la calificación del docente y R la que queda después de la reunión. Las notas sueltas se
 * muestran todas, como las dos celdas de cada columna en la planilla: nunca se promedian.
 */

export type BlockLevel = {
  label: string
  minValueHundredths: number
  maxValueHundredths: number
  colorToken: string | null
  iconToken: string | null
  isAlert: boolean
}

export type BlockGrade = {
  key: string
  category: ActivityCategory
  valueHundredths: number | null
  isAbsent: boolean
  date: string
  title: string
  comment: string | null
}

export type PeriodGradePatch = Partial<PeriodGradeValues>

type Status = 'OPEN' | 'CLOSED' | 'REOPENED'

type BlockProps = {
  period: LibretaPeriod
  grades: readonly BlockGrade[]
  saved: PeriodGradeValues | null
  levels: readonly BlockLevel[]
  decimals: number
  /** El docente puede escribir: tiene la libreta y el período está abierto y habilitado. */
  editable: boolean
  status?: Status
  onSave?: (patch: PeriodGradePatch) => Promise<void>
  onAddGrade?: (category: ActivityCategory) => void
}

/** Nota con el color y el símbolo de su tramo: nunca sólo color (RNF 7.2). */
function GradeValue({
  value,
  levels,
  decimals,
  hint,
}: {
  value: number | null
  levels: readonly BlockLevel[]
  decimals: number
  hint?: string
}) {
  const display = formatHundredths(value, decimals)
  const level = resolveLevel(value, levels)
  if (!level) {
    return (
      <span className="tabular-nums text-slate-700" title={hint}>
        {display}
      </span>
    )
  }
  const style = levelStyle(level)
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded border px-1 tabular-nums ${style.badgeClass}`}
      title={[level.label, hint].filter(Boolean).join('\n')}
      aria-label={`${display}, ${level.label}`}
    >
      <span aria-hidden>{style.symbol}</span>
      {display}
    </span>
  )
}

function GradeChips({
  grades,
  levels,
  decimals,
}: {
  grades: readonly BlockGrade[]
  levels: readonly BlockLevel[]
  decimals: number
}) {
  if (grades.length === 0) return <span className="text-slate-400">—</span>
  return (
    <span className="flex flex-wrap justify-center gap-0.5">
      {grades.map((grade) =>
        grade.isAbsent ? (
          <span key={grade.key} className="rounded border border-slate-200 px-1 text-slate-500" title={gradeTooltipLine(grade)}>
            Aus
          </span>
        ) : (
          <GradeValue
            key={grade.key}
            value={grade.valueHundredths}
            levels={levels}
            decimals={decimals}
            hint={gradeTooltipLine(grade)}
          />
        ),
      )}
    </span>
  )
}

/** C o R: selector 1–10 editable en la misma carta, o el valor con su tramo si no se puede editar. */
function PeriodGradeCell({
  label,
  title,
  value,
  levels,
  decimals,
  editable,
  onChange,
}: {
  label: string
  title: string
  value: number | null
  levels: readonly BlockLevel[]
  decimals: number
  editable: boolean
  onChange: (value: number | null) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const level = resolveLevel(value, levels)
  const style = level ? levelStyle(level) : null

  async function handleChange(next: string) {
    setBusy(true)
    try {
      await onChange(gradeSelectToHundredths(next))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="px-1 py-1.5 text-center">
      <p className="font-bold text-amber-900" title={title}>
        {label}
      </p>
      {editable ? (
        <span className="inline-flex items-center gap-0.5">
          <select
            value={gradeSelectFromHundredths(value)}
            disabled={busy}
            onChange={(e) => void handleChange(e.target.value)}
            aria-label={title}
            title={level?.label}
            className={`w-12 rounded border px-0.5 py-0.5 text-center tabular-nums disabled:opacity-50 ${
              style?.badgeClass ?? 'border-amber-200 bg-amber-50'
            }`}
          >
            <option value="">—</option>
            {GRADE_1_TO_10.map((n) => (
              <option key={n} value={String(n)}>
                {n}
              </option>
            ))}
            <option value="NA">N/A</option>
          </select>
          {busy ? (
            <Loader2 className="h-3 w-3 animate-spin text-slate-400" aria-hidden />
          ) : (
            style && <span aria-hidden>{style.symbol}</span>
          )}
        </span>
      ) : (
        <GradeValue value={value} levels={levels} decimals={decimals} />
      )}
    </div>
  )
}

/** Texto del período (informe de actuación, diagnóstico…): se despliega para leerlo o escribirlo. */
function JudgementField({
  label,
  value,
  required,
  editable,
  onSave,
}: {
  label: string
  value: string | null
  required: boolean
  editable: boolean
  onSave: (text: string | null) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) setDraft(value ?? '')
  }, [value, open])

  const filled = (value ?? '').trim() !== ''
  let state = '—'
  if (filled) state = 'cargado'
  else if (required) state = 'falta'

  async function save() {
    setBusy(true)
    try {
      await onSave(draft.trim() || null)
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="px-2 py-1.5 text-left">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left font-semibold text-amber-900 hover:underline"
        aria-expanded={open}
      >
        {label}:{' '}
        <span className={filled ? 'font-normal text-emerald-800' : 'font-normal text-slate-500'}>
          {filled && <span aria-hidden>✓ </span>}
          {state}
        </span>
      </button>
      {open && (
        <div className="mt-1 space-y-1">
          {editable ? (
            <>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={4}
                maxLength={2000}
                aria-label={label}
                className="w-full rounded border border-amber-200 px-1.5 py-1 text-xs"
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-600 hover:underline">
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void save()}
                  className="rounded bg-teal-700 px-2 py-0.5 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
                >
                  {busy ? 'Guardando…' : 'Guardar'}
                </button>
              </div>
            </>
          ) : (
            <p className="whitespace-pre-wrap text-xs text-slate-700">{value || 'Sin texto.'}</p>
          )}
        </div>
      )}
    </div>
  )
}

function BlockHeader({ period, status }: { period: LibretaPeriod; status?: Status }) {
  return (
    <p className="flex items-center justify-center gap-1 bg-amber-100 px-2 py-1.5 text-center font-semibold leading-snug text-amber-950">
      {period.name}
      {status === 'CLOSED' && (
        <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-slate-600">
          <Lock className="h-3 w-3" aria-hidden />
          cerrado
        </span>
      )}
    </p>
  )
}

function CAndR({
  period,
  saved,
  levels,
  decimals,
  editable,
  save,
}: Pick<BlockProps, 'period' | 'saved' | 'levels' | 'decimals' | 'editable'> & {
  save: (patch: PeriodGradePatch) => Promise<void>
}) {
  return (
    <>
      <PeriodGradeCell
        label="C"
        title={`C: calificación de ${period.name}`}
        value={saved?.valueHundredths ?? null}
        levels={levels}
        decimals={decimals}
        editable={editable}
        onChange={(value) => save({ valueHundredths: value })}
      />
      <PeriodGradeCell
        label="R"
        title={`R: nota de reunión de ${period.name}`}
        value={saved?.meetingValueHundredths ?? null}
        levels={levels}
        decimals={decimals}
        editable={editable}
        onChange={(value) => save({ meetingValueHundredths: value })}
      />
    </>
  )
}

const TRAMO_GRID: Record<number, string> = {
  5: 'grid-cols-5',
  6: 'grid-cols-6',
}

function TramoBlock(props: BlockProps & { save: (patch: PeriodGradePatch) => Promise<void> }) {
  const { period, grades, levels, decimals, editable, onAddGrade } = props
  const categories = blockCategories(grades)
  const buckets = gradesByCategory(grades)
  const hasText = Boolean(period.judgementLabel)
  return (
    <>
      <div className={`grid ${TRAMO_GRID[categories.length + 2]} divide-x divide-amber-100 border-t border-amber-200`}>
        {categories.map((category) => (
          <div key={category} className="px-1 py-1.5 text-center">
            <p className="whitespace-nowrap font-medium text-slate-600" title={ACTIVITY_CATEGORY_TITLE[category]}>
              {ACTIVITY_CATEGORY_LABEL[category]}
            </p>
            <GradeChips grades={buckets[category]} levels={levels} decimals={decimals} />
            {editable && onAddGrade && (
              <button
                type="button"
                onClick={() => onAddGrade(category)}
                className="mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-teal-700 hover:bg-teal-50"
                aria-label={`Agregar nota de ${ACTIVITY_CATEGORY_TITLE[category]} en ${period.name}`}
                title={`Agregar ${ACTIVITY_CATEGORY_TITLE[category].toLowerCase()}`}
              >
                <Plus className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}
        <CAndR {...props} />
      </div>
      {hasText && (
        <div className="border-t border-amber-100">
          <JudgementField
            label={judgementLabelOf(period)}
            value={props.saved?.conceptualJudgement ?? null}
            required={Boolean(period.requiresConceptualJudgement)}
            editable={editable}
            onSave={(text) => props.save({ conceptualJudgement: text })}
          />
        </div>
      )}
    </>
  )
}

function EntregaBlock(props: BlockProps & { save: (patch: PeriodGradePatch) => Promise<void> }) {
  const { period, saved, editable, save } = props
  return (
    <>
      <div className="grid grid-cols-2 divide-x divide-amber-100 border-t border-amber-200">
        <CAndR {...props} />
      </div>
      <div className="border-t border-amber-100">
        <JudgementField
          label={judgementLabelOf(period)}
          value={saved?.conceptualJudgement ?? null}
          required={Boolean(period.requiresConceptualJudgement)}
          editable={editable}
          onSave={(text) => save({ conceptualJudgement: text })}
        />
      </div>
    </>
  )
}

export default function PeriodBlock(props: BlockProps) {
  const [error, setError] = useState<string | null>(null)
  const kind = periodKind(props.period)

  async function save(patch: PeriodGradePatch) {
    setError(null)
    try {
      await props.onSave?.(patch)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar')
    }
  }

  const width = kind === 'TRAMO' ? 'w-[19rem]' : 'w-[13rem]'
  return (
    <div className={`${width} shrink-0 overflow-hidden rounded border border-amber-200 bg-white text-xs`}>
      <BlockHeader period={props.period} status={props.status} />
      {kind === 'TRAMO' && <TramoBlock {...props} save={save} />}
      {kind === 'ENTREGA' && <EntregaBlock {...props} save={save} />}
      {kind === 'DIAGNOSTICO' && (
        <div className="border-t border-amber-200">
          <JudgementField
            label={judgementLabelOf(props.period)}
            value={props.saved?.conceptualJudgement ?? null}
            required={Boolean(props.period.requiresConceptualJudgement)}
            editable={props.editable}
            onSave={(text) => save({ conceptualJudgement: text })}
          />
        </div>
      )}
      {error && (
        <p role="alert" className="border-t border-red-100 bg-red-50 px-2 py-1 text-red-800">
          {error}
        </p>
      )}
    </div>
  )
}
