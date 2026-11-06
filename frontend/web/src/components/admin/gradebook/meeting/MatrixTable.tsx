'use client'

import { Check, FileText, Loader2, PenLine } from 'lucide-react'
import ScrollRegion from '@/components/common/ScrollRegion'
import type { ConductOption } from '@/components/gradebook/ConductSelect'
import { formatHundredths } from '@/lib/academic-config/grade-value'
import { studentName, subjectStatus, type JudgementState, type MeetingField } from '@/lib/gradebook/meeting-board'
import { formatAbsenceUnits } from '@/lib/libreta/absences'
import { ConductInput, GradeBadge, PerformanceInput } from './cells'
import type { Matrix, MatrixCellData, MatrixRow, MatrixSubject, SaveStatus } from './types'

/** Encabezado fijo al desplazar la tabla; cada uso pone su capa (`z-10`, o `z-20` en la esquina). */
const HEAD_CELL = 'sticky top-0 border-b border-gray-200 bg-white px-2 py-2 text-left align-bottom'
const BODY_CELL = 'whitespace-nowrap border-b border-gray-100 px-2 py-1.5'

/** «Matemática de García, Marcos: 3, En proceso. Ver detalle»: lo que dice la celda, para el lector. */
function cellLabel(subject: string, row: MatrixRow, cell: MatrixCellData): string {
  let value = 'sin nota'
  if (cell.valueHundredths != null) {
    value = [formatHundredths(cell.valueHundredths, 0), cell.descriptor?.label].filter(Boolean).join(', ')
  } else if (cell.proposedValueHundredths != null) {
    value = `propuesta ${formatHundredths(cell.proposedValueHundredths, 0)}, sin R`
  }
  return `${subject} de ${studentName(row)}: ${value}. Ver detalle`
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
    <span className="flex w-[7.5rem] flex-col gap-0.5">
      <span className="text-xs font-semibold leading-tight text-gray-800">{subject.name}</span>
      {subject.teacher && (
        <span className="truncate text-[11px] font-normal text-gray-500" title={subject.teacher}>
          {subject.teacher}
        </span>
      )}
      <span className={`inline-flex w-fit items-center gap-1 whitespace-nowrap rounded px-1 text-[11px] font-medium ${status.className}`}>
        <span aria-hidden>{status.symbol}</span>
        {status.label}
      </span>
    </span>
  )
}

/** Encabezado de una columna de la reunión: qué es y quién la decide. */
function MeetingHeader({ label, hint, tour }: Readonly<{ label: string; hint: string; tour?: string }>) {
  return (
    <th scope="col" data-tour={tour} className={`${HEAD_CELL} z-10 whitespace-nowrap !bg-emerald-50`}>
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
  canEdit: boolean
  judgements: JudgementState
  reportCard: boolean
  downloading: string | null
  saves: Readonly<Record<string, SaveStatus>>
  onReportCard: (row: MatrixRow) => void
  onSave: (field: MeetingField, row: MatrixRow, value: number | null) => void
  onOpenJudgement: (studentId: string, edit: boolean) => void
  /** Abre el panel del alumno; con una libreta, en esa materia. */
  onOpenStudent: (studentId: string, gradeBookId: string | null) => void
  /** El alumno del panel abierto: su fila queda marcada. */
  activeStudentId?: string | null
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
  const subjectNames = new Map(matrix.subjects.map((s) => [s.gradeBookId, s.name]))
  return (
    <ScrollRegion
      label="Matriz de calificaciones del grupo"
      tour="reunion.matrix"
      className="relative max-h-[75vh] overflow-auto rounded-xl border border-gray-200 bg-white"
    >
      {/*
        La página corta palabras en cualquier letra (`overflow-wrap: anywhere` de `.responsive-page`,
        y en el teléfono además `white-space: normal` en toda celda): en una tabla eso deja cada
        columna del ancho de una letra y la tabla se aprieta en vez de desplazarse.
        `table-keep-words` (globals.css) corta sólo entre palabras y respeta `whitespace-nowrap`.
        `border-separate` (que la página pisa con `collapse`) mantiene el borde del encabezado fijo.
      */}
      <table className={`table-keep-words w-full !border-separate border-spacing-0 ${projection ? 'text-base' : 'text-sm'}`}>
        <thead>
          <tr>
            <th scope="col" className={`${HEAD_CELL} left-0 z-20`}>
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
            <th scope="col" className={`${HEAD_CELL} z-10 whitespace-nowrap`}>
              <span className="flex flex-col gap-0.5">
                <span className="text-xs font-semibold text-gray-800">Faltas</span>
                <span className="text-[11px] font-normal text-gray-500">del ciclo, en el liceo</span>
              </span>
            </th>
            <th scope="col" className={`${HEAD_CELL} z-10 whitespace-nowrap`}>
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
            <MatrixTableRow key={row.studentId} row={row} conductLevels={conductLevels} subjectNames={subjectNames} {...props} />
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
  subjectNames,
  canEdit,
  judgements,
  reportCard,
  downloading,
  saves,
  onReportCard,
  onSave,
  onOpenJudgement,
  onOpenStudent,
  activeStudentId,
}: Readonly<
  MatrixTableProps & { row: MatrixRow; conductLevels: readonly ConductOption[]; subjectNames: ReadonlyMap<string, string> }
>) {
  const name = studentName(row)
  // La columna fija necesita un fondo sólido: con uno translúcido, las materias se leían por debajo.
  const active = activeStudentId === row.studentId
  let rowBg = 'bg-white'
  if (active) rowBg = 'bg-emerald-50'
  else if (row.atRisk) rowBg = 'bg-rose-50'
  return (
    <tr className={rowBg} aria-current={active ? 'true' : undefined}>
      <td className={`${BODY_CELL} sticky left-0 z-[5] ${rowBg}`}>
        <span className="inline-flex items-center gap-2">
          <span className="w-5 text-right text-xs tabular-nums text-gray-400">{numberOf.get(row.studentId)}</span>
          <button
            type="button"
            onClick={() => onOpenStudent(row.studentId, null)}
            aria-label={`Ver a ${name} en la reunión`}
            className="font-medium text-emerald-800 hover:underline"
          >
            {name}
          </button>
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
          <button
            type="button"
            onClick={() => onOpenStudent(row.studentId, cell.gradeBookId)}
            aria-label={cellLabel(subjectNames.get(cell.gradeBookId) ?? 'Materia', row, cell)}
            className="rounded hover:ring-2 hover:ring-emerald-300 focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            <GradeBadge
              valueHundredths={cell.pending ? null : cell.valueHundredths}
              descriptor={cell.descriptor}
              proposedValueHundredths={cell.proposedValueHundredths}
            />
          </button>
        </td>
      ))}
      <td className={`${BODY_CELL} border-l border-l-emerald-200 tabular-nums text-gray-700`}>
        {formatHundredths(row.averageHundredths, matrix.averageDecimals ?? 1)}
      </td>
      <td className={BODY_CELL}>
        <PerformanceInput
          row={row}
          scale={matrix.performanceScale ?? null}
          editable={canEdit}
          status={saves[saveKey('performance', row.studentId)]}
          onChange={(value) => onSave('performance', row, value)}
        />
      </td>
      <td className={`${BODY_CELL} text-gray-700`}>
        <ConductInput
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
