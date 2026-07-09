import ExcelJS from 'exceljs'
import { formatWorksheetForExport } from '../analytics/exports/excel-format.js'
import type { MoodleAssignment } from '../../integrations/moodle/grades.js'

/**
 * Planilla de notas offline (puente EduTrack↔Moodle).
 *
 * `buildGradeSheet` genera un `.xlsx` con el roster de una tarea Moodle y su nota actual; la
 * columna "Nota nueva" es la única editable (validación 0..máx). `parseGradeSheet` lee esa planilla
 * de vuelta y devuelve las filas por `idnumber` (clave estable `et-student-<id>`), sin confiar en
 * el nombre —que el usuario podría editar— para identificar al alumno.
 */

export type GradeSheetStudent = {
  /** Nombre visible del alumno (sólo informativo). */
  name: string
  /** Clave estable e inmutable: `et-student-<studentId>`. */
  idnumber: string
  /** Nota actual en Moodle (prellenada), o `null` si no tiene. */
  currentGrade: number | null
  /** `false` si el alumno todavía no tiene cuenta Moodle (se marca y no se puede calificar). */
  hasMoodleAccount: boolean
}

export type BuildGradeSheetArgs = {
  /** Etiqueta legible del curso/asignatura (para el título). */
  courseLabel: string
  assignment: MoodleAssignment
  students: GradeSheetStudent[]
}

const HEADERS = ['Alumno', 'idnumber', 'Nota actual', 'Nota nueva'] as const
const HEADER_ROW = 2
const COL_IDNUMBER = 2
const COL_NEW_GRADE = 4

/** Genera el `.xlsx` de carga de notas. La columna "Nota nueva" queda desbloqueada; el resto, protegido. */
export async function buildGradeSheet(args: BuildGradeSheetArgs): Promise<Buffer> {
  const { courseLabel, assignment, students } = args
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Notas')

  const maxLabel = assignment.maxGrade != null ? ` — máx: ${assignment.maxGrade}` : ''
  sheet.addRow([`Notas — ${assignment.name} (${courseLabel})${maxLabel}`])
  sheet.addRow([...HEADERS])

  for (const s of students) {
    const name = s.hasMoodleAccount ? s.name : `${s.name} (sin cuenta Moodle)`
    sheet.addRow([name, s.idnumber, s.currentGrade ?? '', ''])
  }

  formatWorksheetForExport(sheet, { headerRow: HEADER_ROW, autoFilter: false })

  // La columna editable: desbloqueada + validación de rango cuando hay nota máxima de puntaje.
  const firstDataRow = HEADER_ROW + 1
  const lastDataRow = HEADER_ROW + students.length
  for (let row = firstDataRow; row <= lastDataRow; row += 1) {
    const cell = sheet.getRow(row).getCell(COL_NEW_GRADE)
    cell.protection = { locked: false }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7CC' } }
    if (assignment.gradeType === 'point' && assignment.maxGrade != null) {
      cell.dataValidation = {
        type: 'decimal',
        operator: 'between',
        allowBlank: true,
        formulae: [0, assignment.maxGrade],
        showErrorMessage: true,
        errorStyle: 'error',
        errorTitle: 'Nota inválida',
        error: `Ingresá un número entre 0 y ${assignment.maxGrade}.`,
      }
    }
  }

  // Protege la hoja para que sólo "Nota nueva" sea editable (sin contraseña, permite navegar celdas).
  await sheet.protect('', { selectLockedCells: true, selectUnlockedCells: true })

  const arrayBuffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(arrayBuffer)
}

export type ParsedGradeRow = {
  idnumber: string
  /** Valor crudo de la celda "Nota nueva" (para mensajes de error). */
  raw: string
  /** Número parseado, o `null` si la celda está vacía / no es numérica. */
  grade: number | null
  /** Fila de Excel (1-based) para reportar errores al usuario. */
  rowNumber: number
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') {
    const o = value as any
    if (o.text != null) return String(o.text)
    if (o.result != null) return String(o.result)
    if (Array.isArray(o.richText)) return o.richText.map((r: any) => r.text ?? '').join('')
    return ''
  }
  return String(value)
}

/**
 * Lee una planilla de notas subida. Localiza la fila de encabezado por sus columnas conocidas
 * (tolera filas de título arriba) y devuelve sólo las filas con `idnumber` presente.
 */
export async function parseGradeSheet(buffer: Buffer): Promise<ParsedGradeRow[]> {
  const workbook = new ExcelJS.Workbook()
  // ExcelJS acepta un Buffer de Node en runtime; el cast salva el desajuste de tipos con @types/node.
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)
  const sheet = workbook.worksheets[0]
  if (!sheet) return []

  // Ubicar la fila de encabezado (por si el título ocupa filas arriba).
  let headerRow = HEADER_ROW
  let idnumberCol = COL_IDNUMBER
  let newGradeCol = COL_NEW_GRADE
  sheet.eachRow((row, rowNumber) => {
    const cells = (row.values as ExcelJS.CellValue[]) || []
    const idIdx = cells.findIndex((v) => cellText(v).trim().toLowerCase() === 'idnumber')
    const gradeIdx = cells.findIndex((v) => cellText(v).trim().toLowerCase() === 'nota nueva')
    if (idIdx > 0 && gradeIdx > 0) {
      headerRow = rowNumber
      idnumberCol = idIdx
      newGradeCol = gradeIdx
    }
  })

  const rows: ParsedGradeRow[] = []
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRow) return
    const idnumber = cellText(row.getCell(idnumberCol).value).trim()
    if (!idnumber) return
    const raw = cellText(row.getCell(newGradeCol).value).trim()
    const parsed = raw === '' ? null : Number(raw.replace(',', '.'))
    rows.push({
      idnumber,
      raw,
      grade: parsed != null && Number.isFinite(parsed) ? parsed : null,
      rowNumber,
    })
  })
  return rows
}
