const MAX_BYTES = 2.5 * 1024 * 1024

const ACCEPT = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf']

export function medicalLeaveCertificateAcceptAttr(): string {
  return '.png,.jpg,.jpeg,.webp,.pdf,image/png,image/jpeg,image/webp,application/pdf'
}

export async function readMedicalLeaveCertificateFile(file: File): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }> {
  if (!ACCEPT.includes(file.type)) {
    return { ok: false, error: 'Formato no permitido. Usá PNG, JPG, WEBP o PDF.' }
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: 'El archivo supera el tamaño máximo (2,5 MB).' }
  }
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result || '')
      if (!dataUrl.startsWith('data:')) {
        resolve({ ok: false, error: 'No se pudo leer el archivo.' })
        return
      }
      resolve({ ok: true, dataUrl })
    }
    reader.onerror = () => resolve({ ok: false, error: 'No se pudo leer el archivo.' })
    reader.readAsDataURL(file)
  })
}

export function certificateHasValue(cert?: string | null): boolean {
  return Boolean(cert && cert.trim())
}

/** Certificado incrustado (imagen/PDF en base64); no usar como `href` directo en navegadores (límite de longitud → pestaña en blanco). */
export function isMedicalLeaveCertificateDataUrl(certificate: string): boolean {
  return certificate.trim().toLowerCase().startsWith('data:')
}

/**
 * Abre certificado en pestaña nueva. Las URLs http(s) se abren directo; los `data:` se convierten a blob
 * para evitar el límite de longitud de la barra de direcciones.
 */
export async function openMedicalLeaveCertificateInNewTab(certificate: string): Promise<void> {
  const c = certificate.trim()
  if (!c) return

  if (/^https?:\/\//i.test(c)) {
    window.open(c, '_blank', 'noopener,noreferrer')
    return
  }

  if (c.startsWith('data:')) {
    try {
      const res = await fetch(c)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const win = window.open(url, '_blank', 'noopener,noreferrer')
      if (!win) {
        URL.revokeObjectURL(url)
        return
      }
      const revoke = () => URL.revokeObjectURL(url)
      win.addEventListener('beforeunload', revoke)
      setTimeout(revoke, 120_000)
    } catch {
      window.open(c, '_blank', 'noopener,noreferrer')
    }
    return
  }

  window.open(c, '_blank', 'noopener,noreferrer')
}
