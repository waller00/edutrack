'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, Loader2, Trash2 } from 'lucide-react'
import { apiBlob, apiUpload } from '@/lib/api/binary'
import { cropToSquare } from '@/lib/media/image-upload'
import type { StudentPhotoMeta } from './student-types'

/** Lado del cuadrado que se guarda. Suficiente para la ficha y para imprimir una lista. */
const PHOTO_SIZE = 512

type Props = {
  studentId: string | null
  firstName: string
  lastName: string
  photo: StudentPhotoMeta | null
  onChange: (photo: StudentPhotoMeta | null) => void
  onError: (message: string) => void
}

export function initialsOf(firstName: string, lastName: string): string {
  return `${lastName.trim()[0] ?? ''}${firstName.trim()[0] ?? ''}`.toUpperCase()
}

/**
 * Foto del alumno: subir, previsualizar y quitar.
 *
 * Al crear todavía no hay id, así que no hay dónde guardarla: el recuadro explica que la foto se
 * agrega después de guardar, en vez de ofrecer un botón que no podría funcionar.
 */
export default function StudentPhotoField({
  studentId,
  firstName,
  lastName,
  photo,
  onChange,
  onError,
}: Props) {
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const loadPreview = useCallback(async () => {
    if (!studentId || !photo) {
      setPreview(null)
      return
    }
    try {
      const blob = await apiBlob(`/admin/students/${studentId}/photo?v=${Date.parse(photo.updatedAt)}`)
      setPreview(blob ? URL.createObjectURL(blob) : null)
    } catch {
      // Que no se pueda ver la foto no debe romper la ficha entera.
      setPreview(null)
    }
  }, [studentId, photo])

  useEffect(() => {
    void loadPreview()
  }, [loadPreview])

  // El object URL se libera al reemplazarlo o al desmontar; si no, queda reservado hasta recargar.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview)
    }
  }, [preview])

  async function upload(file: File) {
    if (!studentId) return
    setBusy(true)
    try {
      const square = await cropToSquare(file, PHOTO_SIZE)
      const saved = await apiUpload<{ photo: StudentPhotoMeta }>(
        `/admin/students/${studentId}/photo`,
        square,
      )
      onChange(saved.photo)
    } catch (error) {
      onError(error instanceof Error ? error.message : 'No se pudo guardar la foto')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function remove() {
    if (!studentId) return
    setBusy(true)
    try {
      await apiUpload(`/admin/students/${studentId}/photo`, new Blob([]), 'DELETE')
      onChange(null)
      setPreview(null)
    } catch (error) {
      onError(error instanceof Error ? error.message : 'No se pudo quitar la foto')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex h-32 w-32 items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-slate-50">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element -- blob local, no una URL remota
          <img src={preview} alt={`Foto de ${firstName} ${lastName}`} className="h-full w-full object-cover" />
        ) : (
          <span className="text-2xl font-semibold text-slate-400" aria-hidden>
            {initialsOf(firstName, lastName) || <Camera className="h-8 w-8" />}
          </span>
        )}
      </div>

      {studentId ? (
        <div className="flex flex-col items-center gap-1">
          <input
            ref={inputRef}
            id="student-photo"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void upload(file)
            }}
          />
          <label
            htmlFor="student-photo"
            className="cursor-pointer text-xs font-medium text-emerald-700 hover:underline"
          >
            {busy ? (
              <span className="inline-flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                Procesando…
              </span>
            ) : photo ? (
              'Cambiar foto'
            ) : (
              'Subir foto'
            )}
          </label>
          {photo && !busy && (
            <button
              type="button"
              onClick={() => void remove()}
              className="inline-flex items-center gap-1 text-xs text-red-600 hover:underline"
            >
              <Trash2 className="h-3 w-3" aria-hidden />
              Quitar
            </button>
          )}
        </div>
      ) : (
        <p className="max-w-[8rem] text-center text-[11px] leading-snug text-gray-500">
          La foto se agrega después de guardar.
        </p>
      )}
    </div>
  )
}
