'use client'

/**
 * Carga la imagen en un `<img>` y libera el object URL pase lo que pase.
 *
 * El `onerror` no es un detalle: sin él, un archivo que no es una imagen (un PDF renombrado
 * `.jpg`, por ejemplo) dejaba la promesa colgada para siempre y el botón congelado en "Guardando…".
 */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('El archivo no es una imagen que el navegador pueda leer'))
    }
    img.src = url
  })
}

function canvasToJpeg(canvas: HTMLCanvasElement, name: string, quality: number): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('No se pudo procesar la imagen'))
          return
        }
        resolve(new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() }))
      },
      'image/jpeg',
      quality,
    )
  })
}

export async function compressImage(file: File, quality: number, maxWidth: number): Promise<File> {
  const img = await loadImage(file)
  let { width, height } = img
  if (width > maxWidth) {
    height = (height * maxWidth) / width
    width = maxWidth
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')?.drawImage(img, 0, 0, width, height)
  return canvasToJpeg(canvas, file.name, quality)
}

/**
 * Recorta al cuadrado central y escala a `size` px. `compressImage` sólo escala por ancho, así que
 * una foto apaisada quedaría deformada o con franjas en el recuadro de la ficha.
 */
export async function cropToSquare(file: File, size: number, quality = 0.82): Promise<File> {
  const img = await loadImage(file)
  const side = Math.min(img.width, img.height)
  const sx = (img.width - side) / 2
  const sy = (img.height - side) / 2

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  canvas.getContext('2d')?.drawImage(img, sx, sy, side, side, 0, 0, size, size)
  return canvasToJpeg(canvas, file.name, quality)
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.readAsDataURL(file)
  })
}
