import { describe, it, expect } from 'vitest'
import { validateReadOnlySql } from './llm-sql.js'

describe('validateReadOnlySql', () => {
  it('acepta un SELECT simple sobre tabla permitida y quita el ; final', () => {
    const out = validateReadOnlySql('SELECT "User"."email" FROM "User";')
    expect(out).toBe('SELECT "User"."email" FROM "User"')
  })

  it('acepta JOIN entre tablas permitidas', () => {
    expect(() =>
      validateReadOnlySql(
        'SELECT "User"."email" FROM "Attendance" JOIN "User" ON "User"."id" = "Attendance"."userId"',
      ),
    ).not.toThrow()
  })

  it('rechaza sentencias que no son SELECT', () => {
    expect(() => validateReadOnlySql('UPDATE "User" SET "isActive" = false')).toThrow(
      'QUERY_ASSISTANT_SQL_NOT_SELECT',
    )
  })

  it('rechaza palabras prohibidas fuera de literales', () => {
    expect(() => validateReadOnlySql('SELECT 1 FROM "User" WHERE delete')).toThrow(
      'QUERY_ASSISTANT_SQL_FORBIDDEN_KEYWORD',
    )
  })

  it('NO rechaza una palabra prohibida que aparece dentro de un literal de string', () => {
    expect(() =>
      validateReadOnlySql(`SELECT "User"."name" FROM "User" WHERE "User"."name" = 'update the record'`),
    ).not.toThrow()
  })

  it('NO rechaza un literal que contiene "--" (no es comentario real)', () => {
    expect(() =>
      validateReadOnlySql(`SELECT "User"."name" AS "Nota" FROM "User" WHERE "User"."name" = 'a--b'`),
    ).not.toThrow()
  })

  it('NO rechaza un literal que contiene ";" (no son múltiples sentencias)', () => {
    expect(() =>
      validateReadOnlySql(`SELECT "User"."name" FROM "User" WHERE "User"."name" = 'Pérez; García'`),
    ).not.toThrow()
  })

  it('rechaza un comentario SQL real', () => {
    expect(() => validateReadOnlySql('SELECT "User"."email" FROM "User" -- secreto')).toThrow(
      'QUERY_ASSISTANT_SQL_COMMENTS_FORBIDDEN',
    )
  })

  it('rechaza múltiples sentencias reales', () => {
    expect(() =>
      validateReadOnlySql('SELECT 1 FROM "User"; SELECT 2 FROM "User"'),
    ).toThrow('QUERY_ASSISTANT_SQL_MULTIPLE_STATEMENTS')
  })

  it('rechaza tablas que no están en la lista permitida', () => {
    expect(() => validateReadOnlySql('SELECT * FROM "SecretTable"')).toThrow(
      /QUERY_ASSISTANT_SQL_UNKNOWN_TABLE/,
    )
  })

  describe('evasiones de la lista de tablas', () => {
    it('rechaza una tabla no permitida agregada al FROM con coma (cross join)', () => {
      expect(() => validateReadOnlySql('SELECT * FROM "User", "BiometricDevice"')).toThrow(
        /QUERY_ASSISTANT_SQL_UNKNOWN_TABLE.*BiometricDevice/,
      )
    })

    it('rechaza la tabla no permitida aunque venga con alias', () => {
      expect(() =>
        validateReadOnlySql('SELECT u."email" FROM "User" u, "SystemSettings" s WHERE true'),
      ).toThrow(/QUERY_ASSISTANT_SQL_UNKNOWN_TABLE.*SystemSettings/)
    })

    it('rechaza una tabla no permitida traída por UNION', () => {
      expect(() =>
        validateReadOnlySql('SELECT "id" FROM "User" UNION SELECT "id" FROM "LivenessSession"'),
      ).toThrow(/QUERY_ASSISTANT_SQL_UNKNOWN_TABLE.*LivenessSession/)
    })

    it('sigue aceptando varias tablas permitidas separadas por coma', () => {
      expect(() =>
        validateReadOnlySql('SELECT * FROM "User", "Attendance" WHERE "User"."id" = "Attendance"."userId"'),
      ).not.toThrow()
    })
  })

  describe('consultas sin FROM', () => {
    it('rechaza funciones de sistema que cuelgan la consulta', () => {
      expect(() => validateReadOnlySql('SELECT pg_sleep(300)')).toThrow(
        'QUERY_ASSISTANT_SQL_FORBIDDEN_FUNCTION',
      )
    })

    it('rechaza lectura de archivos del servidor', () => {
      expect(() => validateReadOnlySql("SELECT pg_read_file('/etc/passwd')")).toThrow(
        'QUERY_ASSISTANT_SQL_FORBIDDEN_FUNCTION',
      )
    })

    it('rechaza cualquier otra llamada a función sin tabla que validar', () => {
      expect(() => validateReadOnlySql('SELECT version()')).toThrow(
        'QUERY_ASSISTANT_SQL_NO_TABLE_WITH_FUNCTION',
      )
    })

    it('acepta el SELECT inocuo que pide el system prompt cuando no se puede responder', () => {
      expect(() =>
        validateReadOnlySql(
          `SELECT 'No se puede responder con el esquema disponible' AS "Mensaje" WHERE false`,
        ),
      ).not.toThrow()
    })
  })

  it('rechaza funciones peligrosas aunque haya una tabla permitida', () => {
    expect(() => validateReadOnlySql('SELECT pg_sleep(300) FROM "User"')).toThrow(
      'QUERY_ASSISTANT_SQL_FORBIDDEN_FUNCTION',
    )
  })

  it('sigue aceptando funciones de agregación normales', () => {
    expect(() => validateReadOnlySql('SELECT count(*) FROM "User"')).not.toThrow()
  })
})
