import { readFileSync, writeFileSync } from "node:fs";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error("Uso: node render-authenticated-summary.mjs <summary.json> <report.md>");
}

const summary = JSON.parse(readFileSync(inputPath, "utf8"));
const metrics = summary.metrics || {};

function value(metric, field, fallback = 0) {
  return metrics[metric]?.[field] ?? metrics[metric]?.value ?? fallback;
}

function number(metric, field, digits = 2) {
  return Number(value(metric, field)).toFixed(digits);
}

function thresholdState(metric) {
  const thresholds = metrics[metric]?.thresholds || {};
  if (!Object.keys(thresholds).length) return "Sin threshold";
  return Object.values(thresholds).every((failed) => failed === false) ? "Cumple" : "No cumple";
}

const paths = process.env.K6_AUTHENTICATED_PATHS || "/auth/me";

const report = `# Baseline autenticada de rendimiento de produccion

- Fecha UTC: ${new Date().toISOString()}
- Commit: ${process.env.GITHUB_SHA || "ejecucion local"}
- Objetivo: ${process.env.K6_BASE_URL || "no informado"}
- Perfil: authenticated-production-baseline-v1
- Generador de carga: ${process.env.RUNNER_NAME || "equipo local"}
- Endpoints autenticados: ${paths}

## Perfil aplicado

La prueba crea una sesion BFF temporal para un usuario tecnico de performance y ejecuta lecturas autenticadas con carga gradual desde ${process.env.EDUTRACK_K6_BASELINE_WARMUP_RATE || 1} req/s, operacion esperada de ${process.env.EDUTRACK_K6_BASELINE_NORMAL_RATE || 2} req/s y pico controlado de ${process.env.EDUTRACK_K6_BASELINE_PEAK_RATE || 3} req/s.

## Resultados

| Metrica | Criterio inicial | Resultado | Estado |
|---|---:|---:|---|
| Solicitudes HTTP | Informativo | ${value("http_reqs", "count")} | Informativo |
| Solicitudes fallidas | < 1% | ${(Number(value("http_req_failed", "value")) * 100).toFixed(2)}% | ${thresholdState("http_req_failed")} |
| Checks aprobados | > 99% | ${(Number(value("checks", "value")) * 100).toFixed(2)}% | ${thresholdState("checks")} |
| Latencia promedio | Informativo | ${number("http_req_duration", "avg")} ms | Informativo |
| Latencia p95 | < 1000 ms | ${number("http_req_duration", "p(95)")} ms | ${thresholdState("http_req_duration")} |
| Latencia p99 | < 2000 ms | ${number("http_req_duration", "p(99)")} ms | ${thresholdState("http_req_duration")} |
| Iteraciones descartadas | 0 | ${value("dropped_iterations", "count")} | ${metrics.dropped_iterations ? thresholdState("dropped_iterations") : "Cumple"} |

## Interpretacion

Esta baseline valida el camino publico Cloudflare/reverse proxy/backend/Redis/PostgreSQL para una sesion autenticada de lectura. No mide escrituras, importaciones, reportes pesados ni capacidad maxima del sistema.

Durante la ejecucion se deben correlacionar estos resultados con Backend RED, PostgreSQL, Redis, Docker Containers, Node Host y logs del reverse proxy.
`;

writeFileSync(outputPath, report);
console.log(report);
