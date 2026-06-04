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
})
