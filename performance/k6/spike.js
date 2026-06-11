import { sleep } from "k6";
import { boundedRate, getPath, randomApiPath, validateSafety } from "./lib/config.js";

const spikeRate = boundedRate(__ENV.EDUTRACK_K6_SPIKE_RATE, 25);
const preAllocatedVUs = Number(__ENV.EDUTRACK_K6_PRE_ALLOCATED_VUS || 10);
const maxVUs = Number(__ENV.EDUTRACK_K6_MAX_VUS || 50);

export const options = {
  scenarios: {
    controlled_spike: {
      executor: "ramping-arrival-rate",
      startRate: 1,
      timeUnit: "1s",
      preAllocatedVUs,
      maxVUs,
      stages: [
        { target: 5, duration: "30s" },
        { target: spikeRate, duration: "15s" },
        { target: spikeRate, duration: "30s" },
        { target: 5, duration: "30s" },
        { target: 0, duration: "15s" },
      ],
    },
  },
  thresholds: {
    checks: [{ threshold: "rate>0.98", abortOnFail: true, delayAbortEval: "30s" }],
    http_req_failed: [{ threshold: "rate<0.02", abortOnFail: true, delayAbortEval: "30s" }],
    http_req_duration: ["p(95)<1000", "p(99)<2000"],
    dropped_iterations: ["count==0"],
  },
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],
};

export function setup() {
  validateSafety();
}

export default function () {
  getPath(randomApiPath(), { scenario: "spike" });
  sleep(0.1);
}
