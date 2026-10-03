/**
 * Validación de la foto del alumno.
 *
 * Vive fuera de la ruta a propósito: `admin-students.ts` está excluido de la cobertura
 * (`vitest.config.ts`), y esto es justamente lo que hay que poder probar sin levantar HTTP.
 *
 * El proyecto no tiene `sharp` ni ninguna librería de imágenes, así que **no se puede
 * re-codificar** lo que sube el usuario. Eso deja al reconocimiento por *magic bytes* como única
 * defensa real: sin él, un SVG con `<script>` renombrado `.jpg` se guardaría y se serviría inline.
 * Por lo mismo tampoco se validan dimensiones: parsear cabeceras a mano sería más riesgo que
 * beneficio. El reparto es explícito — el navegador garantiza el recorte y el tamaño en píxeles,
 * el servidor garantiza "chico, y un raster de un tipo permitido".
 */

/** Tope del contenido decodificado. El parser HTTP se configura por encima para poder responder 413 propio. */
export const STUDENT_PHOTO_MAX_BYTES = 1_048_576
/** Límite del `express.raw`: deliberadamente mayor que el de negocio. */
export const STUDENT_PHOTO_PARSER_LIMIT = '1500kb'

export type StudentPhotoMime = 'image/jpeg' | 'image/png' | 'image/webp'

export const STUDENT_PHOTO_MIMES: readonly StudentPhotoMime[] = ['image/jpeg', 'image/png', 'image/webp']

export type PhotoRejection = 'EMPTY' | 'TOO_LARGE' | 'UNSUPPORTED_TYPE' | 'MIME_MISMATCH'

function startsWith(buf: Buffer, bytes: readonly number[]): boolean {
  if (buf.length < bytes.length) return false
  return bytes.every((b, i) => buf[i] === b)
}

/**
 * Tipo real del contenido, por firma binaria. El `Content-Type` lo manda el cliente: no se le cree.
 * Devuelve `null` para cualquier cosa que no sea uno de los tres rasters admitidos.
 */
export function sniffImageMime(buf: Buffer): StudentPhotoMime | null {
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  // WebP: "RIFF" …4 bytes de tamaño… "WEBP"
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp'
  }
  return null
}

/**
 * Resultado plano en vez de una unión discriminada: el tsconfig del backend corre con
 * `strict: false`, y sin `strictNullChecks` TypeScript no estrecha uniones por un booleano.
 * `code === null` significa que pasó.
 */
export type PhotoValidation = {
  code: PhotoRejection | null
  mimeType: StudentPhotoMime | null
}

export function validateStudentPhoto(buf: Buffer, declaredMime: string): PhotoValidation {
  if (!buf || buf.length === 0) return { code: 'EMPTY', mimeType: null }
  if (buf.length > STUDENT_PHOTO_MAX_BYTES) return { code: 'TOO_LARGE', mimeType: null }

  const declared = declaredMime.split(';')[0]?.trim().toLowerCase() ?? ''
  if (!STUDENT_PHOTO_MIMES.includes(declared as StudentPhotoMime)) {
    return { code: 'UNSUPPORTED_TYPE', mimeType: null }
  }

  const actual = sniffImageMime(buf)
  if (actual === null) return { code: 'UNSUPPORTED_TYPE', mimeType: null }
  // Lo declarado tiene que coincidir con lo que el archivo realmente es.
  if (actual !== declared) return { code: 'MIME_MISMATCH', mimeType: null }

  return { code: null, mimeType: actual }
}

/** Mensaje y código HTTP de cada rechazo, para que la ruta no los repita. */
export function photoRejectionResponse(code: PhotoRejection): { status: number; message: string } {
  switch (code) {
    case 'EMPTY':
      return { status: 400, message: 'La foto llegó vacía' }
    case 'TOO_LARGE':
      return { status: 413, message: 'La foto supera 1 MB. Probá con una imagen más chica.' }
    case 'MIME_MISMATCH':
      return { status: 400, message: 'El archivo no coincide con el tipo declarado' }
    default:
      return { status: 415, message: 'Formato no admitido: sólo JPEG, PNG o WebP' }
  }
}

/** ETag débil derivado del contenido guardado; permite responder 304 sin leer los bytes. */
export function photoETag(updatedAt: Date, byteSize: number): string {
  return `W/"${updatedAt.getTime()}-${byteSize}"`
}
