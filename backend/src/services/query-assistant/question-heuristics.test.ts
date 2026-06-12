import { describe, it, expect } from "vitest";
import { heuristicIntentFromQuestion, spanishMonthFromQuestion } from "./question-heuristics.js";

describe("heuristicIntentFromQuestion", () => {
  it("horas trabajadas + mes", () => {
    const r = heuristicIntentFromQuestion("horas trabajadas mayo");
    expect(r?.intent).toBe("HOURS_WORKED_SUMMARY");
    expect(r?.params.month).toBe(5);
    expect(r?.params.year).toBeDefined();
  });

  it("usa el año por defecto del ciclo seleccionado", () => {
    const r = heuristicIntentFromQuestion("horas trabajadas octubre", 2025);
    expect(r?.intent).toBe("HOURS_WORKED_SUMMARY");
    expect(r?.params.month).toBe(10);
    expect(r?.params.year).toBe(2025);
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

  it("quién faltó más en mayo → ranking de faltas derivadas", () => {
    const r = heuristicIntentFromQuestion("¿Quién faltó más en mayo?");
    expect(r?.intent).toBe("ABSENCES_SUMMARY");
    expect(r?.params.incidentViewMode).toBe("COUNT_BY_USER");
    expect(r?.params.month).toBe(5);
  });

  it("Ranking de ausencias en mayo", () => {
    const r = heuristicIntentFromQuestion("Ranking de ausencias en mayo");
    expect(r?.intent).toBe("ABSENCES_SUMMARY");
    expect(r?.params.month).toBe(5);
    expect(r?.params.incidentViewMode).toBe("COUNT_BY_USER");
  });

  it("profesores que faltaron en junio → listado de faltas de docentes", () => {
    const r = heuristicIntentFromQuestion("profesores que faltaron en junio");
    expect(r?.intent).toBe("ABSENCES_SUMMARY");
    expect(r?.params.month).toBe(6);
    expect(r?.params.personRoleScope).toBe("TEACHER");
    expect(r?.params.incidentViewMode).toBeUndefined();
  });

  it("quién faltó hoy → rango de un día", () => {
    const r = heuristicIntentFromQuestion("¿quién faltó hoy?");
    expect(r?.intent).toBe("ABSENCES_SUMMARY");
    expect(r?.params.dateFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r?.params.dateFrom).toBe(r?.params.dateTo);
  });

  it("ausencias del personal en mayo → STAFF", () => {
    const r = heuristicIntentFromQuestion("ausencias del personal en mayo");
    expect(r?.intent).toBe("ABSENCES_SUMMARY");
    expect(r?.params.personRoleScope).toBe("STAFF");
    expect(r?.params.month).toBe(5);
  });

  it("docentes ausentes en junio → listado de faltas", () => {
    const r = heuristicIntentFromQuestion("docentes ausentes en junio");
    expect(r?.intent).toBe("ABSENCES_SUMMARY");
    expect(r?.params.month).toBe(6);
    expect(r?.params.personRoleScope).toBe("TEACHER");
  });

  it("usuarios que faltaron + cantidad de veces → faltas con conteo por persona, no listado de cuentas", () => {
    const r = heuristicIntentFromQuestion(
      "dame los usuarios que faltaron en junio y la cantidad de veces que lo hicieron",
    );
    expect(r?.intent).toBe("ABSENCES_SUMMARY");
    expect(r?.params.month).toBe(6);
    expect(r?.params.incidentViewMode).toBe("COUNT_BY_USER");
    expect(r?.params.personRoleScope).toBeUndefined();
  });

  it("usuarios que faltaron en junio (sin conteo) → listado de faltas", () => {
    const r = heuristicIntentFromQuestion("usuarios que faltaron en junio");
    expect(r?.intent).toBe("ABSENCES_SUMMARY");
    expect(r?.params.month).toBe(6);
    expect(r?.params.incidentViewMode).toBeUndefined();
  });

  it("cuántas veces faltó cada docente en junio → conteo de faltas TEACHER", () => {
    const r = heuristicIntentFromQuestion("¿cuántas veces faltó cada docente en junio?");
    expect(r?.intent).toBe("ABSENCES_SUMMARY");
    expect(r?.params.month).toBe(6);
    expect(r?.params.incidentViewMode).toBe("COUNT_BY_USER");
    expect(r?.params.personRoleScope).toBe("TEACHER");
  });

  it("usuarios que llegaron tarde en junio → tardanzas, no listado de cuentas", () => {
    const r = heuristicIntentFromQuestion("usuarios que llegaron tarde en junio");
    expect(r?.intent).toBe("ATTENDANCE_LATE_SUMMARY");
    expect(r?.params.month).toBe(6);
  });

  it("dame los usuarios con licencias → no es listado de cuentas (cae a NL→SQL)", () => {
    const r = heuristicIntentFromQuestion("dame los usuarios con licencias");
    expect(r?.intent).not.toBe("USERS_ADMIN_SNAPSHOT");
  });

  it("incidencias de ausencia siguen yendo a incidencias", () => {
    const r = heuristicIntentFromQuestion("incidencias de ausencia docente en mayo");
    expect(r?.intent).toBe("ATTENDANCE_INCIDENTS_SUMMARY");
    expect(r?.params.month).toBe(5);
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

  it("eventos del profesor Silva en octubre", () => {
    const r = heuristicIntentFromQuestion("Eventos del profesor Silva en octubre");
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

  it("quién tiene más atrasos en mayo → tardanzas", () => {
    const r = heuristicIntentFromQuestion("¿Qué profesor tiene más atrasos en mayo?");
    expect(r?.intent).toBe("ATTENDANCE_LATE_SUMMARY");
    expect(r?.params.month).toBe(5);
  });

  it("quién faltó más este año → rango año", () => {
    const r = heuristicIntentFromQuestion("¿Quién faltó más este año?");
    expect(r?.intent).toBe("ABSENCES_SUMMARY");
    expect(r?.params.dateFrom).toMatch(/^\d{4}-01-01$/);
    expect(r?.params.dateTo).toMatch(/^\d{4}-12-31$/);
    expect(r?.params.incidentViewMode).toBe("COUNT_BY_USER");
  });

  it("Incidencias de salida anticipada en mayo", () => {
    const r = heuristicIntentFromQuestion("Incidencias de salida anticipada en mayo.");
    expect(r?.intent).toBe("ATTENDANCE_INCIDENTS_SUMMARY");
    expect(r?.params.incidentTypeScope).toBe("EARLY_EXIT");
    expect(r?.params.month).toBe(5);
  });

  it("Incidencias de retiro temprano en mayo", () => {
    const r = heuristicIntentFromQuestion("Incidencias de retiro temprano en mayo.");
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
