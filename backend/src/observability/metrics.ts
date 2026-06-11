import http from "node:http";
import type { NextFunction, Request, Response } from "express";
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from "prom-client";

export const metricsRegistry = new Registry();

collectDefaultMetrics({
  prefix: "edutrack_backend_",
  register: metricsRegistry,
});

const httpRequestsTotal = new Counter({
  name: "edutrack_backend_http_requests_total",
  help: "Total de solicitudes HTTP recibidas por el backend.",
  labelNames: ["method", "route", "status_code"] as const,
  registers: [metricsRegistry],
});

const httpRequestDurationSeconds = new Histogram({
  name: "edutrack_backend_http_request_duration_seconds",
  help: "Duracion de las solicitudes HTTP del backend en segundos.",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry],
});

const httpRequestsInFlight = new Gauge({
  name: "edutrack_backend_http_requests_in_flight",
  help: "Solicitudes HTTP actualmente en proceso.",
  labelNames: ["method"] as const,
  registers: [metricsRegistry],
});

const httpErrorsTotal = new Counter({
  name: "edutrack_backend_http_errors_total",
  help: "Total de respuestas HTTP 5xx generadas por el backend.",
  labelNames: ["method", "route", "status_code"] as const,
  registers: [metricsRegistry],
});

const idSegmentPatterns = [
  /^\d+$/,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  /^[0-9a-f]{20,}$/i,
  /^[A-Za-z0-9_-]{32,}$/,
];

export function normalizeHttpRoute(originalUrl: string, statusCode?: number): string {
  if (statusCode === 404) return "/unmatched";

  const rawPath = originalUrl.split("?")[0] || "/";
  const segments = rawPath.split("/").filter(Boolean);
  if (segments.length === 0) return "/";

  return `/${segments
    .map((segment) => {
      let decoded = segment;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        return ":value";
      }
      return idSegmentPatterns.some((pattern) => pattern.test(decoded)) ? ":id" : decoded;
    })
    .join("/")}`;
}

export function httpMetricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const method = req.method.toUpperCase();
  const startedAt = process.hrtime.bigint();
  let finished = false;

  httpRequestsInFlight.inc({ method });

  const recordMetrics = () => {
    if (finished) return;
    finished = true;

    const statusCode = String(res.statusCode);
    const route = normalizeHttpRoute(req.originalUrl, res.statusCode);
    const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
    const labels = { method, route, status_code: statusCode };

    httpRequestsInFlight.dec({ method });
    httpRequestsTotal.inc(labels);
    httpRequestDurationSeconds.observe(labels, durationSeconds);
    if (res.statusCode >= 500) httpErrorsTotal.inc(labels);
  };

  res.once("finish", recordMetrics);
  res.once("close", recordMetrics);
  next();
}

export function startMetricsServer(port = Number(process.env.METRICS_PORT || 9464)): http.Server | null {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    console.warn(`[metrics] METRICS_PORT invalido: ${process.env.METRICS_PORT ?? port}`);
    return null;
  }

  const server = http.createServer(async (req, res) => {
    if (req.method !== "GET" || req.url?.split("?")[0] !== "/metrics") {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found\n");
      return;
    }

    try {
      res.writeHead(200, { "content-type": metricsRegistry.contentType });
      res.end(await metricsRegistry.metrics());
    } catch (error) {
      console.error("[metrics] render:", error);
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end("Metrics unavailable\n");
    }
  });

  server.on("error", (error) => console.error("[metrics] server:", error));
  server.listen(port, "0.0.0.0", () => {
    console.log(`   Metricas Prometheus (red interna): http://0.0.0.0:${port}/metrics`);
  });
  return server;
}
