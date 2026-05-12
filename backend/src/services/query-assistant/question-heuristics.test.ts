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

  it("tardanzas + mes (plural reconocido)", () => {
    const r = heuristicIntentFromQuestion("Tardanzas en mayo");
    expect(r?.intent).toBe("ATTENDANCE_LATE_SUMMARY");
    expect(r?.params.month).toBe(5);
  });

  it("licencias activas sin mes → mes UTC actual en payload", () => {
    const r = heuristicIntentFromQuestion("licencias activas");
    expect(r?.intent).toBe("MEDICAL_LEAVES_SUMMARY");
    expect(r?.params.leaveStatusScope).toBe("ACTIVE_ONLY");
    expect(r?.params.month).toBeGreaterThanOrEqual(1);
    expect(r?.params.month).toBeLessThanOrEqual(12);
  });

  it("quién faltó más en mayo → ranking ausencias", () => {
    const r = heuristicIntentFromQuestion("¿Quién faltó más en mayo?");
    expect(r?.intent).toBe("ATTENDANCE_INCIDENTS_SUMMARY");
    expect(r?.params.incidentViewMode).toBe("COUNT_BY_USER");
    expect(r?.params.incidentTypeScope).toBe("TEACHER_NO_SHOW");
    expect(r?.params.month).toBe(5);
  });

  it("Ranking de ausencias en mayo", () => {
    const r = heuristicIntentFromQuestion("Ranking de ausencias en mayo");
    expect(r?.intent).toBe("ATTENDANCE_INCIDENTS_SUMMARY");
    expect(r?.params.month).toBe(5);
    expect(r?.params.incidentViewMode).toBe("COUNT_BY_USER");
  });

  it("conteo de incidencias por docente → mes actual si no hay mes", () => {
    const r = heuristicIntentFromQuestion("Conteo de incidencias por docente");
    expect(r?.intent).toBe("ATTENDANCE_INCIDENTS_SUMMARY");
    expect(r?.params.incidentViewMode).toBe("COUNT_BY_USER");
    expect(r?.params.month).toBeGreaterThanOrEqual(1);
  })

  it("documento por vencer → usuarios doc por vencer", () => {
    const r = heuristicIntentFromQuestion("documento por vencer.");
    expect(r?.intent).toBe("USERS_ADMIN_SNAPSHOT");
    expect(r?.params.userAdminScope).toBe("DOC_EXPIRING_90D");
  })

  it("eventos del docente Silva en octubre", () => {
    const r = heuristicIntentFromQuestion("Eventos del docente Silva en octubre");
    expect(r?.intent).toBe("ASSIGNED_EVENTS_SUMMARY");
    expect(r?.params.month).toBe(10);
  })

  it("este mes en spanishMonthFromQuestion", () => {
    expect(spanishMonthFromQuestion("Auditoría de logins este mes")).toBe(new Date().getUTCMonth() + 1);
  });

  it("Eventos asignados en abril", () => {
    const r = heuristicIntentFromQuestion("Eventos asignados en abril");
    expect(r?.intent).toBe("ASSIGNED_EVENTS_SUMMARY");
    expect(r?.params.month).toBe(4);
  });

  it("eventos de este mes", () => {
    const r = heuristicIntentFromQuestion("eventos de este mes");
    expect(r?.intent).toBe("ASSIGNED_EVENTS_SUMMARY");
    expect(r?.params.month).toBeGreaterThanOrEqual(1);
  });

  it("quién tiene más llegadas tarde en mayo → tardanzas", () => {
    const r = heuristicIntentFromQuestion("¿Quién tiene mas llegadas tarde en mayo?");
    expect(r?.intent).toBe("ATTENDANCE_LATE_SUMMARY");
    expect(r?.params.month).toBe(5);
  });

  it("quién faltó más este año → rango año", () => {
    const r = heuristicIntentFromQuestion("¿Quién faltó más este año?");
    expect(r?.intent).toBe("ATTENDANCE_INCIDENTS_SUMMARY");
    expect(r?.params.dateFrom).toMatch(/^\d{4}-01-01$/);
    expect(r?.params.dateTo).toMatch(/^\d{4}-12-31$/);
  });

  it("Incidencias de salida anticipada en mayo", () => {
    const r = heuristicIntentFromQuestion("Incidencias de salida anticipada en mayo.");
    expect(r?.intent).toBe("ATTENDANCE_INCIDENTS_SUMMARY");
    expect(r?.params.incidentTypeScope).toBe("EARLY_EXIT");
    expect(r?.params.month).toBe(5);
  });
});

describe("spanishMonthFromQuestion", () => {
  it("detecta setiembre", () => {
    expect(spanishMonthFromQuestion("licencias setiembre")).toBe(9);
  });
});
