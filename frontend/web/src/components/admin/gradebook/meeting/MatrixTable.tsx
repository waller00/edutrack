'use client'

import Link from 'next/link'
import { AlertTriangle, Check, FileText, Loader2, PenLine } from 'lucide-react'
import ScrollRegion from '@/components/common/ScrollRegion'
import ConductSelect, { conductText, type ConductOption } from '@/components/gradebook/ConductSelect'
import { formatHundredths } from '@/lib/academic-config/grade-value'
import { levelStyle } from '@/lib/academic-config/level-tokens'
import { formatGrade, gradeSelectOptions, type GradeRange } from '@/lib/gradebook/grade-scale'
import { studentName, subjectStatus, type JudgementState, type MeetingField } from '@/lib/gradebook/meeting-board'
import { formatAbsenceUnits } from '@/lib/libreta/absences'
import type { Matrix, MatrixCellData, MatrixRow, MatrixSubject, SaveStatus } from './types'

/** Encabezado fijo al desplazar la tabla; cada uso pone su capa (`z-10`, o `z-20` en la esquina). */
const HEAD_CELL = 'sticky top-0 border-b border-gray-200 bg-white px-2 py-2 text-left align-bottom'
const BODY_CELL = 'border-b border-gray-100 px-2 py-1.5'

/**
 * Celda de una materia: color, símbolo y valor de R. El símbolo evita depender del color (RNF 7.2).
 * Sin R, muestra la calificación que el docente cargó con el sistema anterior (antes de que C
 * pasara a ser la conducta) como propuesta, rotulada con texto y sin color de tramo, porque
 * todavía no es una nota.
 */
function SubjectCell({ cell }: Readonly<{ cell: MatrixCellData }>) {
  if (cell.pending) {
    if (cell.proposedValueHundredths != null) {
      return (
        <span
          className="inline-flex items-center gap-1 rounded border border-dashed border-gray-300 px-1.5 py-0.5 text-xs text-gray-600"
          title="Calificación propuesta por el docente; todavía sin rendimiento (R)"
        >
          <span className="text-[10px] uppercase text-gray-400">Prop.</span>
          {formatHundredths(cell.proposedValueHundredths, 0)}
        </span>
      )
    }
    return <span className="text-xs text-gray-400" title="Sin calificación del período">—</span>
  }
  const style = cell.descriptor ? levelStyle(cell.descriptor) : null
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs ${style?.badgeClass ?? 'border-gray-200 bg-gray-50 text-gray-700'}`}
      title={[cell.descriptor?.label, cell.conceptualJudgement].filter(Boolean).join(' — ') || undefined}
    >
      {style && <span aria-hidden>{style.symbol}</span>}
      {formatHundredths(cell.valueHundredths, 0)}
    </span>
  )
}

/** Guardando, guardado o rechazado: lo que se eligió nunca vuelve a «—» sin decir por qué. */
function SaveMark({ status }: Readonly<{ status?: SaveStatus }>) {
  if (status === 'saving') {
    return (
      <span className="inline-flex text-gray-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        <span className="sr-only">Guardando</span>
      </span>
    )
  }
  if (status === 'saved') {
    return (
      <span className="inline-flex text-emerald-700" title="Guardado">
        <Check className="h-3.5 w-3.5" aria-hidden />
        <span className="sr-only">Guardado</span>
      </span>
    )
  }
  if (status === 'error') {
    return (
      <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-red-700">
        <AlertTriangle className="h-3 w-3" aria-hidden />
        No se guardó
      </span>
    )
  }
  return null
}

const SELECT_CLASS = 'rounded border border-gray-300 bg-white px-1 py-0.5 text-sm'

/**
 * Rendimiento general del alumno: lo elige la reunión, con la escala del nivel. El promedio de la
 * columna de al lado es una estadística para ayudar a decidirlo; nunca llena este casillero.
 */
function PerformanceCell({
  row,
  scale,
  editable,
  status,
  onChange,
}: Readonly<{
  row: MatrixRow
  scale: GradeRange | null
  editable: boolean
  status?: SaveStatus
  onChange: (value: number | null) => void
}>) {
  const value = row.performanceValueHundredths ?? null
  if (!editable) return <span className="font-medium text-gray-900">{formatGrade(value)}</span>
  return (
    <span className="inline-flex items-center gap-1.5">
      <select
        aria-label={`Rendimiento de ${studentName(row)}`}
        value={value == null ? '' : String(value)}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className={`${SELECT_CLASS} font-medium`}
      >
        <option value="">—</option>
        {gradeSelectOptions(scale, value).map((option) => (
          <option key={option} value={String(option)}>
            {formatGrade(option)}
          </option>
        ))}
      </select>
      <SaveMark status={status} />
    </span>
  )
}

function ConductCell({
  row,
  levels,
  editable,
  status,
  onChange,
}: Readonly<{
  row: MatrixRow
  levels: readonly ConductOption[]
  editable: boolean
  status?: SaveStatus
  onChange: (value: number | null) => void
}>) {
  if (!editable) return <>{conductText(row.conductValueHundredths, levels)}</>
  return (
    <span className="inline-flex items-center gap-1.5">
      <ConductSelect
        aria-label={`Conducta de ${studentName(row)}`}
        value={row.conductValueHundredths == null ? '' : String(row.conductValueHundredths)}
        options={levels}
        onChange={(value) => onChange(value === '' ? null : Number(value))}
        className={SELECT_CLASS}
      />
      <SaveMark status={status} />
    </span>
  )
}

/** El juicio del alumno: si está escrito, y un atajo a escribirlo en «Juicios de la reunión». */
function JudgementCell({
  row,
  judgements,
  canWrite,
  onOpen,
}: Readonly<{
  row: MatrixRow
  judgements: JudgementState
  canWrite: boolean
  onOpen: (studentId: string, edit: boolean) => void
}>) {
  if (!judgements) return <span className="text-xs text-gray-400">…</span>
  const name = studentName(row)
  if (judgements.studentIds.has(row.studentId)) {
    return (
      <button
        type="button"
        onClick={() => onOpen(row.studentId, false)}
        aria-label={`Ver el juicio de ${name}`}
        className="inline-flex items-center gap-1 text-xs font-medium text-emerald-800 hover:underline"
      >
        <Check className="h-3.5 w-3.5" aria-hidden />
        Escrito
      </button>
    )
  }
  if (!canWrite) return <span className="text-xs text-gray-500">Sin juicio</span>
  return (
    <button
      type="button"
      onClick={() => onOpen(row.studentId, true)}
      aria-label={`Ir a escribir el juicio de ${name}`}
      className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline"
    >
      <PenLine className="h-3.5 w-3.5" aria-hidden />
      Escribir
    </button>
  )
}

function AlertCell({ row }: Readonly<{ row: MatrixRow }>) {
  return (
    <span className="whitespace-nowrap text-xs">
      {row.atRisk ? (
        <span className="rounded border border-red-200 bg-red-50 px-1.5 py-0.5 font-medium text-red-800">
          <span aria-hidden>▲ </span>
          {row.alertCount} en alerta
        </span>
      ) : (
        <span className="text-gray-600">{row.alertCount} en alerta</span>
      )}
      {row.pendingCount > 0 && <span className="ml-1 text-gray-500">· {row.pendingCount} sin R</span>}
    </span>
  )
}

function SubjectHeader({ subject }: Readonly<{ subject: MatrixSubject }>) {
  const status = subjectStatus(subject.periodStatus)
  return (
    <span className="flex min-w-[6.5rem] flex-col gap-0.5">
      <span className="text-xs font-semibold text-gray-800">{subject.name}</span>
      {subject.teacher && <span className="truncate text-[11px] font-normal text-gray-500">{subject.teacher}</span>}
      <span className={`inline-flex w-fit items-center gap-1 rounded px-1 text-[11px] font-medium ${status.className}`}>
        <span aria-hidden>{status.symbol}</span>
        {status.label}
      </span>
    </span>
  )
}

/** Encabezado de una columna de la reunión: qué es y quién la decide. */
function MeetingHeader({ label, hint, tour }: Readonly<{ label: string; hint: string; tour?: string }>) {
  return (
    <th scope="col" data-tour={tour} className={`${HEAD_CELL} z-10 !bg-emerald-50`}>
      <span className="flex flex-col gap-0.5">
        <span className="text-xs font-semibold text-gray-800">{label}</span>
        <span className="text-[11px] font-normal text-gray-500">{hint}</span>
      </span>
    </th>
  )
}

export type MatrixTableProps = {
  matrix: Matrix
  /** Las filas que deja el filtro, en el orden de la lista. */
  rows: readonly MatrixRow[]
  /** N.º de lista de cada alumno: no cambia al filtrar, para nombrarlo en la reunión. */
  numberOf: ReadonlyMap<string, number>
  projection: boolean
  backTo: string
  canEdit: boolean
  judgements: JudgementState
  reportCard: boolean
  downloading: string | null
  saves: Readonly<Record<string, SaveStatus>>
  onReportCard: (row: MatrixRow) => void
  onSave: (field: MeetingField, row: MatrixRow, value: number | null) => void
  onOpenJudgement: (studentId: string, edit: boolean) => void
}

export const saveKey = (field: MeetingField, studentId: string) => `${field}:${studentId}`

/**
 * La matriz de la reunión: las R de cada materia (con el estado de cada libreta en el
 * encabezado), y a la derecha lo que decide la reunión. El encabezado y la columna del alumno
 * quedan fijos al desplazarse.
 */
export default function MatrixTable(props: Readonly<MatrixTableProps>) {
  const { matrix, rows, projection } = props
  const conductLevels = matrix.conductLevels ?? []
  return (
    <ScrollRegion
      label="Matriz de calificaciones del grupo"
      tour="reunion.matrix"
      className="max-h-[75vh] overflow-auto rounded-xl border border-gray-200 bg-white"
    >
      <table className={`w-full border-separate border-spacing-0 ${projection ? 'text-base' : 'text-sm'}`}>
        <thead>
          <tr>
            <th scope="col" className={`${HEAD_CELL} left-0 z-20 min-w-[12rem]`}>
              <span className="text-xs font-semibold text-gray-800">Estudiante</span>
            </th>
            {matrix.subjects.map((s) => (
              <th key={s.gradeBookId} scope="col" className={`${HEAD_CELL} z-10`}>
                <SubjectHeader subject={s} />
              </th>
            ))}
            <MeetingHeader label="Promedio" hint="referencia" />
            <MeetingHeader label="Rendimiento" hint="lo decide la reunión" tour="reunion.performance" />
            <MeetingHeader label="Conducta" hint="adscripción" />
            <MeetingHeader label="Juicio" hint="va al boletín" />
            <th scope="col" className={`${HEAD_CELL} z-10`}>
              <span className="flex flex-col gap-0.5">
                <span className="text-xs font-semibold text-gray-800">Faltas</span>
                <span className="text-[11px] font-normal text-gray-500">del ciclo, en el liceo</span>
              </span>
            </th>
            <th scope="col" className={`${HEAD_CELL} z-10`}>
              <span className="text-xs font-semibold text-gray-800">Alertas</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={matrix.subjects.length + 7} className="px-3 py-6 text-center text-sm text-gray-500">
                Nadie en este filtro.
              </td>
            </tr>
          )}
          {rows.map((row) => (
            <MatrixTableRow key={row.studentId} row={row} conductLevels={conductLevels} {...props} />
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  )
}

function MatrixTableRow({
  row,
  conductLevels,
  matrix,
  numberOf,
  backTo,
  canEdit,
  judgements,
  reportCard,
  downloading,
  saves,
  onReportCard,
  onSave,
  onOpenJudgement,
}: Readonly<MatrixTableProps & { row: MatrixRow; conductLevels: readonly ConductOption[] }>) {
  const name = studentName(row)
  // La columna fija necesita un fondo sólido: con uno translúcido, las materias se leían por debajo.
  const rowBg = row.atRisk ? 'bg-rose-50' : 'bg-white'
  return (
    <tr className={rowBg}>
      <td className={`${BODY_CELL} sticky left-0 z-[5] ${rowBg}`}>
        <span className="inline-flex items-center gap-2">
          <span className="w-5 text-right text-xs tabular-nums text-gray-400">{numberOf.get(row.studentId)}</span>
          <Link
            href={`/libreta/estudiante/${row.studentId}?volver=${encodeURIComponent(backTo)}`}
            className="font-medium text-emerald-800 hover:underline"
          >
            {name}
          </Link>
          {reportCard && (
            <button
              type="button"
              disabled={downloading !== null}
              onClick={() => onReportCard(row)}
              aria-label={`Boletín de ${name}`}
              title="Descargar el boletín"
              className="text-gray-400 hover:text-emerald-700 disabled:opacity-40"
            >
              {downloading === row.studentId ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <FileText className="h-3.5 w-3.5" aria-hidden />
              )}
            </button>
          )}
        </span>
      </td>
      {row.cells.map((cell) => (
        <td key={cell.gradeBookId} className={BODY_CELL}>
          <SubjectCell cell={cell} />
        </td>
      ))}
      <td className={`${BODY_CELL} border-l border-l-emerald-200 tabular-nums text-gray-700`}>
        {formatHundredths(row.averageHundredths, matrix.averageDecimals ?? 1)}
      </td>
      <td className={BODY_CELL}>
        <PerformanceCell
          row={row}
          scale={matrix.performanceScale ?? null}
          editable={canEdit}
          status={saves[saveKey('performance', row.studentId)]}
          onChange={(value) => onSave('performance', row, value)}
        />
      </td>
      <td className={`${BODY_CELL} text-gray-700`}>
        <ConductCell
          row={row}
          levels={conductLevels}
          editable={canEdit}
          status={saves[saveKey('conduct', row.studentId)]}
          onChange={(value) => onSave('conduct', row, value)}
        />
      </td>
      <td className={`${BODY_CELL} border-r border-r-emerald-200`}>
        <JudgementCell row={row} judgements={judgements} canWrite={canEdit} onOpen={onOpenJudgement} />
      </td>
      <td className={`${BODY_CELL} tabular-nums text-gray-700`}>{formatAbsenceUnits(row.absenceHundredths ?? 0)}</td>
      <td className={BODY_CELL}>
        <AlertCell row={row} />
      </td>
    </tr>
  )
}
