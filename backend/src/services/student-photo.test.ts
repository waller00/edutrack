import { describe, expect, it } from 'vitest'
import {
  STUDENT_PHOTO_MAX_BYTES,
  photoETag,
  photoRejectionResponse,
  sniffImageMime,
  validateStudentPhoto,
} from './student-photo.js'

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP', 'ascii'),
])
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')

describe('sniffImageMime', () => {
  it('reconoce los tres rasters admitidos', () => {
    expect(sniffImageMime(JPEG)).toBe('image/jpeg')
    expect(sniffImageMime(PNG)).toBe('image/png')
    expect(sniffImageMime(WEBP)).toBe('image/webp')
  })

  it('no reconoce un SVG', () => {
    // Sin `sharp` no se puede re-codificar: si esto pasara, se guardaría un SVG con script
    // y se serviría inline. Es la única defensa que hay.
    expect(sniffImageMime(SVG)).toBeNull()
  })

  it('no reconoce HTML ni contenido vacío o truncado', () => {
    expect(sniffImageMime(Buffer.from('<!doctype html>'))).toBeNull()
    expect(sniffImageMime(Buffer.alloc(0))).toBeNull()
    expect(sniffImageMime(Buffer.from([0xff, 0xd8]))).toBeNull()
    // RIFF sin la marca WEBP (por ejemplo un .wav) no es una imagen.
    expect(sniffImageMime(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(8)]))).toBeNull()
  })
})

describe('validateStudentPhoto', () => {
  it('acepta cada tipo declarado correctamente', () => {
    expect(validateStudentPhoto(JPEG, 'image/jpeg')).toEqual({ code: null, mimeType: 'image/jpeg' })
    expect(validateStudentPhoto(PNG, 'image/png')).toEqual({ code: null, mimeType: 'image/png' })
    expect(validateStudentPhoto(WEBP, 'image/webp')).toEqual({ code: null, mimeType: 'image/webp' })
  })

  it('tolera parámetros en el Content-Type', () => {
    expect(validateStudentPhoto(JPEG, 'image/jpeg; charset=binary').code).toBeNull()
    expect(validateStudentPhoto(JPEG, 'IMAGE/JPEG').code).toBeNull()
  })

  it('rechaza cuando lo declarado no es lo que el archivo es', () => {
    expect(validateStudentPhoto(PNG, 'image/jpeg')).toEqual({ code: 'MIME_MISMATCH', mimeType: null })
  })

  it('rechaza un SVG aunque se declare como imagen', () => {
    expect(validateStudentPhoto(SVG, 'image/svg+xml')).toEqual({ code: 'UNSUPPORTED_TYPE', mimeType: null })
    expect(validateStudentPhoto(SVG, 'image/png')).toEqual({ code: 'UNSUPPORTED_TYPE', mimeType: null })
  })

  it('rechaza vacío y por tamaño', () => {
    expect(validateStudentPhoto(Buffer.alloc(0), 'image/jpeg')).toEqual({ code: 'EMPTY', mimeType: null })
    const huge = Buffer.concat([JPEG, Buffer.alloc(STUDENT_PHOTO_MAX_BYTES)])
    expect(validateStudentPhoto(huge, 'image/jpeg')).toEqual({ code: 'TOO_LARGE', mimeType: null })
  })

  it('acepta justo en el límite', () => {
    const exact = Buffer.concat([JPEG, Buffer.alloc(STUDENT_PHOTO_MAX_BYTES - JPEG.length)])
    expect(exact.length).toBe(STUDENT_PHOTO_MAX_BYTES)
    expect(validateStudentPhoto(exact, 'image/jpeg').code).toBeNull()
  })
})

describe('photoRejectionResponse', () => {
  it('el exceso de tamaño es 413 y lo dice en criollo', () => {
    const res = photoRejectionResponse('TOO_LARGE')
    expect(res.status).toBe(413)
    expect(res.message).toMatch(/1 MB/)
  })

  it('el formato no admitido es 415 y el desajuste 400', () => {
    expect(photoRejectionResponse('UNSUPPORTED_TYPE').status).toBe(415)
    expect(photoRejectionResponse('MIME_MISMATCH').status).toBe(400)
    expect(photoRejectionResponse('EMPTY').status).toBe(400)
  })
})

describe('photoETag', () => {
  it('cambia cuando cambia la foto', () => {
    const a = photoETag(new Date('2026-03-01T10:00:00Z'), 1000)
    expect(a).toBe('W/"1772359200000-1000"')
    expect(photoETag(new Date('2026-03-01T10:00:00Z'), 1001)).not.toBe(a)
    expect(photoETag(new Date('2026-03-02T10:00:00Z'), 1000)).not.toBe(a)
  })
})
