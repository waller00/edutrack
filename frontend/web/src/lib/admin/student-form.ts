/**
 * Validación del formulario de estudiante, fuera del componente para poder probarla sola.
 *
 * Devuelve **en qué pestaña** está el problema además del mensaje: es lo que permite que el
 * formulario salte a la pestaña correcta y enfoque el campo. Sin eso, dividir la ficha en pestañas
 * escondería campos obligatorios y el usuario vería un error sin saber dónde está.
 *
 * Espeja las reglas del backend (`studentCreateSchema` en `admin-students.ts`). No lo reemplaza:
 * evita el viaje y señala el campo exacto.
 */

import { isValidUruguayanCI } from '@/lib/forms/uruguay-forms'

export type StudentTabId = 'datos' | 'contacto' | 'trayectoria' | 'adecuaciones' | 'moodle' | 'historial'

export type StudentFormError = {
  field: string
  tab: StudentTabId
  message: string
}

export type ValidatableStudent = {
  firstName: string
  lastName: string
  documentId?: string | null
  email?: string | null
  username?: string | null
  contactPhone?: string | null
  tutorPhone?: string | null
  address?: string | null
  liceoAccessNotes?: string | null
  internalNotes?: string | null
}

const USERNAME_RE = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function text(value: string | null | undefined): string {
  return (value ?? '').trim()
}

function tooLong(value: string | null | undefined, max: number): boolean {
  return text(value).length > max
}

/** Primer problema encontrado, o `null`. El orden es el de lectura del formulario. */
export function validateStudent(student: ValidatableStudent): StudentFormError | null {
  if (text(student.firstName) === '') {
    return { field: 'firstName', tab: 'datos', message: 'Poné el nombre del estudiante.' }
  }
  if (tooLong(student.firstName, 120)) {
    return { field: 'firstName', tab: 'datos', message: 'El nombre no puede pasar de 120 caracteres.' }
  }
  if (text(student.lastName) === '') {
    return { field: 'lastName', tab: 'datos', message: 'Poné el apellido del estudiante.' }
  }
  if (tooLong(student.lastName, 120)) {
    return { field: 'lastName', tab: 'datos', message: 'El apellido no puede pasar de 120 caracteres.' }
  }

  const documentId = text(student.documentId)
  if (documentId === '') {
    return { field: 'documentId', tab: 'datos', message: 'La cédula es obligatoria.' }
  }
  if (!isValidUruguayanCI(documentId)) {
    return {
      field: 'documentId',
      tab: 'datos',
      message: 'Cédula inválida: verificá el número y el dígito verificador.',
    }
  }

  // Email y usuario son opcionales: hacen falta recién para crear la cuenta de Moodle.
  const email = text(student.email)
  if (email !== '' && !EMAIL_RE.test(email)) {
    return { field: 'email', tab: 'contacto', message: 'El email no tiene un formato válido.' }
  }
  if (tooLong(student.email, 200)) {
    return { field: 'email', tab: 'contacto', message: 'El email no puede pasar de 200 caracteres.' }
  }

  const username = text(student.username)
  if (username !== '') {
    if (username.length < 3) {
      return { field: 'username', tab: 'contacto', message: 'El usuario debe tener al menos 3 caracteres.' }
    }
    if (username.length > 30) {
      return { field: 'username', tab: 'contacto', message: 'El usuario no puede pasar de 30 caracteres.' }
    }
    if (!USERNAME_RE.test(username.toLowerCase())) {
      return {
        field: 'username',
        tab: 'contacto',
        message: 'Usuario inválido: usá letras, números, puntos o guiones.',
      }
    }
  }

  for (const [field, max] of [
    ['contactPhone', 40],
    ['tutorPhone', 40],
    ['address', 500],
  ] as const) {
    if (tooLong(student[field], max)) {
      return { field, tab: 'contacto', message: `Este campo no puede pasar de ${max} caracteres.` }
    }
  }
  for (const field of ['liceoAccessNotes', 'internalNotes'] as const) {
    if (tooLong(student[field], 8000)) {
      return { field, tab: 'contacto', message: 'Este campo no puede pasar de 8000 caracteres.' }
    }
  }

  return null
}

/** ¿Se puede crear la cuenta de Moodle con estos datos? Misma regla que `realAccountData` del backend. */
export function canProvisionMoodle(student: ValidatableStudent): boolean {
  return text(student.email) !== '' && text(student.username) !== ''
}
