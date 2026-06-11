import { sleep } from "k6";
import { getPath, validateSafety } from "./lib/config.js";

export function setup() {
  validateSafety();
}

export const options = {
  vus: 1,
  duration: "30s",
  thresholds: {
    checks: ["rate>0.99"],
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<750", "p(99)<1500"],
  },
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],
};

export default function () {
  getPath("/health", { scenario: "smoke" });
  sleep(1);
}
