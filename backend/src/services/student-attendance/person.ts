/** Datos de una persona para mostrar quién da una clase o quién pasó la lista. */
export const PERSON_SELECT = { id: true, name: true, username: true, firstName: true, lastName: true } as const

export type PersonRef = { id: string; name: string }

type PersonRow = {
  id: string
  name?: string | null
  username?: string | null
  firstName?: string | null
  lastName?: string | null
}

/** Nombre para mostrar: el elegido, si no nombre y apellido, si no el usuario. */
export function personRef(user: PersonRow | null | undefined): PersonRef | null {
  if (!user) return null
  const full = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim()
  return { id: user.id, name: user.name || full || user.username || 'Docente' }
}
