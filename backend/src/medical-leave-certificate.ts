/** Certificado adjunto: URL pública o data URL (imagen/PDF). Límite por payload razonable. */
export const MEDICAL_LEAVE_CERTIFICATE_MAX_CHARS = 650_000;

export function isValidMedicalLeaveCertificateValue(value: string): boolean {
  if (!value || value.length > MEDICAL_LEAVE_CERTIFICATE_MAX_CHARS) return false;
  if (/^https?:\/\//i.test(value.trim())) return true;
  return /^data:(image\/(png|jpeg|jpg|webp)|application\/pdf);base64,/i.test(value.trim());
}
