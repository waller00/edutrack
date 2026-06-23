import { describe, it, expect } from "vitest";
import { resolveEffectiveYmdRange, resolveYmdRangeFromPayload, ymdRangeForCalendarMonth } from "./date-range.js";
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

describe("resolveEffectiveYmdRange (precedencia)", () => {
  const empty: LlmIntentPayload["params"] = {};

  it("1) el filtro de fechas de la UI gana sobre todo", () => {
    const r = resolveEffectiveYmdRange(
      { month: 6, year: 2025 },
      { dateFrom: "2025-04-01", dateTo: "2025-04-30", schoolYearId: "sy", schoolYearCode: 2025 },
    );
    expect(r).toEqual({ from: "2025-04-01", to: "2025-04-30" });
  });

  it("2) sin filtro UI, usa el período de la pregunta", () => {
    const r = resolveEffectiveYmdRange({ month: 6, year: 2025 }, { schoolYearId: "sy", schoolYearCode: 2025 });
    expect(r).toEqual(ymdRangeForCalendarMonth(2025, 6));
  });

  it("3) sin filtro ni pregunta, usa los límites del ciclo lectivo", () => {
    const r = resolveEffectiveYmdRange(empty, {
      schoolYearId: "sy",
      schoolYearCode: 2025,
      schoolYearStartsOn: "2025-03-03",
      schoolYearEndsOn: "2025-12-05",
    });
    expect(r).toEqual({ from: "2025-03-03", to: "2025-12-05" });
  });

  it("3b) ciclo sin límites cargados → año calendario del código", () => {
    const r = resolveEffectiveYmdRange(empty, { schoolYearId: "sy", schoolYearCode: 2025 });
    expect(r).toEqual({ from: "2025-01-01", to: "2025-12-31" });
  });

  it("4) todos los ciclos sin filtro → todo el histórico", () => {
    const r = resolveEffectiveYmdRange(empty, { allYears: true });
    expect(r?.from).toBe("2000-01-01");
    expect(r?.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("sin scope ni pregunta → null (pide un mes)", () => {
    expect(resolveEffectiveYmdRange(empty)).toBeNull();
  });
});
