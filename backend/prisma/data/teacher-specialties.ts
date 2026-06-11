export type TeacherSpecialtyArea =
  | 'matematica'
  | 'ciencias'
  | 'humanidades'
  | 'lenguas'
  | 'arte'
  | 'gestion'
  | 'informatica'
  | 'educacion_fisica'

export type TeacherSpecialty = {
  areas: readonly TeacherSpecialtyArea[]
  subjects?: readonly string[]
}

export const TEACHER_SPECIALTIES: Record<string, TeacherSpecialty> = {
  'ana.kelland': { areas: ['matematica'] },
  'cecilia.pereira': { areas: ['humanidades'] },
  'eduardo.rodriguez': { areas: ['gestion', 'humanidades'] },
  'gabriela.lopez': { areas: ['ciencias'] },
  'santiago.garrido': { areas: ['ciencias', 'educacion_fisica'] },
  'jorge.fernandez': { areas: ['humanidades'] },
  'leandro.silva': { areas: ['informatica', 'gestion'] },
  'leidy.gomez': { areas: ['lenguas'] },
  'lucas.martinez': { areas: ['matematica'] },
  'lucas.ramirez': { areas: ['informatica', 'matematica'] },
  'lucia.cabrera': { areas: ['lenguas'] },
  'luis.torres': { areas: ['humanidades', 'gestion'] },
  'marcelo.garcia': { areas: ['humanidades', 'gestion'] },
  'marcos.pereira': { areas: ['gestion', 'informatica'] },
  'maximiliano.rodriguez': { areas: ['matematica'] },
  'natalia.acosta': { areas: ['ciencias'] },
  'natalia.zerpa': { areas: ['educacion_fisica'] },
  'natalia.zuga': { areas: ['ciencias'] },
  'noelia.castro': { areas: ['arte'] },
  'rita.fernandez': { areas: ['humanidades'] },
  'rita.zabala': { areas: ['arte'] },
  'rodrigo.varela': { areas: ['educacion_fisica'] },
  'romina.sosa': { areas: ['lenguas'] },
  'matias.scarenzio': { areas: ['matematica'] },
  'sharon.mendez': { areas: ['arte'] },
  'silvina.duarte': { areas: ['arte'] },
  'valentina.morales': { areas: ['ciencias'] },
  'veronica.nunez': { areas: ['humanidades'] },
  'luciana.rios': { areas: ['lenguas'] },
}
