import ExcelJS from 'exceljs'
import { formatWorksheetForExport } from '../analytics/exports/excel-format.js'
import type { MoodleAssignment } from '../../integrations/moodle/grades.js'

/**
 * Planilla de notas offline (puente EduTrack↔Moodle).
 *
 * `buildGradeWorkbook` genera un `.xlsx` con una hoja por tarea Moodle (roster + nota actual); la
 * columna "Nota nueva" es la única editable (validación 0..máx). Cada hoja embebe una celda de
 * metadatos (`et-gradesheet|…`) que identifica asignatura/tarea/orientación, así la subida no
 * depende de los filtros elegidos al descargar. `parseGradeWorkbook` lee esa planilla de vuelta y
 * devuelve las filas por `idnumber` (clave estable `et-student-<id>`), sin confiar en el nombre
 * —que el usuario podría editar— para identificar al alumno.
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

/** Identificación embebida de la hoja: a qué asignatura/tarea/orientación pertenece. */
export type GradeSheetMeta = {
  subjectId: string
  assignmentId: number
  courseOrientationId: string | null
  orientationId: string | null
}

export type GradeWorkbookEntry = {
  /** Etiqueta legible del curso/asignatura (para el título). */
  courseLabel: string
  assignment: MoodleAssignment
  students: GradeSheetStudent[]
  meta: GradeSheetMeta
  /** Nombre sugerido de la hoja (se sanea, trunca a 31 chars y desambigua). */
  sheetTitle: string
}

const HEADERS = ['Alumno', 'idnumber', 'Nota actual', 'Nota nueva'] as const
const HEADER_ROW = 2
const COL_IDNUMBER = 2
const COL_NEW_GRADE = 4
/** Columna (oculta) donde se escribe la celda de metadatos, en la fila del título. */
const COL_META = 6

const META_PREFIX = 'et-gradesheet'
const META_VERSION = 'v1'

function encodeMeta(meta: GradeSheetMeta): string {
  return [
    META_PREFIX,
    META_VERSION,
    meta.subjectId,
    String(meta.assignmentId),
    meta.courseOrientationId ?? '',
    meta.orientationId ?? '',
  ].join('|')
}

/** Decodifica una celda de metadatos, o `null` si no tiene el formato esperado. */
function decodeMeta(value: string): GradeSheetMeta | null {
  const parts = value.split('|')
  if (parts[0] !== META_PREFIX || parts[1] !== META_VERSION || parts.length < 6) return null
  const assignmentId = Number(parts[3])
  if (!parts[2] || !Number.isInteger(assignmentId) || assignmentId <= 0) return null
  return {
    subjectId: parts[2],
    assignmentId,
    courseOrientationId: parts[4] || null,
    orientationId: parts[5] || null,
  }
}

/** Nombre de hoja válido para Excel: sin `\/*?:[]`, ≤31 chars y único dentro del workbook. */
function safeSheetName(title: string, used: Set<string>): string {
  const base = (title.replace(/[\\/*?:[\]]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Notas').slice(0, 31)
  let candidate = base
  let n = 2
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${n})`
    candidate = base.slice(0, 31 - suffix.length) + suffix
    n += 1
  }
  used.add(candidate.toLowerCase())
  return candidate
}

/** Agrega la hoja de una tarea al workbook: título, roster y columna editable protegida. */
async function addGradeSheet(workbook: ExcelJS.Workbook, entry: GradeWorkbookEntry, used: Set<string>): Promise<void> {
  const { courseLabel, assignment, students } = entry
  const sheet = workbook.addWorksheet(safeSheetName(entry.sheetTitle, used))

  const maxLabel = assignment.maxGrade != null ? ` — máx: ${assignment.maxGrade}` : ''
  sheet.addRow([`Notas — ${assignment.name} (${courseLabel})${maxLabel}`])
  sheet.addRow([...HEADERS])

  for (const s of students) {
    const name = s.hasMoodleAccount ? s.name : `${s.name} (sin cuenta Moodle)`
    sheet.addRow([name, s.idnumber, s.currentGrade ?? '', ''])
  }

  formatWorksheetForExport(sheet, { headerRow: HEADER_ROW, autoFilter: false })

  // Celda de metadatos: en la fila del título, columna oculta y bloqueada.
  sheet.getRow(1).getCell(COL_META).value = encodeMeta(entry.meta)
  sheet.getColumn(COL_META).hidden = true

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
}

/** Genera el `.xlsx` de carga de notas: una hoja por tarea. */
export async function buildGradeWorkbook(entries: GradeWorkbookEntry[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const used = new Set<string>()
  for (const entry of entries) {
    await addGradeSheet(workbook, entry, used)
  }
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

export type ParsedGradeSheet = {
  sheetName: string
  /** Metadatos embebidos, o `null` en planillas viejas/externas (el llamador decide el fallback). */
  meta: GradeSheetMeta | null
  rows: ParsedGradeRow[]
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

/** Busca la celda de metadatos en las primeras filas de la hoja. */
function findMeta(sheet: ExcelJS.Worksheet): GradeSheetMeta | null {
  let meta: GradeSheetMeta | null = null
  sheet.eachRow((row, rowNumber) => {
    if (meta || rowNumber > HEADER_ROW + 1) return
    row.eachCell((cell) => {
      if (meta) return
      const text = cellText(cell.value).trim()
      if (text.startsWith(`${META_PREFIX}|`)) meta = decodeMeta(text)
    })
  })
  return meta
}

/** Lee las filas de notas de una hoja. Localiza el encabezado por sus columnas conocidas. */
function parseSheetRows(sheet: ExcelJS.Worksheet): ParsedGradeRow[] {
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

/** Lee una planilla de notas subida: todas las hojas, cada una con sus metadatos (si los tiene). */
export async function parseGradeWorkbook(buffer: Buffer): Promise<ParsedGradeSheet[]> {
  const workbook = new ExcelJS.Workbook()
  // ExcelJS acepta un Buffer de Node en runtime; el cast salva el desajuste de tipos con @types/node.
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)
  return workbook.worksheets.map((sheet) => ({
    sheetName: sheet.name,
    meta: findMeta(sheet),
    rows: parseSheetRows(sheet),
  }))
}
