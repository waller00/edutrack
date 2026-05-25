/**
 * Catálogo académico DGES (referencia 2026) — solo datos, sin Prisma.
 * Separación: catálogo global vs oferta por ciclo lectivo.
 */

export type AcademicLevelCode = 'EBI' | 'EMS'

export type CatalogCourse = {
  code: string
  name: string
  level: AcademicLevelCode
  sortOrder: number
}

export type CatalogOrientation = {
  code: string
  name: string
  sortOrder: number
}

export type CoursePlan = {
  /** Asignaturas del curso sin orientación (EBI / 1 EMS obligatorias). */
  obligatorias?: readonly string[]
  /** Tronco común EMS (aplica a todo el curso, sin duplicar por orientación). */
  troncoComun?: readonly string[]
  /** Código de orientación → asignaturas específicas. */
  orientaciones?: Readonly<Record<string, readonly string[]>>
  /** Espacio optativo de autonomía curricular (catálogo; oferta por ciclo después). */
  optativas?: readonly string[]
}

export type SchoolYearOfferConfig = {
  /** Código de curso → ofertado en el liceo ese año. */
  courses: Readonly<Record<string, boolean>>
  /** courseCode → orientationCode → ofertada. Omitido = no aplica o hereda false si el curso no se oferta. */
  orientations?: Readonly<Record<string, Readonly<Record<string, boolean>>>>
}

export const ACADEMIC_LEVEL_LABELS: Record<AcademicLevelCode, string> = {
  EBI: 'Educación Básica Integrada',
  EMS: 'Educación Media Superior',
}

export const CATALOG_COURSES: readonly CatalogCourse[] = [
  { code: '7-EBI', name: '7 EBI', level: 'EBI', sortOrder: 70 },
  { code: '8-EBI', name: '8 EBI', level: 'EBI', sortOrder: 80 },
  { code: '9-EBI', name: '9 EBI', level: 'EBI', sortOrder: 90 },
  { code: '1-EMS', name: '1 EMS', level: 'EMS', sortOrder: 110 },
  { code: '2-EMS', name: '2 EMS', level: 'EMS', sortOrder: 120 },
  { code: '3-EMS', name: '3 EMS', level: 'EMS', sortOrder: 130 },
] as const

export const CATALOG_ORIENTATIONS: readonly CatalogOrientation[] = [
  { code: 'CREATIVO-ARTISTICO', name: 'Creativo Artístico', sortOrder: 10 },
  { code: 'CIENCIAS-VIDA', name: 'Ciencias de la Vida', sortOrder: 20 },
  { code: 'CIENCIA-TECNOLOGIA', name: 'Ciencia y Tecnología', sortOrder: 30 },
  { code: 'CSOCIALES-HUMANIDADES', name: 'Ciencias Sociales y Humanidades', sortOrder: 40 },
  { code: 'CIENCIA-ARTE-DISENO', name: 'Ciencia, Arte y Diseño', sortOrder: 50 },
  { code: 'HH-CIENCIAS-ECONOMICAS', name: 'Humanidades y Ciencias Económicas', sortOrder: 60 },
  { code: 'HH-CIENCIA-POLITICA', name: 'Humanidades y Ciencia Política', sortOrder: 70 },
  { code: 'GENERAL', name: 'General', sortOrder: 80 },
] as const

const OPTATIVAS_1_EMS = [
  'Deporte y Recreación',
  'Argumentación y Debate',
  'Economía para Jóvenes',
  'Geografía y Gestión Ambiental',
  'Ciencias Computacionales y Tecnologías Digitales',
  'Participación Juvenil',
  'Danza',
  'Patrimonio, Identidad y Diversidad Local',
  'Educación Musical',
  'Lenguaje Audiovisual',
] as const

const OPTATIVAS_2_3_EMS = [
  'Deporte y Recreación',
  'Educación Financiera',
  'Patrimonio Cultural',
  'Ciencias de la Computación',
  'Ciencias del Espacio y Tecnologías Aplicadas',
  'Salud y Bienestar',
  'Comunicación Audiovisual',
  'Cooperativismo',
  'Educación Sexual Integral',
  'Taller de Expresión Escrita-Creativa',
] as const

/** Plan de estudios por curso (catálogo completo). */
export const COURSE_PLANS: Readonly<Record<string, CoursePlan>> = {
  '7-EBI': {
    obligatorias: [
      'Idioma Español',
      'Inglés',
      'Matemática',
      'Biología',
      'Geografía',
      'Historia',
      'Comunicación Visual',
      'Educación Física y Recreación',
      'Ciencias de la Computación',
      'Ciencias Físico-Química',
      'Educación Musical',
    ],
  },
  '8-EBI': {
    obligatorias: [
      'Idioma Español',
      'Inglés',
      'Matemática',
      'Biología',
      'Geografía',
      'Historia',
      'Comunicación Visual',
      'Educación Física y Recreación',
      'Ciencias de la Computación',
      'Ciencias Físico-Química',
      'Educación Musical',
      'Educación Ciudadana',
    ],
  },
  '9-EBI': {
    obligatorias: [
      'Idioma Español',
      'Inglés',
      'Matemática',
      'Biología',
      'Geografía',
      'Historia',
      'Comunicación Visual',
      'Educación Física y Recreación',
      'Ciencias de la Computación',
      'Química',
      'Educación Musical',
      'Educación Ciudadana',
      'Física',
      'Literatura',
    ],
  },
  '1-EMS': {
    troncoComun: [
      'Literatura',
      'Matemática',
      'Inglés',
      'Astronomía',
      'Biología',
      'Física',
      'Química',
      'Comunicación Visual y Diseño',
      'Educación Física',
      'Filosofía',
      'Historia',
    ],
    optativas: OPTATIVAS_1_EMS,
  },
  '2-EMS': {
    troncoComun: [
      'Inglés',
      'Matemática',
      'Literatura',
      'Comunicación Visual y Diseño',
      'Filosofía',
      'Educación Ciudadana',
    ],
    orientaciones: {
      'CREATIVO-ARTISTICO': [
        'Historia del Arte',
        'Danza',
        'Educación Física',
        'Música',
        'Teatro',
        'Biología',
      ],
      'CIENCIAS-VIDA': ['Biología', 'Física', 'Química', 'Geografía'],
      'CIENCIA-TECNOLOGIA': ['Matemática CTM', 'Química', 'Física', 'Biología'],
      'CSOCIALES-HUMANIDADES': ['Historia', 'Sociología', 'Geografía', 'Biología'],
    },
    optativas: OPTATIVAS_2_3_EMS,
  },
  '3-EMS': {
    troncoComun: [
      'Inglés',
      'Filosofía y Crítica de los Saberes',
      'Literatura',
      'Metodología de la Investigación',
    ],
    orientaciones: {
      'CIENCIAS-VIDA': [
        'Química',
        'Matemática CV',
        'Física',
        'Biología Vegetal',
        'Biología Humana',
      ],
      'CIENCIA-ARTE-DISENO': [
        'Historia del Arte',
        'Matemática CTA',
        'Física CTA',
        'Comunicación Visual y Diseño',
        'Matemática CT',
      ],
      'CIENCIA-TECNOLOGIA': [
        'Matemática CTQ',
        'Química',
        'Física',
        'Matemática CT',
        'Comunicación Visual y Diseño',
      ],
      'HH-CIENCIAS-ECONOMICAS': [
        'Matemática CSH1',
        'Administración y Contabilidad',
        'Economía y Educación Financiera',
        'Historia Económica',
        'Matemática CSH2',
      ],
      'HH-CIENCIA-POLITICA': [
        'Historia',
        'Derecho y Ciencia Política',
        'Matemática CSH1',
        'Economía y Educación Financiera',
        'Administración y Contabilidad',
      ],
      'CREATIVO-ARTISTICO': [
        'Historia del Arte',
        'Música',
        'Danza',
        'Comunicación Visual y Diseño',
        'Teatro',
        'Medios Audiovisuales',
      ],
      GENERAL: [
        'Matemática',
        'Administración y Economía',
        'Historia',
        'Ciudadanía y Participación',
        'Geografía',
      ],
    },
    optativas: OPTATIVAS_2_3_EMS,
  },
}

/** Oferta real del liceo por año calendario del ciclo. */
export const SCHOOL_YEAR_OFFERS: Readonly<Record<number, SchoolYearOfferConfig>> = {
  2026: {
    courses: {
      '7-EBI': true,
      '8-EBI': true,
      '9-EBI': true,
      '1-EMS': true,
      '2-EMS': false,
      '3-EMS': true,
    },
    orientations: {
      '2-EMS': {
        'CREATIVO-ARTISTICO': false,
        'CIENCIAS-VIDA': false,
        'CIENCIA-TECNOLOGIA': false,
        'CSOCIALES-HUMANIDADES': false,
      },
      '3-EMS': {
        'CIENCIAS-VIDA': true,
        'CIENCIA-ARTE-DISENO': true,
        'CIENCIA-TECNOLOGIA': true,
        'HH-CIENCIAS-ECONOMICAS': true,
        'HH-CIENCIA-POLITICA': true,
        'CREATIVO-ARTISTICO': false,
        GENERAL: false,
      },
    },
  },
}

/** Ciclos lectivos a crear junto al catálogo (el activo operativo por defecto es 2026). */
export const BOOTSTRAP_SCHOOL_YEARS = [
  { code: 2025, label: 'Ciclo lectivo 2025', status: 'CLOSED' as const },
  { code: 2026, label: 'Ciclo lectivo 2026', status: 'ACTIVE' as const },
  { code: 2027, label: 'Ciclo lectivo 2027', status: 'PLANNED' as const },
]

export function subjectCodeFromName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Todas las asignaturas únicas del catálogo (nombre → código estable). */
export function collectAllSubjectNames(): Map<string, string> {
  const map = new Map<string, string>()
  const add = (name: string) => {
    if (!map.has(name)) map.set(name, subjectCodeFromName(name))
  }
  for (const plan of Object.values(COURSE_PLANS)) {
    plan.obligatorias?.forEach(add)
    plan.troncoComun?.forEach(add)
    plan.optativas?.forEach(add)
    if (plan.orientaciones) {
      for (const list of Object.values(plan.orientaciones)) list.forEach(add)
    }
  }
  return map
}
