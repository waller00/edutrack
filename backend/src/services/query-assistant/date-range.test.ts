import { describe, it, expect } from "vitest";
import { resolveYmdRangeFromPayload, ymdRangeForCalendarMonth } from "./date-range.js";
import type { LlmIntentPayload } from "./schemas.js";

describe("resolveYmdRangeFromPayload", () => {
  it("usa dateFrom y dateTo válidos", () => {
    const p: LlmIntentPayload["params"] = {
      dateFrom: "2025-05-10",
      dateTo: "2025-05-20",
    };
    expect(resolveYmdRangeFromPayload(p)).toEqual({ from: "2025-05-10", to: "2025-05-20" });
  });

  it("usa mes y año", () => {
    const p: LlmIntentPayload["params"] = { year: 2025, month: 10 };
    expect(resolveYmdRangeFromPayload(p)).toEqual(ymdRangeForCalendarMonth(2025, 10));
  });
});
