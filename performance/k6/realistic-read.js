import { sleep } from "k6";
import { boundedRate, getPath, randomWeightedPath, validateSafety } from "./lib/config.js";

const rate = boundedRate(__ENV.EDUTRACK_K6_RATE, 5);
const duration = __ENV.EDUTRACK_K6_DURATION || "2m";
const preAllocatedVUs = Number(__ENV.EDUTRACK_K6_PRE_ALLOCATED_VUS || 10);
const maxVUs = Number(__ENV.EDUTRACK_K6_MAX_VUS || 50);

export const options = {
  scenarios: {
    weighted_reads: {
      executor: "constant-arrival-rate",
      rate,
      timeUnit: "1s",
      duration,
      preAllocatedVUs,
      maxVUs,
    },
  },
  thresholds: {
    checks: [{ threshold: "rate>0.99", abortOnFail: true, delayAbortEval: "30s" }],
    http_req_failed: [{ threshold: "rate<0.01", abortOnFail: true, delayAbortEval: "30s" }],
    http_req_duration: [{ threshold: "p(95)<750", abortOnFail: true, delayAbortEval: "30s" }],
    dropped_iterations: ["count==0"],
  },
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],
};

export function setup() {
  validateSafety();
}

export default function () {
  getPath(randomWeightedPath(), { scenario: "realistic-read" });
  sleep(0.1);
}
