/** Convierte fragmento tipo dd/mm/yyyy (o con - o .) a YYYY-MM-DD. */
export function parseUruguayanDniDateFragmentToIso(dateStr: string): string {
  const cleaned = dateStr.replace(/[-.]/g, "/").trim();
  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length !== 3) return "";
  const d = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const y = parseInt(parts[2], 10);
  if (!y || !m || !d || y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return "";
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Busca la fecha de vencimiento del DNI uruguayo en texto OCR (rótulos bilingües).
 */
export function extractNationalIdDocumentExpiresAtFromText(rawText: string): string {
  const t = rawText.replace(/\s+/g, " ");
  const patterns = [
    /Vencimiento\s*\/\s*Validade\s*[:\s]*([0-9]{1,2}[/.-][0-9]{1,2}[/.-][0-9]{4})/i,
    /Vencimiento\s*[:\s]*([0-9]{1,2}[/.-][0-9]{1,2}[/.-][0-9]{4})/i,
    /Vencim\w{0,12}\s*\/\s*Validad\w{0,10}\s*[:\s]*([0-9]{1,2}[/.-][0-9]{1,2}[/.-][0-9]{4})/i,
    /(?:VTO|VENC)\.?\s*[:\s]*([0-9]{1,2}[/.-][0-9]{1,2}[/.-][0-9]{4})/i,
    /Validade\s*[:\s]*([0-9]{1,2}[/.-][0-9]{1,2}[/.-][0-9]{4})/i,
    /Validez\s*[:\s]*([0-9]{1,2}[/.-][0-9]{1,2}[/.-][0-9]{4})/i,
    /Fecha\s+de\s+vencimiento\s*[:\s]*([0-9]{1,2}[/.-][0-9]{1,2}[/.-][0-9]{4})/i,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m?.[1]) {
      const iso = parseUruguayanDniDateFragmentToIso(m[1]);
      if (iso) return iso;
    }
  }
  return "";
}
