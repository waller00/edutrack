/**
 * Los modelos razonadores de OpenAI (gpt-5*, o1/o3/o4...) rechazan `temperature`
 * distinto del default; los chat clásicos (gpt-4o*, gpt-4.1*) sí lo aceptan.
 * Esto permite configurar cualquier modelo vía env sin romper la llamada.
 */
export function temperatureParams(model: string, temperature: number): { temperature?: number } {
  return /^(?:o\d|gpt-5)/i.test(model) ? {} : { temperature }
}
