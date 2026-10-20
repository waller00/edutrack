/**
 * Datos del dataset "liceo de ciclo básico" (`prisma/seed-liceo-basico.ts`): nombres, calendario,
 * plan de estudios, plantel y textos. Sólo datos, sin Prisma.
 *
 * Los nombres son inventados: se combinan al azar (con semilla fija) nombres y apellidos frecuentes
 * en Uruguay, así que cualquier parecido con una persona real es casual.
 */

// ─── Nombres ────────────────────────────────────────────────────────────────

/** Nombres de estudiantes nacidos entre 2010 y 2014. */
export const STUDENT_NAMES_F = [
  'Valentina', 'Sofía', 'Martina', 'Catalina', 'Isabella', 'Emma', 'Lucía', 'Victoria', 'Agustina',
  'Camila', 'Florencia', 'Julieta', 'Antonella', 'Mía', 'Zoe', 'Delfina', 'Josefina', 'Paula',
  'Micaela', 'Milagros', 'Guadalupe', 'Renata', 'Abril', 'Candela', 'Bianca', 'Lola', 'Mora', 'Juana',
  'Clara', 'Ana Paula', 'María Belén', 'Maite', 'Pilar', 'Rocío', 'Sol', 'Luana', 'Ailén', 'Brisa',
  'Fiorella', 'Ximena', 'Agostina', 'Morena', 'Constanza', 'Emilia', 'Olivia', 'Helena', 'Alma',
  'Malena', 'Jazmín', 'Tamara', 'Naiara', 'Kiara', 'Lara', 'Iara', 'Antonia', 'Manuela', 'Carolina',
  'Valeria', 'Celeste', 'Aitana', 'Mariana', 'Ana Clara', 'Luz', 'Sabrina', 'Romina', 'Lourdes',
] as const

export const STUDENT_NAMES_M = [
  'Santiago', 'Mateo', 'Benjamín', 'Joaquín', 'Thiago', 'Bautista', 'Facundo', 'Martín', 'Juan Manuel',
  'Agustín', 'Nicolás', 'Lucas', 'Felipe', 'Lorenzo', 'Tomás', 'Valentín', 'Bruno', 'Franco', 'Ignacio',
  'Gonzalo', 'Federico', 'Rodrigo', 'Maximiliano', 'Matías', 'Sebastián', 'Diego', 'Emiliano', 'Santino',
  'Gael', 'Ian', 'Dylan', 'Ezequiel', 'Alejo', 'Marcos', 'Juan Pablo', 'Lautaro', 'Leandro', 'Nahuel',
  'Valentino', 'Francisco', 'Pedro', 'Simón', 'Bastián', 'Luciano', 'Gastón', 'Mauricio', 'Iván',
  'Damián', 'Axel', 'Enzo', 'Alan', 'Rafael', 'Camilo', 'Kevin', 'Brian', 'Juan Ignacio', 'Germán',
  'Renzo', 'Facundo', 'Tobías', 'Elías', 'Julián', 'Andrés', 'Manuel', 'Agustín', 'Juan Cruz',
] as const

/** Nombres del personal, nacidos entre 1965 y 1995. */
export const ADULT_NAMES_F = [
  'Mariana', 'Carolina', 'Andrea', 'Laura', 'Verónica', 'Gabriela', 'Natalia', 'Silvana', 'Patricia',
  'Claudia', 'Alejandra', 'Fernanda', 'Valeria', 'Lorena', 'Soledad', 'Cecilia', 'Paola', 'Daniela',
  'Florencia', 'Sandra', 'Mónica', 'Adriana', 'Rosana', 'Virginia', 'Inés', 'Graciela', 'Beatriz',
  'Analía', 'Magdalena', 'Rosario', 'Jimena', 'Karina', 'Mariela', 'Elena', 'Leticia', 'Sylvia',
] as const

export const ADULT_NAMES_M = [
  'Gustavo', 'Pablo', 'Diego', 'Martín', 'Fernando', 'Gonzalo', 'Sebastián', 'Alejandro', 'Javier',
  'Marcelo', 'Andrés', 'Rodrigo', 'Daniel', 'Fabián', 'Álvaro', 'Leonardo', 'Hernán', 'Ricardo',
  'Sergio', 'Jorge', 'Gerardo', 'Claudio', 'Eduardo', 'Federico', 'Nicolás', 'Mauricio', 'Juan Carlos',
  'Luis', 'Raúl', 'Carlos', 'Gabriel', 'Ignacio',
] as const

/**
 * Apellidos. Los primeros son los más frecuentes del país y salen más seguido (el peso se aplica en
 * el seed); el resto da variedad: vascos, italianos, portugueses y criollos, como en cualquier lista
 * de un liceo de Montevideo.
 */
export const SURNAMES_COMMON = [
  'González', 'Rodríguez', 'Fernández', 'Pérez', 'Martínez', 'García', 'López', 'Silva', 'Sosa',
  'Gómez', 'Díaz', 'Pereira', 'Suárez', 'Hernández', 'Álvarez', 'Ramírez', 'Cabrera', 'Núñez',
  'Méndez', 'Acosta', 'Romero', 'Castro', 'Olivera', 'Benítez', 'Torres', 'Correa', 'Ferreira',
  'Morales', 'Vázquez', 'Sánchez',
] as const

export const SURNAMES_OTHER = [
  'De León', 'Da Silva', 'Techera', 'Píriz', 'Cardozo', 'Machado', 'Moreira', 'Bentancor', 'Larrosa',
  'Pintos', 'Barrios', 'Duarte', 'Medina', 'Aguirre', 'Rosas', 'Ríos', 'Muniz', 'Varela', 'Silveira',
  'Lima', 'Rocha', 'Mendoza', 'Figueredo', 'Ortiz', 'Cuello', 'Martirena', 'Berrutti', 'Arocena',
  'Etchegaray', 'Iturralde', 'Echeverría', 'Zabaleta', 'Larrañaga', 'Irigoyen', 'Rossi', 'Ferrari',
  'Gallo', 'Russo', 'Costa', 'Fontana', 'Lombardo', 'Bruno', 'Ricci', 'Moreno', 'Cassina', 'Fleitas',
  'Montero', 'Bermúdez', 'Bonino', 'Ottonello', 'Sarasola', 'Abella', 'Ameglio', 'Antúnez',
  'Arismendi', 'Barreiro', 'Borges', 'Brum', 'Caballero', 'Cáceres', 'Canessa', 'Castillo', 'Cedrés',
  'Clavijo', 'Curbelo', 'Dalmao', 'Delgado', 'Domínguez', 'Dutra', 'Estévez', 'Fagúndez', 'Farías',
  'Ferrando', 'Franco', 'Gadea', 'Garrido', 'Giménez', 'Godoy', 'Gutiérrez', 'Ibarra', 'Iglesias',
  'Laborde', 'Lacuesta', 'Lemes', 'Leites', 'Lorenzo', 'Luzardo', 'Mangini', 'Marichal', 'Márquez',
  'Medeiros', 'Melo', 'Merlo', 'Miranda', 'Molina', 'Navarro', 'Nieves', 'Olmos', 'Paiva', 'Pacheco',
  'Peña', 'Perdomo', 'Pignataro', 'Porley', 'Quintana', 'Reyes', 'Rivero', 'Rivas', 'Saldanha',
  'Salgado', 'Santana', 'Santos', 'Sierra', 'Sena', 'Sequeira', 'Soca', 'Sotelo', 'Tejera', 'Toledo',
  'Umpiérrez', 'Urrutia', 'Vera', 'Vidal', 'Villar', 'Zeballos', 'Zunino', 'Bonilla', 'Chiappara',
  'Colman', 'Espinosa', 'Gadola', 'Landa', 'Mora', 'Nogueira', 'Porto', 'Quiroga', 'Tabárez', 'Viera',
] as const

/** Calles de Montevideo para los domicilios. */
export const STREETS = [
  'Av. 8 de Octubre', 'Av. Italia', 'Bv. Artigas', 'Av. General Flores', 'Camino Maldonado',
  'Av. Millán', 'Av. Agraciada', 'Av. Garzón', 'Juan Jacobo Rousseau', 'Larrañaga', 'Propios',
  'José Pedro Varela', 'Comercio', 'Asilo', 'Pan de Azúcar', 'Bolivia', 'Hipólito Yrigoyen',
  'Veracierto', 'Felipe Cardoso', 'Pernas', 'Rivera', 'Canelones', 'Charrúa', 'Gral. Urquiza',
  'Amazonas', 'Mataojo', 'Industria', 'Pedernal', 'Cno. Carrasco', 'Libia', 'Dr. Juan Carlos Blanco',
] as const

export const PRIMARY_SCHOOLS = [
  'Escuela N.º 47', 'Escuela N.º 116', 'Escuela N.º 183', 'Escuela N.º 74', 'Escuela N.º 12',
  'Escuela N.º 229', 'Escuela N.º 157', 'Escuela N.º 96', 'Colegio San Juan Bautista',
  'Colegio Nuestra Señora del Rosario', 'Escuela Integral Hebrea', 'Escuela N.º 351',
] as const

export const OTHER_LICEOS = ['Liceo N.º 22', 'Liceo N.º 41', 'Liceo N.º 58', 'Colegio Santa Rita', 'Liceo de Pando'] as const

// ─── Calendario ─────────────────────────────────────────────────────────────

export type YearCalendar = {
  /** Primer y último día de clases. */
  start: string
  end: string
  status: 'ACTIVE' | 'CLOSED'
}

export const YEAR_CALENDARS: Record<2025 | 2026, YearCalendar> = {
  // Carnaval 2025 cayó 3 y 4 de marzo: las clases empezaron el miércoles 5.
  2025: { start: '2025-03-05', end: '2025-12-05', status: 'CLOSED' },
  2026: { start: '2026-03-02', end: '2026-12-04', status: 'ACTIVE' },
}

export type NonWorkingSeed = { from: string; to?: string; type: 'HOLIDAY' | 'NON_WORKING_DAY'; reason: string; notes?: string }

/** Feriados, recesos, paros y jornadas sin clase. Los rangos se expanden a días hábiles. */
export const NON_WORKING: Record<2025 | 2026, readonly NonWorkingSeed[]> = {
  2025: [
    { from: '2025-03-03', to: '2025-03-04', type: 'HOLIDAY', reason: 'Carnaval' },
    { from: '2025-04-14', to: '2025-04-18', type: 'NON_WORKING_DAY', reason: 'Semana de Turismo', notes: 'Receso de clases' },
    { from: '2025-05-01', type: 'HOLIDAY', reason: 'Día de los Trabajadores' },
    { from: '2025-05-30', type: 'NON_WORKING_DAY', reason: 'Jornada de coordinación institucional', notes: 'Sin clases para estudiantes' },
    { from: '2025-06-05', type: 'NON_WORKING_DAY', reason: 'Paro nacional de 24 horas (FENAPES)', notes: 'Adhesión total del cuerpo docente' },
    { from: '2025-06-19', type: 'HOLIDAY', reason: 'Natalicio de José Artigas' },
    { from: '2025-06-30', to: '2025-07-11', type: 'NON_WORKING_DAY', reason: 'Vacaciones de invierno' },
    { from: '2025-07-18', type: 'HOLIDAY', reason: 'Jura de la Constitución' },
    { from: '2025-08-25', type: 'HOLIDAY', reason: 'Declaratoria de la Independencia' },
    { from: '2025-09-22', to: '2025-09-26', type: 'NON_WORKING_DAY', reason: 'Vacaciones de primavera' },
    { from: '2025-10-01', type: 'NON_WORKING_DAY', reason: 'Paro general parcial (PIT-CNT)', notes: 'Se suspendieron las clases del turno' },
  ],
  2026: [
    { from: '2026-02-16', to: '2026-02-17', type: 'HOLIDAY', reason: 'Carnaval' },
    { from: '2026-03-30', to: '2026-04-03', type: 'NON_WORKING_DAY', reason: 'Semana de Turismo', notes: 'Receso de clases' },
    { from: '2026-04-22', type: 'NON_WORKING_DAY', reason: 'Paro nacional de 24 horas (FENAPES)', notes: 'Adhesión total del cuerpo docente' },
    { from: '2026-05-01', type: 'HOLIDAY', reason: 'Día de los Trabajadores' },
    { from: '2026-05-18', type: 'HOLIDAY', reason: 'Batalla de Las Piedras' },
    { from: '2026-06-05', type: 'NON_WORKING_DAY', reason: 'Jornada de coordinación institucional', notes: 'Sin clases para estudiantes' },
    { from: '2026-06-19', type: 'HOLIDAY', reason: 'Natalicio de José Artigas' },
    { from: '2026-06-29', to: '2026-07-10', type: 'NON_WORKING_DAY', reason: 'Vacaciones de invierno' },
    { from: '2026-08-12', type: 'NON_WORKING_DAY', reason: 'Paro general parcial (PIT-CNT)', notes: 'Se suspendieron las clases del turno' },
    { from: '2026-08-25', type: 'HOLIDAY', reason: 'Declaratoria de la Independencia' },
    { from: '2026-09-21', to: '2026-09-25', type: 'NON_WORKING_DAY', reason: 'Vacaciones de primavera' },
    { from: '2026-10-12', type: 'HOLIDAY', reason: 'Día de la Diversidad Cultural' },
  ],
}

// ─── Plan de estudios y horario ─────────────────────────────────────────────

export const COURSE_CODES = ['7-EBI', '8-EBI', '9-EBI'] as const
export type CourseCode = (typeof COURSE_CODES)[number]

/** Horas semanales por asignatura (nombre exacto del catálogo). */
export const WEEKLY_HOURS: Record<CourseCode, ReadonlyArray<readonly [string, number]>> = {
  '7-EBI': [
    ['Idioma Español', 4], ['Matemática', 4], ['Inglés', 3], ['Biología', 2], ['Geografía', 2],
    ['Historia', 2], ['Comunicación Visual', 2], ['Educación Física y Recreación', 3],
    ['Ciencias de la Computación', 2], ['Ciencias Físico-Química', 2], ['Educación Musical', 2],
  ],
  '8-EBI': [
    ['Idioma Español', 4], ['Matemática', 4], ['Inglés', 3], ['Biología', 2], ['Geografía', 2],
    ['Historia', 2], ['Comunicación Visual', 2], ['Educación Física y Recreación', 3],
    ['Ciencias de la Computación', 2], ['Ciencias Físico-Química', 2], ['Educación Musical', 2],
    ['Formación para la Ciudadanía', 2],
  ],
  '9-EBI': [
    ['Idioma Español', 3], ['Literatura', 2], ['Matemática', 4], ['Inglés', 3], ['Biología', 2],
    ['Geografía', 2], ['Historia', 2], ['Comunicación Visual', 2], ['Educación Física y Recreación', 2],
    ['Ciencias de la Computación', 2], ['Química', 2], ['Física', 2], ['Educación Musical', 1],
    ['Formación para la Ciudadanía', 2],
  ],
}

/** Asignaturas de 2 horas que se dictan en un módulo doble (taller, laboratorio). El resto, en horas sueltas. */
export const DOUBLE_BLOCK_SUBJECTS = new Set([
  'Comunicación Visual', 'Educación Musical', 'Ciencias de la Computación', 'Ciencias Físico-Química',
  'Química', 'Física', 'Educación Física y Recreación',
])

/** Educación Física va a contraturno, en el gimnasio. */
export const AFTERNOON_SUBJECTS = new Set(['Educación Física y Recreación'])

export const ROOM_BY_SUBJECT: Record<string, string> = {
  'Comunicación Visual': 'Taller de Plástica',
  'Educación Musical': 'Sala de Música',
  'Ciencias de la Computación': 'Sala de Informática',
  'Ciencias Físico-Química': 'Laboratorio de Ciencias',
  Química: 'Laboratorio de Ciencias',
  Física: 'Laboratorio de Ciencias',
  Biología: 'Laboratorio de Ciencias',
  'Educación Física y Recreación': 'Gimnasio',
}

export const HOME_ROOM: Record<CourseCode, string> = { '7-EBI': 'Salón 3', '8-EBI': 'Salón 5', '9-EBI': 'Salón 8' }

/** Franjas del turno matutino (7 horas de 45 min) y del contraturno (2). */
export const MORNING_SLOTS = [
  [7, 30, 8, 15], [8, 15, 9, 0], [9, 10, 9, 55], [9, 55, 10, 40], [10, 50, 11, 35], [11, 35, 12, 20], [12, 25, 13, 10],
] as const
export const AFTERNOON_SLOTS = [[14, 0, 14, 45], [14, 45, 15, 30]] as const

// ─── Plantel ────────────────────────────────────────────────────────────────

export type StaffSpec = {
  key: string
  role: 'TEACHER' | 'DIRECCION' | 'ADSCRIPTO' | 'STAFF' | 'INSPECCION'
  gender: 'F' | 'M'
  /** Rótulo para las notas del perfil ("Profesora de Inglés", "Secretaria"). */
  title: string
  /** Asignaturas que puede dictar como suplente. */
  canCover?: readonly string[]
  /** Se fue al terminar 2025: queda dado de baja. */
  leftAfter2025?: boolean
  /** Entró en 2026. */
  joined2026?: boolean
  /** Turno (jornada laboral) para el personal no docente. */
  shift?: readonly [number, number, number, number]
}

export const STAFF: readonly StaffSpec[] = [
  { key: 'DIR', role: 'DIRECCION', gender: 'F', title: 'Directora', shift: [7, 15, 13, 30] },
  { key: 'SUBDIR', role: 'DIRECCION', gender: 'M', title: 'Subdirector', shift: [9, 0, 15, 0] },
  { key: 'ADS1', role: 'ADSCRIPTO', gender: 'F', title: 'Adscripta de 7.º y 8.º', shift: [7, 10, 13, 15] },
  { key: 'ADS2', role: 'ADSCRIPTO', gender: 'M', title: 'Adscripto de 9.º', shift: [7, 10, 13, 15] },
  { key: 'SEC', role: 'STAFF', gender: 'F', title: 'Secretaria', shift: [8, 0, 14, 0] },
  { key: 'ADM', role: 'STAFF', gender: 'M', title: 'Administrativo (tesorería y cuotas)', shift: [9, 0, 15, 0] },
  { key: 'INSP', role: 'INSPECCION', gender: 'F', title: 'Inspectora de Educación Media Básica' },
  { key: 'ESP1', role: 'TEACHER', gender: 'F', title: 'Profesora de Idioma Español', canCover: ['Idioma Español', 'Literatura'] },
  { key: 'ESP2', role: 'TEACHER', gender: 'M', title: 'Profesor de Idioma Español y Literatura', canCover: ['Idioma Español', 'Literatura'] },
  { key: 'ING', role: 'TEACHER', gender: 'F', title: 'Profesora de Inglés', canCover: ['Inglés'] },
  { key: 'MAT1', role: 'TEACHER', gender: 'M', title: 'Profesor de Matemática', canCover: ['Matemática'] },
  { key: 'MAT2', role: 'TEACHER', gender: 'F', title: 'Profesora de Matemática', canCover: ['Matemática'] },
  { key: 'MAT3', role: 'TEACHER', gender: 'M', title: 'Profesor de Matemática', canCover: ['Matemática'], joined2026: true },
  { key: 'BIO', role: 'TEACHER', gender: 'F', title: 'Profesora de Biología', canCover: ['Biología', 'Ciencias Físico-Química'] },
  { key: 'GEO', role: 'TEACHER', gender: 'M', title: 'Profesor de Geografía', canCover: ['Geografía', 'Historia'], leftAfter2025: true },
  { key: 'GEO2', role: 'TEACHER', gender: 'F', title: 'Profesora de Geografía', canCover: ['Geografía', 'Historia'], joined2026: true },
  { key: 'HIS', role: 'TEACHER', gender: 'M', title: 'Profesor de Historia', canCover: ['Historia', 'Formación para la Ciudadanía'] },
  { key: 'CIU', role: 'TEACHER', gender: 'F', title: 'Profesora de Formación para la Ciudadanía', canCover: ['Formación para la Ciudadanía', 'Historia'] },
  { key: 'CV', role: 'TEACHER', gender: 'F', title: 'Profesora de Comunicación Visual', canCover: ['Comunicación Visual'] },
  { key: 'EF', role: 'TEACHER', gender: 'M', title: 'Profesor de Educación Física', canCover: ['Educación Física y Recreación'] },
  { key: 'COMP', role: 'TEACHER', gender: 'M', title: 'Profesor de Ciencias de la Computación', canCover: ['Ciencias de la Computación', 'Matemática'] },
  { key: 'QUI', role: 'TEACHER', gender: 'F', title: 'Profesora de Química y Físico-Química', canCover: ['Química', 'Ciencias Físico-Química', 'Física'] },
  { key: 'FIS', role: 'TEACHER', gender: 'M', title: 'Profesor de Física', canCover: ['Física', 'Ciencias Físico-Química', 'Matemática'] },
  { key: 'MUS', role: 'TEACHER', gender: 'F', title: 'Profesora de Educación Musical', canCover: ['Educación Musical'] },
  // Suplentes: docentes inscriptos en la lista de suplencias del liceo, sin grupos propios.
  { key: 'SUP_ING', role: 'TEACHER', gender: 'F', title: 'Docente suplente (Inglés)', canCover: ['Inglés'] },
  { key: 'SUP_MAT', role: 'TEACHER', gender: 'M', title: 'Docente suplente (Matemática y Física)', canCover: ['Matemática', 'Física'] },
  { key: 'SUP_HUM', role: 'TEACHER', gender: 'F', title: 'Docente suplente (Español, Historia, Geografía)', canCover: ['Historia', 'Geografía', 'Formación para la Ciudadanía', 'Idioma Español', 'Literatura'] },
  { key: 'SUP_CIE', role: 'TEACHER', gender: 'M', title: 'Docente suplente (Ciencias)', canCover: ['Biología', 'Química', 'Ciencias Físico-Química', 'Física', 'Ciencias de la Computación'] },
]

/** Titular de cada asignatura por curso y año. */
export function titularFor(year: 2025 | 2026, course: CourseCode, subject: string): string {
  switch (subject) {
    case 'Idioma Español':
      return course === '9-EBI' ? 'ESP2' : 'ESP1'
    case 'Literatura':
      return 'ESP2'
    case 'Inglés':
      return 'ING'
    case 'Matemática':
      if (course !== '9-EBI') return 'MAT1'
      return year === 2025 ? 'MAT2' : 'MAT3'
    case 'Biología':
      return 'BIO'
    case 'Geografía':
      return year === 2025 ? 'GEO' : 'GEO2'
    case 'Historia':
      return 'HIS'
    case 'Formación para la Ciudadanía':
      return 'CIU'
    case 'Comunicación Visual':
      return 'CV'
    case 'Educación Física y Recreación':
      return 'EF'
    case 'Ciencias de la Computación':
      return 'COMP'
    case 'Ciencias Físico-Química':
    case 'Química':
      return 'QUI'
    case 'Física':
      return 'FIS'
    case 'Educación Musical':
      return 'MUS'
    default:
      throw new Error(`[liceo] Asignatura sin titular: ${subject}`)
  }
}

export type LeaveSeed = {
  staff: string
  from: string
  to: string
  type: 'MEDICAL_LEAVE' | 'WORK_LEAVE' | 'OTHER'
  reason: string
  /** Suplente que cubre todas las clases del período; sin él, las clases quedan sin cubrir. */
  coveredBy?: string
}

/** Licencias previstas. Las inasistencias sueltas se agregan al azar en el seed. */
export const LEAVES: Record<2025 | 2026, readonly LeaveSeed[]> = {
  2025: [
    { staff: 'ADS1', from: '2025-04-28', to: '2025-04-30', type: 'MEDICAL_LEAVE', reason: 'Licencia médica' },
    { staff: 'MAT1', from: '2025-05-12', to: '2025-05-16', type: 'MEDICAL_LEAVE', reason: 'Licencia médica', coveredBy: 'SUP_MAT' },
    { staff: 'EF', from: '2025-06-16', to: '2025-06-18', type: 'WORK_LEAVE', reason: 'Licencia por estudio (curso de actualización)' },
    { staff: 'SEC', from: '2025-07-21', to: '2025-07-25', type: 'MEDICAL_LEAVE', reason: 'Licencia médica' },
    { staff: 'BIO', from: '2025-08-04', to: '2025-08-06', type: 'OTHER', reason: 'Licencia por enfermedad de familiar' },
    { staff: 'HIS', from: '2025-09-01', to: '2025-10-10', type: 'MEDICAL_LEAVE', reason: 'Licencia médica prolongada', coveredBy: 'SUP_HUM' },
    { staff: 'CV', from: '2025-10-20', to: '2025-10-24', type: 'MEDICAL_LEAVE', reason: 'Licencia médica' },
  ],
  2026: [
    { staff: 'QUI', from: '2026-04-13', to: '2026-04-17', type: 'MEDICAL_LEAVE', reason: 'Licencia médica', coveredBy: 'SUP_CIE' },
    { staff: 'ING', from: '2026-05-04', to: '2026-08-14', type: 'OTHER', reason: 'Licencia maternal', coveredBy: 'SUP_ING' },
    { staff: 'GEO2', from: '2026-06-08', to: '2026-06-10', type: 'OTHER', reason: 'Licencia por enfermedad de familiar' },
    { staff: 'ADM', from: '2026-09-07', to: '2026-09-11', type: 'MEDICAL_LEAVE', reason: 'Licencia médica' },
    { staff: 'MAT1', from: '2026-10-12', to: '2026-10-30', type: 'MEDICAL_LEAVE', reason: 'Licencia médica', coveredBy: 'SUP_MAT' },
  ],
}

// ─── Evaluaciones ───────────────────────────────────────────────────────────

/** Qué se evalúa en cada tramo: [código de tipo de actividad, alcance en el tramo 0..1]. */
export const TRAMO_PLAN: Record<string, ReadonlyArray<readonly [string, number]>> = {
  MARZO_ABRIL: [['TRABAJO_EN_CLASE', 0.45], ['ESCRITO', 0.85]],
  MAYO_JUNIO: [['ESCRITO', 0.4], ['TRABAJO_DOMICILIARIO', 0.8]],
  JULIO: [['PRUEBA', 0.75]],
  AGOSTO_SETIEMBRE: [['ESCRITO', 0.35], ['PROYECTO', 0.8]],
  OCTUBRE_NOVIEMBRE: [['ESCRITO', 0.3], ['PRUEBA', 0.75]],
}

/** Títulos de evaluaciones por asignatura. Se toman en orden a lo largo del año. */
export const ASSESSMENT_TOPICS: Record<string, readonly string[]> = {
  'Idioma Español': ['Comprensión lectora: el cuento', 'Clases de palabras', 'Producción de un texto narrativo', 'El texto descriptivo', 'Ortografía y acentuación', 'El texto argumentativo', 'Lectura de novela', 'Coherencia y cohesión', 'Oraciones y conectores', 'La noticia y la crónica'],
  Literatura: ['El género lírico', 'Análisis de poemas de Idea Vilariño', 'El cuento de Horacio Quiroga', 'El teatro: "Barranca abajo"', 'La novela de formación', 'Mario Benedetti: cuentos', 'El ensayo', 'Análisis comparado'],
  Inglés: ['Present simple & routines', 'Describing people', 'Past simple: my holidays', 'Reading comprehension', 'Future plans', 'Comparatives and superlatives', 'Writing an email', 'Listening & speaking', 'Present perfect', 'Project: my neighbourhood'],
  Matemática: ['Números naturales y divisibilidad', 'Fracciones y decimales', 'Proporcionalidad', 'Ecuaciones de primer grado', 'Geometría: ángulos y triángulos', 'Funciones lineales', 'Estadística: tablas y gráficos', 'Números enteros', 'Áreas y perímetros', 'Sistemas de ecuaciones'],
  Biología: ['La célula', 'Seres vivos y ambiente', 'Nutrición humana', 'Ecosistemas del Uruguay', 'Sistema circulatorio', 'Reproducción y desarrollo', 'Biodiversidad', 'Salud y prevención'],
  Geografía: ['Representación del espacio: mapas', 'Coordenadas geográficas', 'Relieve y paisajes del Uruguay', 'Clima y tiempo', 'Población y migraciones', 'Recursos naturales', 'Ciudades y territorio', 'América Latina'],
  Historia: ['La Prehistoria', 'Antiguas civilizaciones', 'Grecia y Roma', 'La Banda Oriental', 'El artiguismo', 'Edad Media', 'Revolución industrial', 'Uruguay en el siglo XX'],
  'Formación para la Ciudadanía': ['Derechos humanos', 'Convivencia y normas', 'Participación ciudadana', 'Constitución de la República', 'Diversidad y discriminación', 'Medios de comunicación', 'Ciudadanía digital'],
  'Comunicación Visual': ['Lámina: el punto y la línea', 'Teoría del color', 'Composición', 'Proyecto: afiche', 'Perspectiva', 'Collage', 'Diseño de logotipo', 'Muestra de fin de año'],
  'Educación Física y Recreación': ['Evaluación de resistencia', 'Circuito de habilidades', 'Handball: fundamentos', 'Vóleibol: saque y recepción', 'Atletismo', 'Juegos cooperativos', 'Básquetbol', 'Expresión corporal'],
  'Ciencias de la Computación': ['Pensamiento computacional', 'Proyecto en Scratch', 'Algoritmos y diagramas', 'Planillas de cálculo', 'Proyecto con micro:bit', 'Introducción a Python', 'Ciudadanía digital y seguridad', 'Proyecto final'],
  'Ciencias Físico-Química': ['La materia y sus estados', 'Mezclas y separación', 'Informe de laboratorio: densidad', 'Energía y transformaciones', 'Fuerzas y movimiento', 'Calor y temperatura', 'El agua', 'Electricidad'],
  Química: ['Estructura atómica', 'Tabla periódica', 'Enlace químico', 'Informe de laboratorio: reacciones', 'Ecuaciones químicas', 'Soluciones', 'Química en la vida cotidiana', 'Ácidos y bases'],
  Física: ['Magnitudes y unidades', 'Cinemática: MRU', 'Informe de laboratorio: péndulo', 'Fuerzas y leyes de Newton', 'Energía mecánica', 'Ondas y sonido', 'Óptica', 'Electricidad y circuitos'],
  'Educación Musical': ['Lectura rítmica', 'Ejecución grupal: flauta', 'Música uruguaya: candombe', 'Audición: instrumentos', 'Canto coral', 'Murga: proyecto', 'Creación de un ritmo', 'Muestra musical'],
}

/** Temas del libro del profesor (desarrollo del curso), por asignatura. */
export const DEVELOPMENT_ACTIVITIES = [
  'Explicación en pizarrón y ejercicios en el cuaderno.',
  'Trabajo en equipos y puesta en común.',
  'Lectura guiada y preguntas de comprensión.',
  'Corrección colectiva del trabajo anterior.',
  'Actividad en la plataforma CREA.',
  'Repaso para la evaluación.',
  'Devolución de la evaluación y autocorrección.',
  'Trabajo individual con fichas.',
  'Presentaciones orales de los equipos.',
  'Actividad práctica y registro en el cuaderno.',
] as const

// ─── Textos de libreta ──────────────────────────────────────────────────────

export const DIAGNOSTICO_TEXTS = {
  alto: [
    'Llega con buena base. Lee y comprende consignas sin dificultad; participa con interés.',
    'Muestra autonomía y buenos hábitos de estudio. Se integra bien al grupo.',
    'Resuelve las actividades diagnósticas con solvencia. Buen punto de partida.',
  ],
  medio: [
    'Alcanza lo esperado en la mayoría de las actividades. Necesita afianzar la escritura.',
    'Comprende las consignas, aunque le cuesta sostener la atención en tareas largas.',
    'Base adecuada; conviene acompañar la organización del cuaderno y los materiales.',
  ],
  bajo: [
    'Presenta dificultades en lectura comprensiva. Se sugiere seguimiento cercano.',
    'Le cuesta comenzar las tareas sin apoyo. Se coordina con adscripción para acompañarlo.',
    'Base frágil en los contenidos previos; se propone trabajo diferenciado en el primer tramo.',
  ],
} as const

export const INFORME_RENDIMIENTO = {
  alto: [
    'Excelente desempeño en el período.',
    'Muy buen rendimiento: comprende los contenidos y los aplica con autonomía.',
    'Trabaja con dedicación y obtiene muy buenos resultados.',
    'Se destaca por la calidad de sus trabajos.',
  ],
  medio: [
    'Rendimiento adecuado en el período.',
    'Alcanza los logros esperados, aunque puede rendir más.',
    'Cumple con las tareas; los resultados en las evaluaciones escritas son dispares.',
    'Buen trabajo en clase; debe sostener el estudio en casa.',
  ],
  bajo: [
    'No alcanza los logros esperados para el período.',
    'Rendimiento insuficiente: no entregó varias tareas.',
    'Presenta dificultades importantes en los contenidos trabajados.',
    'Los resultados no reflejan lo trabajado en clase; necesita estudiar con regularidad.',
  ],
} as const

export const INFORME_ACTITUD = {
  buena: [
    'Participa activamente y respeta a sus compañeros.',
    'Muestra interés y una actitud colaborativa.',
    'Es responsable con los materiales y las entregas.',
    'Mantiene una muy buena disposición hacia el trabajo.',
  ],
  regular: [
    'Debe mejorar la atención durante la clase.',
    'Se distrae con facilidad y conversa en momentos de trabajo.',
    'Le cuesta cumplir con los plazos de entrega.',
    'Necesita mejorar la organización del cuaderno.',
  ],
  mala: [
    'Su conducta en clase dificulta el trabajo del grupo.',
    'No trae los materiales y no se involucra en las actividades.',
    'Se registraron varias llamadas de atención en el período.',
  ],
} as const

export const INFORME_SUGERENCIA = {
  alto: ['¡Felicitaciones!', 'Seguí así.', 'Puede asumir desafíos de mayor complejidad.'],
  medio: ['Se sugiere repasar los temas trabajados.', 'Debe consultar sus dudas en clase.', 'Puede mejorar con más constancia.'],
  bajo: [
    'Se sugiere asistir a las clases de apoyo.',
    'Se cita a la familia para acordar estrategias.',
    'Debe ponerse al día con los trabajos pendientes.',
  ],
} as const

export const GROUP_REPORT_OPENINGS = [
  'El grupo mantiene un buen clima de trabajo y la mayoría cumple con las tareas.',
  'Grupo participativo, aunque con dificultades para sostener la atención en las últimas horas.',
  'Se observa un avance respecto del período anterior, sobre todo en la organización.',
  'Grupo heterogéneo: un sector trabaja con autonomía y otro necesita acompañamiento constante.',
  'El clima de clase mejoró luego de los acuerdos de convivencia trabajados con adscripción.',
] as const

export const GROUP_REPORT_CLOSINGS = [
  'Se continuará trabajando la comprensión de consignas y la autonomía.',
  'Para el próximo período se propone reforzar el estudio domiciliario.',
  'Se coordinará con adscripción el seguimiento de los estudiantes con bajo rendimiento.',
  'Se sugiere convocar a las familias de los estudiantes con calificación insuficiente.',
] as const

export const MEETING_GROUP_DECISIONS = [
  'Se acuerda reforzar la comunicación con las familias a través de adscripción.',
  'Se propone un taller de técnicas de estudio para el grupo.',
  'Se coordina una salida didáctica interdisciplinaria para el próximo período.',
  'Se acuerda unificar criterios de entrega de trabajos entre las asignaturas.',
  'Se destaca la mejora en la convivencia del grupo.',
  'Se plantea trabajar la puntualidad al inicio de la jornada.',
] as const

export const MEETING_STUDENT_DECISIONS = [
  'Se cita a la familia para acordar un plan de trabajo.',
  'Se deriva al equipo multidisciplinario para su seguimiento.',
  'Se sugiere asistencia a las tutorías de Matemática.',
  'Se acuerda un seguimiento semanal desde adscripción.',
  'Se felicita por la mejora sostenida en el período.',
  'Se registra la situación de inasistencias reiteradas; adscripción se comunica con la familia.',
] as const

export const DIRECTOR_MESSAGES = [
  'Recordá cargar el informe general del grupo antes de la reunión.',
  'Revisé la libreta: quedan estudiantes sin conducta en la entrega.',
  'Muy buen trabajo con la planificación de este tramo.',
  'Te pido que revises la redacción de algunos informes de actuación antes del visado.',
  'Para la próxima reunión necesitamos el informe de los estudiantes con calificación insuficiente.',
] as const

export const TEACHER_REPLIES = [
  'Listo, ya está cargado.',
  'Gracias, lo completo hoy.',
  'Corregido. Quedo a las órdenes.',
  'Lo reviso y lo actualizo antes del viernes.',
] as const

export const JUSTIFICATION_REASONS_MEDICAL = ['Certificado médico', 'Certificado médico', 'Certificado médico', 'Constancia de consulta médica', 'Constancia odontológica'] as const
export const JUSTIFICATION_REASONS_PLANNED = ['Viaje familiar al interior', 'Competencia deportiva (selección departamental)', 'Duelo familiar', 'Viaje familiar al exterior', 'Trámite de documentación'] as const
