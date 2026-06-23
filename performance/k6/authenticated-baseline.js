import { sleep } from "k6";
import http from "k6/http";
import { check, fail } from "k6";
import { baseUrl, boundedRate, validateSafety } from "./lib/config.js";

const warmupRate = boundedRate(__ENV.EDUTRACK_K6_BASELINE_WARMUP_RATE, 1);
const normalRate = boundedRate(__ENV.EDUTRACK_K6_BASELINE_NORMAL_RATE, 2);
const peakRate = boundedRate(__ENV.EDUTRACK_K6_BASELINE_PEAK_RATE, 3);

if (!(warmupRate <= normalRate && normalRate <= peakRate)) {
  throw new Error("Las tasas de baseline autenticada deben cumplir warmup <= normal <= peak.");
}

const authenticatedPaths = (__ENV.K6_AUTHENTICATED_PATHS || "/auth/me")
  .split(",")
  .map((path) => path.trim())
  .filter(Boolean)
  .map((path) => (path.startsWith("/") ? path : `/${path}`));

export const options = {
  scenarios: {
    authenticated_baseline: {
      executor: "ramping-arrival-rate",
      startRate: warmupRate,
      timeUnit: "1s",
      preAllocatedVUs: Number(__ENV.EDUTRACK_K6_PRE_ALLOCATED_VUS || 5),
      maxVUs: Number(__ENV.EDUTRACK_K6_MAX_VUS || 15),
      stages: [
        { target: warmupRate, duration: "1m" },
        { target: normalRate, duration: "1m" },
        { target: normalRate, duration: "3m" },
        { target: peakRate, duration: "1m" },
        { target: warmupRate, duration: "1m" },
      ],
      gracefulStop: "15s",
    },
  },
  thresholds: {
    checks: [{ threshold: "rate>0.99", abortOnFail: true, delayAbortEval: "30s" }],
    http_req_failed: [{ threshold: "rate<0.01", abortOnFail: true, delayAbortEval: "30s" }],
    http_req_duration: [
      { threshold: "p(95)<1000", abortOnFail: true, delayAbortEval: "30s" },
      "p(99)<2000",
    ],
    dropped_iterations: ["count==0"],
  },
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],
  tags: {
    test_type: "authenticated-production-baseline",
    baseline_version: "1",
  },
};

export function setup() {
  validateSafety();
  if (!__ENV.K6_AUTH_IDENTIFIER || !__ENV.K6_PERFORMANCE_AUTH_SECRET) {
    throw new Error("Faltan K6_AUTH_IDENTIFIER o K6_PERFORMANCE_AUTH_SECRET.");
  }
  for (const path of authenticatedPaths) {
    if (!path.startsWith("/") || path.includes("://") || path.includes("\\")) {
      throw new Error(`Ruta autenticada k6 no permitida: ${path}`);
    }
  }

  const response = http.post(
    `${baseUrl}/auth/performance/session`,
    JSON.stringify({ identifier: __ENV.K6_AUTH_IDENTIFIER }),
    {
      headers: {
        "Content-Type": "application/json",
        "x-edutrack-performance-secret": __ENV.K6_PERFORMANCE_AUTH_SECRET,
      },
      redirects: 0,
      tags: { endpoint: "/auth/performance/session", phase: "setup" },
    },
  );

  const ok = check(response, {
    "sesion de performance creada": (res) => res.status === 200,
    "sesion devuelve sid": (res) => Boolean(res.json("sid")),
  }, { endpoint: "/auth/performance/session" });

  if (!ok) {
    fail(`No se pudo crear sesion autenticada de performance: HTTP ${response.status} ${response.body}`);
  }

  return { sid: response.json("sid") };
}

export default function (data) {
  const path = authenticatedPaths[Math.floor(Math.random() * authenticatedPaths.length)];
  const response = http.get(`${baseUrl}${path}`, {
    headers: { Cookie: `sid=${data.sid}` },
    redirects: 0,
    tags: { endpoint: path, scenario: "authenticated-production-baseline" },
  });

  check(response, {
    "status exacto 200": (res) => res.status === 200,
    "sin redireccion al login": (res) => !String(res.headers.Location || "").includes("/login"),
    "respuesta JSON": (res) => String(res.headers["Content-Type"] || "").includes("application/json"),
  }, { endpoint: path });

  sleep(0.1);
}
