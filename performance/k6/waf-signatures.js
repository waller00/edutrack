import http from "k6/http";
import { check } from "k6";
import { baseUrl, boundedRate, validateSafety } from "./lib/config.js";

// Test del WAF del reverse-proxy: verifica que el tráfico LEGÍTIMO no se bloquea
// (falsos positivos) y que los patrones de ataque SÍ se bloquean. Pensado para
// correrse ANTES de pasar las firmas de inyección de detección a bloqueo.
//
// Para probar el WAF en aislamiento (sin la capa de Cloudflare), correr apuntando
// al origen: K6_BASE_URL=https://edutrack-uy.com + K6_ORIGIN_IP=127.0.0.1 (en el server).

const rate = boundedRate(__ENV.EDUTRACK_K6_RATE, 3);
const duration = __ENV.EDUTRACK_K6_DURATION || "30s";

const HOST = baseUrl.replace(/^https?:\/\//, "").replace(/[:/].*$/, "");

export const options = {
  // Mapea el dominio al IP del origen para saltear Cloudflare y medir SOLO el WAF.
  hosts: __ENV.K6_ORIGIN_IP ? { [HOST]: __ENV.K6_ORIGIN_IP } : {},
  insecureSkipTLSVerify: true,
  scenarios: {
    waf: {
      executor: "constant-arrival-rate",
      rate,
      timeUnit: "1s",
      duration,
      preAllocatedVUs: Number(__ENV.EDUTRACK_K6_PRE_ALLOCATED_VUS || 5),
      maxVUs: Number(__ENV.EDUTRACK_K6_MAX_VUS || 20),
    },
  },
  thresholds: {
    // El objetivo central: CERO falsos positivos en tráfico legítimo.
    "checks{kind:legit}": ["rate>0.99"],
    // El WAF debe bloquear los ataques.
    "checks{kind:blocked}": ["rate>0.95"],
    // Las firmas de inyección están en DETECCIÓN: deben pasar (no bloquear todavía).
    "checks{kind:detected}": ["rate>0.95"],
  },
  tags: { test_type: "waf-signatures", waf_version: "1" },
};

// Rutas/entradas legítimas que NO deben bloquearse.
const LEGIT = ["/", "/healthz"];
// Rutas de escaneo que SÍ deben bloquearse (444/000).
const SCANNERS = ["/.env", "/wp-login.php", "/.git/config", "/phpmyadmin/"];
// Query strings con firmas de inyección: hoy pasan (detección), se loguean.
const INJECTION = ["/?q=union+select+1+from+users", "/?x=%3Cscript%3Ealert(1)%3C/script%3E"];

function isBlocked(res) {
  // 0 = conexión cerrada (444 del origen); 520 = Cloudflare ante 444; 403/405/429 = WAF.
  return [0, 403, 405, 429, 444, 520].includes(res.status);
}
function isOk(res) {
  return res.status >= 200 && res.status < 400;
}

export function setup() {
  validateSafety();
}

export default function () {
  for (const p of LEGIT) {
    const r = http.get(`${baseUrl}${p}`, { redirects: 0, tags: { kind: "legit" } });
    check(r, { "legítimo NO bloqueado": isOk }, { kind: "legit" });
  }

  for (const p of SCANNERS) {
    const r = http.get(`${baseUrl}${p}`, { redirects: 0, tags: { kind: "blocked" } });
    check(r, { "ruta de escáner bloqueada": isBlocked }, { kind: "blocked" });
  }

  {
    const r = http.get(`${baseUrl}/`, {
      headers: { "User-Agent": "sqlmap/1.7-dev" },
      redirects: 0,
      tags: { kind: "blocked" },
    });
    check(r, { "user-agent de herramienta bloqueado": isBlocked }, { kind: "blocked" });
  }

  {
    const r = http.request("TRACE", `${baseUrl}/`, null, { redirects: 0, tags: { kind: "blocked" } });
    check(r, { "método TRACE bloqueado (405)": (res) => res.status === 405 || isBlocked(res) }, { kind: "blocked" });
  }

  for (const p of INJECTION) {
    const r = http.get(`${baseUrl}${p}`, { redirects: 0, tags: { kind: "detected" } });
    check(r, { "inyección pasa (modo detección)": isOk }, { kind: "detected" });
  }
}
