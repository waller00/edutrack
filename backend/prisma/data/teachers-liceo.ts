/**
 * Docentes del liceo como usuarios TEACHER (@liceo.test).
 * Contraseña inicial común: docente123 (hasheada en el seed).
 */

export const TEACHER_INITIAL_PASSWORD = 'docente123'

export type TeacherSeedRow = {
  firstName: string
  lastName: string
  username: string
  email: string
}

function row(firstName: string, lastName: string, username: string): TeacherSeedRow {
  return {
    firstName,
    lastName,
    username,
    email: `${username}@liceo.test`,
  }
}

/** 29 docentes — nombre y apellido completos. */
export const TEACHERS_LICEO: readonly TeacherSeedRow[] = [
  row('Ana', 'Kelland', 'ana.kelland'),
  row('Cecilia', 'Pereira', 'cecilia.pereira'),
  row('Eduardo', 'Rodríguez', 'eduardo.rodriguez'),
  row('Gabriela', 'López', 'gabriela.lopez'),
  row('Santiago', 'Garrido', 'santiago.garrido'),
  row('Jorge', 'Fernández', 'jorge.fernandez'),
  row('Leandro', 'Silva', 'leandro.silva'),
  row('Leidy', 'Gómez', 'leidy.gomez'),
  row('Lucas', 'Martínez', 'lucas.martinez'),
  row('Lucas', 'Ramírez', 'lucas.ramirez'),
  row('Lucía', 'Cabrera', 'lucia.cabrera'),
  row('Luis', 'Torres', 'luis.torres'),
  row('Marcelo', 'García', 'marcelo.garcia'),
  row('Marcos', 'Pereira', 'marcos.pereira'),
  row('Maximiliano', 'Rodríguez', 'maximiliano.rodriguez'),
  row('Natalia', 'Acosta', 'natalia.acosta'),
  row('Natalia', 'Zerpa', 'natalia.zerpa'),
  row('Natalia', 'Zuga', 'natalia.zuga'),
  row('Noelia', 'Castro', 'noelia.castro'),
  row('Rita', 'Fernández', 'rita.fernandez'),
  row('Rita', 'Zabala', 'rita.zabala'),
  row('Rodrigo', 'Varela', 'rodrigo.varela'),
  row('Romina', 'Sosa', 'romina.sosa'),
  row('Matías', 'Scarenzio', 'matias.scarenzio'),
  row('Sharon', 'Méndez', 'sharon.mendez'),
  row('Silvina', 'Duarte', 'silvina.duarte'),
  row('Valentina', 'Morales', 'valentina.morales'),
  row('Verónica', 'Núñez', 'veronica.nunez'),
  row('Luciana', 'Ríos', 'luciana.rios'),
] as const

export function teacherDisplayName(t: TeacherSeedRow): string {
  return `${t.firstName} ${t.lastName}`
}
