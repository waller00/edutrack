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
  { code: '7-EBI', name: '7 EBI', level: 'EBI', sortOrder: 1 },
  { code: '8-EBI', name: '8 EBI', level: 'EBI', sortOrder: 2 },
  { code: '9-EBI', name: '9 EBI', level: 'EBI', sortOrder: 3 },
  { code: '1-EMS', name: '1 EMS', level: 'EMS', sortOrder: 4 },
  { code: '2-EMS', name: '2 EMS', level: 'EMS', sortOrder: 5 },
  { code: '3-EMS', name: '3 EMS', level: 'EMS', sortOrder: 6 },
] as const

// Orientaciones de Educación Secundaria (DGES) según el Plan EMS 2023:
// 2do año -> 3 trayectos de profundización; 3er año -> 5 especializaciones.
export const CATALOG_ORIENTATIONS: readonly CatalogOrientation[] = [
  { code: 'CIENCIAS-VIDA', name: 'Ciencias de la Vida', sortOrder: 10 },
  { code: 'CIENCIA-TECNOLOGIA', name: 'Ciencias y Tecnología', sortOrder: 20 },
  { code: 'CSOCIALES-HUMANIDADES', name: 'Ciencias Sociales y Humanidades', sortOrder: 30 },
  { code: 'CREATIVO-ARTISTICO', name: 'Creativo Artístico', sortOrder: 40 },
  { code: 'GENERAL', name: 'General', sortOrder: 50 },
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
  'DESEM',
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
      'Formación para la Ciudadanía',
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
      'Formación para la Ciudadanía',
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
      'Formación para la Ciudadanía',
    ],
    // 2do EMS: general con 3 trayectos de profundización elegibles.
    orientaciones: {
      'CIENCIA-TECNOLOGIA': ['Matemática CTM', 'Química', 'Física', 'Biología'],
      'CSOCIALES-HUMANIDADES': ['Historia', 'Sociología', 'Geografía', 'Biología'],
      'CREATIVO-ARTISTICO': ['Historia del Arte', 'Danza', 'Música', 'Teatro', 'Biología'],
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
    // 3er EMS: 5 especializaciones (Ciencias de la Vida, Ciencias y Tecnología,
    // Ciencias Sociales y Humanidades, Creativo Artístico, General).
    orientaciones: {
      'CIENCIAS-VIDA': [
        'Química',
        'Matemática CV',
        'Física',
        'Biología Vegetal',
        'Biología Humana',
      ],
      'CIENCIA-TECNOLOGIA': [
        'Matemática CTQ',
        'Química',
        'Física',
        'Matemática CT',
        'Comunicación Visual y Diseño',
      ],
      'CSOCIALES-HUMANIDADES': [
        'Historia',
        'Sociología',
        'Geografía',
        'Economía y Educación Financiera',
        'Derecho y Ciencia Política',
        'Administración y Contabilidad',
        'Historia Económica',
      ],
      'CREATIVO-ARTISTICO': [
        'Historia del Arte',
        'Música',
        'Danza',
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
  2025: {
    courses: {
      '7-EBI': true,
      '8-EBI': true,
      '9-EBI': true,
      '1-EMS': true,
      '2-EMS': true,
      '3-EMS': true,
    },
    orientations: {
      '2-EMS': {
        'CIENCIA-TECNOLOGIA': true,
        'CSOCIALES-HUMANIDADES': true,
        'CREATIVO-ARTISTICO': true,
      },
      '3-EMS': {
        'CIENCIAS-VIDA': true,
        'CIENCIA-TECNOLOGIA': true,
        'CSOCIALES-HUMANIDADES': true,
        'CREATIVO-ARTISTICO': true,
        GENERAL: true,
      },
    },
  },
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
        'CIENCIA-TECNOLOGIA': false,
        'CSOCIALES-HUMANIDADES': false,
        'CREATIVO-ARTISTICO': false,
      },
      '3-EMS': {
        'CIENCIAS-VIDA': true,
        'CIENCIA-TECNOLOGIA': true,
        'CSOCIALES-HUMANIDADES': true,
        'CREATIVO-ARTISTICO': false,
        GENERAL: false,
      },
    },
  },
}

/** Ciclos lectivos a crear junto al catálogo (el activo operativo por defecto es 2026). */
export const BOOTSTRAP_SCHOOL_YEARS = [
  { code: 2024, label: 'Ciclo lectivo 2024', status: 'CLOSED' as const },
  { code: 2025, label: 'Ciclo lectivo 2025', status: 'CLOSED' as const },
  { code: 2026, label: 'Ciclo lectivo 2026', status: 'ACTIVE' as const },
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
