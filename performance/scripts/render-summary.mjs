import { readFileSync, writeFileSync } from "node:fs";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error("Uso: node render-summary.mjs <summary.json> <report.md>");
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

const report = `# Baseline de rendimiento de produccion

- Fecha UTC: ${new Date().toISOString()}
- Commit: ${process.env.GITHUB_SHA || "ejecucion local"}
- Motivo: ${process.env.BASELINE_REASON || "no informado"}
- Objetivo: ${process.env.K6_BASE_URL || "no informado"}
- Perfil: produccion-baseline-v1
- Generador de carga: ${process.env.RUNNER_NAME || "equipo local"}
- Ejecucion: ${process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : "ejecucion local"}

## Perfil aplicado

La prueba incrementa gradualmente la carga desde ${process.env.EDUTRACK_K6_BASELINE_WARMUP_RATE || 1} req/s, mantiene ${process.env.EDUTRACK_K6_BASELINE_NORMAL_RATE || 3} req/s como operacion esperada y alcanza un pico controlado de ${process.env.EDUTRACK_K6_BASELINE_PEAK_RATE || 5} req/s.

## Resultados

| Metrica | Criterio inicial | Resultado | Estado |
|---|---:|---:|---|
| Solicitudes HTTP | Informativo | ${value("http_reqs", "count")} | Informativo |
| Solicitudes fallidas | < 1% | ${(Number(value("http_req_failed", "value")) * 100).toFixed(2)}% | ${thresholdState("http_req_failed")} |
| Checks aprobados | > 99% | ${(Number(value("checks", "value")) * 100).toFixed(2)}% | ${thresholdState("checks")} |
| Latencia promedio | Informativo | ${number("http_req_duration", "avg")} ms | Informativo |
| Latencia p95 | < 750 ms | ${number("http_req_duration", "p(95)")} ms | ${thresholdState("http_req_duration")} |
| Latencia p99 | < 1500 ms | ${number("http_req_duration", "p(99)")} ms | ${thresholdState("http_req_duration")} |
| Iteraciones descartadas | 0 | ${value("dropped_iterations", "count")} | ${metrics.dropped_iterations ? thresholdState("dropped_iterations") : "Cumple"} |

## Interpretacion

Esta baseline representa disponibilidad y rendimiento de endpoints publicos no destructivos. Incluye latencia de Internet entre el runner y el droplet. No representa todavia flujos autenticados, escrituras ni la capacidad maxima del sistema.

Durante la ejecucion se deben correlacionar estos resultados con los dashboards Backend RED, PostgreSQL, Docker Containers y Node Host.
`;

writeFileSync(outputPath, report);
console.log(report);
