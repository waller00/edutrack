'use client'

import { getMedicalLeaveCertificateLinkLabel } from '@/lib/admin/licenses-display'
import {
  certificateHasValue,
  isMedicalLeaveCertificateDataUrl,
  openMedicalLeaveCertificateInNewTab,
} from '@/lib/medical-leaves/certificate-client'

type Props = {
  certificate: string | null | undefined
  /** Clases Tailwind para el enlace o botón (p. ej. indigo vs emerald). */
  linkClassName: string
}

export default function MedicalLeaveCertificateLink({ certificate, linkClassName }: Props) {
  if (!certificateHasValue(certificate)) {
    return <span className="text-gray-400">—</span>
  }

  const c = certificate!.trim()
  const label = getMedicalLeaveCertificateLinkLabel(c)

  if (isMedicalLeaveCertificateDataUrl(c)) {
    return (
      <button
        type="button"
        className={linkClassName}
        onClick={() => void openMedicalLeaveCertificateInNewTab(c)}
      >
        {label}
      </button>
    )
  }

  return (
    <a href={c} target="_blank" rel="noopener noreferrer" className={linkClassName}>
      {label}
    </a>
  )
}
