/** Tipos compartidos de la parametrización académica (espejo de `admin-academic-config.ts`). */

export type ScaleKind = 'NUMERIC' | 'ORDINAL'
export type AcademicLevel = 'EBI' | 'EMS'

export type ScaleLevel = {
  id: string
  code: string
  label: string
  descriptor: string | null
  minValueHundredths: number
  maxValueHundredths: number
  colorToken: string | null
  iconToken: string | null
  isPassing: boolean
  isAlert: boolean
  sortOrder: number
}

export type ScaleGap = { fromHundredths: number; toHundredths: number }

export type GradingScale = {
  id: string
  code: string
  name: string
  kind: ScaleKind
  minValueHundredths: number | null
  maxValueHundredths: number | null
  decimals: number
  description: string | null
  isActive: boolean
  sortOrder: number
  levels: ScaleLevel[]
  gaps: ScaleGap[]
  /** Cuántas evaluaciones vivas la usan. Reescribir sus tramos re-clasifica esas notas. */
  usage: { assessments: number }
}

export type AcademicPeriod = {
  id: string
  schoolYearId: string
  level: AcademicLevel
  code: string
  name: string
  sortOrder: number
  /** Día civil `YYYY-MM-DD`, no instante. */
  startsOn: string | null
  endsOn: string | null
  closesOn: string | null
  requiresConceptualJudgement: boolean
  /** Exige C (la calificación del docente) para cerrar. */
  requiresGeneralGrade: boolean
  kind: PeriodKind
  /** Lleva reunión: tiene R y aparece en reunión, boletín, visado y control. */
  isMeeting: boolean
  /** Nombre del texto del período ("Informe de actuación", "Diagnóstico"…). */
  judgementLabel: string | null
  isActive: boolean
  usage: { assessments: number; closedGradeBooks: number }
}

/** Forma del período en la libreta, igual que los bloques de la planilla del liceo. */
export type PeriodKind = 'DIAGNOSTICO' | 'TRAMO' | 'ENTREGA'

export const PERIOD_KIND_SHORT: Record<PeriodKind, string> = {
  DIAGNOSTICO: 'Diagnóstico',
  TRAMO: 'Tramo',
  ENTREGA: 'Entrega',
}

export const PERIOD_KIND_LABELS: Record<PeriodKind, string> = {
  DIAGNOSTICO: 'Diagnóstico (sólo texto)',
  TRAMO: 'Tramo de trabajo (Or · Otras · Ev · C · R)',
  ENTREGA: 'Entrega (informe · C · R)',
}

export type ActivityCategoryCode = 'ORAL' | 'OTRAS' | 'ESCRITO' | 'PRUEBA'

/** Columna de la planilla del liceo, con su rótulo y su nombre completo. */
export const ACTIVITY_CATEGORY_OPTIONS: ReadonlyArray<{ code: ActivityCategoryCode; label: string }> = [
  { code: 'ORAL', label: 'Or — orales' },
  { code: 'OTRAS', label: 'Otras — otras actividades' },
  { code: 'ESCRITO', label: 'Ev — evaluaciones escritas' },
  { code: 'PRUEBA', label: 'Prueba — prueba semestral' },
]

export type ActivityType = {
  id: string
  code: string
  name: string
  description: string | null
  /** Columna de la planilla en la que cae: Or, Otras, Ev o Prueba. */
  category: ActivityCategoryCode
  scope: 'GLOBAL' | 'TEACHER'
  isActive: boolean
  sortOrder: number
  usage: { assessments: number }
}

export const LEVEL_LABELS: Record<AcademicLevel, string> = {
  EBI: 'Educación Básica Integrada (7.º · 8.º · 9.º)',
  EMS: 'Educación Media Superior (1.º · 2.º · 3.º)',
}

export const LEVEL_SHORT_LABELS: Record<AcademicLevel, string> = {
  EBI: 'EBI',
  EMS: 'EMS',
}
