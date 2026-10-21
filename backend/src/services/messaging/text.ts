/**
 * Partes puras de la mensajería: sin base de datos, para poder testearlas solas.
 */

/** Clave única de la conversación de un par: los dos ids ordenados. "a:b" y "b:a" son la misma. */
export function pairKeyOf(userA: string, userB: string): string {
  return [userA, userB].sort().join(':')
}

/** Vista previa de la lista: una línea, recortada. */
export function messagePreview(body: string, max = 90): string {
  const oneLine = body.replace(/\s+/g, ' ').trim()
  return oneLine.length > max ? `${oneLine.slice(0, max - 1).trimEnd()}…` : oneLine
}

/** Minúsculas y sin tildes, para buscar "Gimenez" y encontrar "Giménez". */
export function foldForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

type NamedUser = { firstName?: string | null; lastName?: string | null; name?: string | null }

/** Nombre a mostrar: nombre y apellido; si no hay, el `name` cargado. */
export function displayNameOf(user: NamedUser): string {
  const full = [user.firstName, user.lastName].filter((part) => part && part.trim()).join(' ').trim()
  return full || user.name?.trim() || 'Usuario'
}

/** ¿Coinciden todas las palabras buscadas con el nombre? "ana gar" encuentra a "Ana García". */
export function matchesSearch(user: NamedUser, query: string): boolean {
  const words = foldForSearch(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const haystack = foldForSearch([user.firstName, user.lastName, user.name].filter(Boolean).join(' '))
  return words.every((word) => haystack.includes(word))
}
