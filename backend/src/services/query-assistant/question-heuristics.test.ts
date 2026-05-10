import { describe, it, expect } from "vitest";
import { heuristicIntentFromQuestion, spanishMonthFromQuestion } from "./question-heuristics.js";

describe("heuristicIntentFromQuestion", () => {
  it("horas trabajadas + mes", () => {
    const r = heuristicIntentFromQuestion("horas trabajadas mayo");
    expect(r?.intent).toBe("HOURS_WORKED_SUMMARY");
    expect(r?.params.month).toBe(5);
    expect(r?.params.year).toBeDefined();
  });

  it("horas + mes sin 'trabajadas'", () => {
    const r = heuristicIntentFromQuestion("horas mayo");
    expect(r?.intent).toBe("HOURS_WORKED_SUMMARY");
    expect(r?.params.month).toBe(5);
  });

  it("lista de usuarios", () => {
    const r = heuristicIntentFromQuestion("dame la lista de usuarios");
    expect(r?.intent).toBe("USERS_ADMIN_SNAPSHOT");
    expect(r?.params.userAdminScope).toBe("ACTIVE_RECENT");
  });

  it("usuarios pendientes", () => {
    const r = heuristicIntentFromQuestion("usuarios pendientes de aprobación");
    expect(r?.intent).toBe("USERS_ADMIN_SNAPSHOT");
    expect(r?.params.userAdminScope).toBe("PENDING_APPROVAL");
  });
});

describe("spanishMonthFromQuestion", () => {
  it("detecta setiembre", () => {
    expect(spanishMonthFromQuestion("licencias setiembre")).toBe(9);
  });
});
