import http from "k6/http";
import { check } from "k6";

export const baseUrl = (__ENV.K6_BASE_URL || "http://host.docker.internal:4000").replace(/\/$/, "");

export const apiPaths = (__ENV.K6_API_PATHS || "/health")
  .split(",")
  .map((path) => path.trim())
  .filter(Boolean)
  .map((path) => (path.startsWith("/") ? path : `/${path}`));

export const defaultHeaders = __ENV.K6_SESSION_COOKIE
  ? { Cookie: `sid=${__ENV.K6_SESSION_COOKIE}` }
  : {};

function isProductionTarget() {
  return !/^https?:\/\/(localhost|127\.0\.0\.1|host\.docker\.internal)(:\d+)?(\/|$)/i.test(baseUrl);
}

export function validateSafety() {
  if (
    isProductionTarget() &&
    !(
      __ENV.K6_ALLOW_PRODUCTION === "true" &&
      __ENV.K6_PRODUCTION_CONFIRMATION === "I_UNDERSTAND_THIS_GENERATES_LOAD"
    )
  ) {
    throw new Error(
      "Objetivo remoto bloqueado. Para autorizarlo use K6_ALLOW_PRODUCTION=true y la confirmacion documentada.",
    );
  }

  for (const path of [...apiPaths, ...weightedPaths.map((item) => item.path)]) {
    if (!path.startsWith("/") || path.includes("://") || path.includes("\\")) {
      throw new Error(`Ruta k6 no permitida: ${path}`);
    }
  }
}

export function boundedRate(value, fallback) {
  const parsed = Number(value || fallback);
  const maximum = Number(__ENV.EDUTRACK_K6_MAX_ALLOWED_RATE || 100);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > maximum) {
    throw new Error(`Tasa k6 invalida: ${parsed}. Maximo permitido: ${maximum}.`);
  }
  return parsed;
}

export function getPath(path, tags = {}) {
  const response = http.get(`${baseUrl}${path}`, {
    headers: defaultHeaders,
    redirects: 0,
    tags: { endpoint: path, ...tags },
  });

  check(response, {
    "status exacto 200": (res) => res.status === 200,
    "sin redireccion al login": (res) => !String(res.headers.Location || "").includes("/login"),
    "respuesta JSON": (res) => String(res.headers["Content-Type"] || "").includes("application/json"),
  }, { endpoint: path });

  return response;
}

export function randomApiPath() {
  return apiPaths[Math.floor(Math.random() * apiPaths.length)];
}

const weightedPaths = (__ENV.K6_WEIGHTED_PATHS || "/health:1,/ready:1")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean)
  .map((entry) => {
    const separator = entry.lastIndexOf(":");
    const path = separator > 0 ? entry.slice(0, separator) : entry;
    const weight = separator > 0 ? Number(entry.slice(separator + 1)) : 1;
    return { path, weight: Number.isFinite(weight) && weight > 0 ? weight : 1 };
  });

export function randomWeightedPath() {
  const total = weightedPaths.reduce((sum, item) => sum + item.weight, 0);
  let cursor = Math.random() * total;
  for (const item of weightedPaths) {
    cursor -= item.weight;
    if (cursor <= 0) return item.path;
  }
  return weightedPaths[weightedPaths.length - 1].path;
}
