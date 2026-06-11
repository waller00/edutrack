import { sleep } from "k6";
import { boundedRate, getPath, randomWeightedPath, validateSafety } from "./lib/config.js";

const warmupRate = boundedRate(__ENV.EDUTRACK_K6_BASELINE_WARMUP_RATE, 1);
const normalRate = boundedRate(__ENV.EDUTRACK_K6_BASELINE_NORMAL_RATE, 3);
const peakRate = boundedRate(__ENV.EDUTRACK_K6_BASELINE_PEAK_RATE, 5);

if (!(warmupRate <= normalRate && normalRate <= peakRate)) {
  throw new Error("Las tasas de baseline deben cumplir warmup <= normal <= peak.");
}

export const options = {
  scenarios: {
    production_baseline: {
      executor: "ramping-arrival-rate",
      startRate: warmupRate,
      timeUnit: "1s",
      preAllocatedVUs: Number(__ENV.EDUTRACK_K6_PRE_ALLOCATED_VUS || 10),
      maxVUs: Number(__ENV.EDUTRACK_K6_MAX_VUS || 30),
      stages: [
        { target: warmupRate, duration: "1m" },
        { target: normalRate, duration: "1m" },
        { target: normalRate, duration: "3m" },
        { target: peakRate, duration: "1m" },
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
      { threshold: "p(95)<750", abortOnFail: true, delayAbortEval: "30s" },
      "p(99)<1500",
    ],
    dropped_iterations: ["count==0"],
  },
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],
  tags: {
    test_type: "production-baseline",
    baseline_version: "1",
  },
};

export function setup() {
  validateSafety();
}

export default function () {
  getPath(randomWeightedPath(), { scenario: "production-baseline" });
  sleep(0.1);
}
